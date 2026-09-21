import base64
import json
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from models.cart import CartAddRequest, CartItem, CartResponse, CartUpdateRequest
from models.orders import CheckoutRequest, Order, OrderListResponse, ShippingAddress
from models.products import Product, ProductCreate, ProductDeleteResponse, ProductListResponse, ProductUpdate
from models.uploads import MAX_UPLOAD_BYTES, UploadRequest, UploadResponse

CREATE = {"title": " Book ", "author": " Writer ", "category": " Art & Design ", "price": 0}
ADDRESS = {"fullName": " A Reader ", "line1": " 1 Main Road ", "city": " Auckland ", "postcode": " 0010 ", "country": " New Zealand "}


def test_create_defaults_and_unrestricted_category():
    product = ProductCreate(**CREATE)
    assert (product.title, product.author, product.category) == ("Book", "Writer", "Art & Design")
    assert product.price == 0
    assert product.stock == 0
    assert product.isbn == product.description == ""
    assert product.publishedYear == date.today().year
    assert product.coverUrl is None


@pytest.mark.parametrize("field", ["title", "author", "category", "price"])
def test_required_create_fields(field):
    body = CREATE.copy()
    del body[field]
    with pytest.raises(ValidationError):
        ProductCreate(**body)


@pytest.mark.parametrize("field", ["title", "author", "category", "price", "stock", "isbn", "publishedYear", "description"])
@pytest.mark.parametrize("model", [ProductCreate, ProductUpdate])
def test_explicit_null_rejected(field, model):
    body = CREATE.copy() if model is ProductCreate else {}
    body[field] = None
    with pytest.raises(ValidationError):
        model(**body)


@pytest.mark.parametrize("field", ["title", "author", "category"])
@pytest.mark.parametrize("value", ["", " \t ", 123, True])
def test_required_text_validation(field, value):
    with pytest.raises(ValidationError):
        ProductCreate(**{**CREATE, field: value})


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), float("-inf"), "1.00", True])
def test_invalid_price(value):
    with pytest.raises(ValidationError):
        ProductCreate(**{**CREATE, "price": value})


@pytest.mark.parametrize("value", [-1, 1.5, "2", True])
def test_invalid_stock(value):
    with pytest.raises(ValidationError):
        ProductCreate(**CREATE, stock=value)


@pytest.mark.parametrize("value", [0, 1400, 2100])
def test_valid_year(value):
    assert ProductCreate(**CREATE, publishedYear=value).publishedYear == value


@pytest.mark.parametrize("value", [-1, 1, 1399, 2101, 2000.5, "2000", True])
def test_invalid_year(value):
    with pytest.raises(ValidationError):
        ProductCreate(**CREATE, publishedYear=value)


@pytest.mark.parametrize("model", [ProductCreate, ProductUpdate])
def test_client_cannot_assign_id_or_unknown_fields(model):
    body = CREATE if model is ProductCreate else {}
    for extra in ({"id": "client-id"}, {"userId": "someone-else"}):
        with pytest.raises(ValidationError):
            model(**body, **extra)


def test_update_omission_zero_and_explicit_cover_removal():
    assert ProductUpdate().changes() == {}
    assert ProductUpdate(price=0, stock=0, publishedYear=0).changes() == {"price": Decimal(0), "stock": 0, "publishedYear": 0}
    assert ProductUpdate(coverUrl="").changes() == {"coverUrl": None}
    assert ProductUpdate(coverUrl=None).changes() == {"coverUrl": None}
    assert ProductUpdate(isbn="", description="").changes() == {"isbn": "", "description": ""}


def test_product_envelopes_and_numeric_serialization():
    fields = ProductCreate(**{**CREATE, "price": 24.99}).model_dump()
    product = Product(id="bk-001", **fields)
    payload = json.loads(ProductListResponse(count=1, products=[product]).model_dump_json())
    assert set(payload) == {"count", "products"}
    assert set(payload["products"][0]) == {"id", "title", "author", "category", "price", "stock", "isbn", "publishedYear", "coverUrl", "description"}
    assert payload["products"][0]["price"] == 24.99
    assert ProductDeleteResponse(deleted="bk-001").model_dump() == {"deleted": "bk-001"}


@pytest.mark.parametrize("field", list(ADDRESS))
def test_shipping_required_trimmed_nonempty(field):
    for invalid in ("", " \n ", None, 123):
        with pytest.raises(ValidationError):
            ShippingAddress(**{**ADDRESS, field: invalid})
    missing = ADDRESS.copy()
    del missing[field]
    with pytest.raises(ValidationError):
        ShippingAddress(**missing)


def test_shipping_and_checkout_ownership():
    request = CheckoutRequest(shippingAddress=ADDRESS)
    assert request.shippingAddress.postcode == "0010"
    assert request.shippingAddress.fullName == "A Reader"
    with pytest.raises(ValidationError):
        CheckoutRequest(shippingAddress=ADDRESS, userId="other")


def test_cart_quantities_and_ownership():
    assert CartAddRequest(productId="bk-001").quantity == 1
    assert CartUpdateRequest(quantity=0).quantity == 0
    for invalid in (-1, 1.5, True, None):
        with pytest.raises(ValidationError):
            CartUpdateRequest(quantity=invalid)
    with pytest.raises(ValidationError):
        CartAddRequest(productId="bk-001", quantity=0)
    with pytest.raises(ValidationError):
        CartAddRequest(productId="bk-001", userId="other")


def test_cart_order_envelopes():
    line = CartItem(productId="bk-001", title="Book", author="Writer", price=10.5, stock=4, quantity=2, subtotal=21)
    cart = CartResponse(items=[line], itemCount=2, total=21)
    assert cart.model_dump(mode="json")["total"] == 21
    assert set(cart.model_dump()) == {"items", "itemCount", "total"}
    order = Order(
        orderId="ord-1", userId="verified-sub", placedAt="2026-09-07T00:00:00Z",
        status="CONFIRMED", shippingAddress=ADDRESS,
        items=[line.model_dump(exclude={"stock"})], total=21,
    )
    payload = OrderListResponse(count=1, orders=[order]).model_dump(mode="json")
    assert set(payload) == {"count", "orders"}
    assert set(payload["orders"][0]) == {"orderId", "userId", "placedAt", "status", "shippingAddress", "items", "total"}
    assert "stock" not in payload["orders"][0]["items"][0]


def data_url(content, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(content).decode()


@pytest.mark.parametrize("mime", ["image/jpeg", "image/png", "image/webp"])
def test_upload_mime_and_response(mime):
    assert UploadRequest(filename="cover", dataUrl=data_url(b"content", mime)).filename == "cover"
    assert UploadResponse(url="https://assets.example/cover", s3Key="covers/cover").model_dump() == {"url": "https://assets.example/cover", "s3Key": "covers/cover"}


@pytest.mark.parametrize("value", ["data:image/gif;base64,YQ==", "data:image/svg+xml;base64,YQ==", "data:image/png;base64,", "data:image/png;base64,%%%", "data:image/png;base64,Y", "https://example/image.png"])
def test_upload_invalid_data_url(value):
    with pytest.raises(ValidationError):
        UploadRequest(filename="cover.png", dataUrl=value)


def test_decoded_upload_size_boundary():
    UploadRequest(filename="cover.png", dataUrl=data_url(b"x" * MAX_UPLOAD_BYTES))
    with pytest.raises(ValidationError):
        UploadRequest(filename="cover.png", dataUrl=data_url(b"x" * (MAX_UPLOAD_BYTES + 1)))
