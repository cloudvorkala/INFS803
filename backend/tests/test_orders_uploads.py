import base64
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app import create_app
from models.orders import Order, OrderItem, ShippingAddress

ADDRESS = {"fullName": "A Reader", "line1": "1 Main Road", "city": "Auckland", "postcode": "0010", "country": "New Zealand"}
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 8


class FakeVerifier:
    def verify(self, token):
        return {"t-owner": {"sub": "owner"}, "t-other": {"sub": "other"},
                "t-admin": {"sub": "admin", "cognito:groups": ["admins"]}}[token.split(".")[0]]


def auth(name):
    return {"Authorization": f"Bearer t-{name}.x.y"}


def stored_order(order_id, user_id, placed_at, price="19.99", quantity=2):
    # Mirror CheckoutRepository's stored shape, with DynamoDB Decimal numbers.
    order = Order(
        orderId=order_id, userId=user_id, placedAt=placed_at, status="CONFIRMED",
        shippingAddress=ShippingAddress(**ADDRESS),
        items=[OrderItem(productId="bk-001", title="Book", author="Writer", price=Decimal(price),
                         quantity=quantity, subtotal=Decimal(price) * quantity)],
        total=Decimal(price) * quantity,
    )
    item = order.model_dump()
    item["placedAt"] = order.placedAt.isoformat().replace("+00:00", "Z")
    item["placedAtOrderId"] = f"{item['placedAt']}#{order_id}"
    item["items"][0]["quantity"] = Decimal(quantity)
    return item


class FakeOrdersTable:
    def __init__(self, items):
        self.items = items
        self.calls = []

    def query(self, **options):
        self.calls.append(options)
        user_id = options["KeyConditionExpression"].get_expression()["values"][1]
        rows = sorted((i for i in self.items if i["userId"] == user_id),
                      key=lambda i: i["placedAtOrderId"], reverse=not options["ScanIndexForward"])
        start = 1 if "ExclusiveStartKey" in options else 0
        page = {"Items": rows[start:start + 1]}
        if start + 1 < len(rows) and start == 0:
            page["LastEvaluatedKey"] = {"userId": user_id}
        return page


@pytest.fixture
def app(settings):
    application = create_app(settings)
    application.extensions["cognito_verifier"] = FakeVerifier()
    return application


@pytest.fixture
def orders_table(app, monkeypatch):
    table = FakeOrdersTable([
        stored_order("ord-old", "owner", datetime(2026, 9, 1, tzinfo=timezone.utc)),
        stored_order("ord-new", "owner", datetime(2026, 9, 20, tzinfo=timezone.utc)),
        stored_order("ord-theirs", "other", datetime(2026, 9, 10, tzinfo=timezone.utc)),
    ])
    monkeypatch.setattr(app.extensions["order_repository"], "_get_table", lambda: table)
    return table


def test_orders_newest_first_owned_and_paginated(app, orders_table):
    response = app.test_client().get("/orders", headers=auth("owner"))
    assert response.status_code == 200
    body = response.json
    assert body["count"] == 2
    assert [o["orderId"] for o in body["orders"]] == ["ord-new", "ord-old"]
    order = body["orders"][0]
    assert set(order) == {"orderId", "userId", "placedAt", "status", "shippingAddress", "items", "total"}
    assert order["userId"] == "owner"
    assert order["placedAt"].startswith("2026-09-20T00:00:00")
    assert order["total"] == 39.98 and order["items"][0]["price"] == 19.99
    assert order["items"][0]["quantity"] == 2
    assert len(orders_table.calls) == 2  # followed LastEvaluatedKey


def test_orders_ignore_client_user_id_and_empty_history(app, orders_table):
    client = app.test_client()
    body = client.get("/orders?userId=other", headers=auth("owner")).json
    assert {o["userId"] for o in body["orders"]} == {"owner"}
    orders_table.items = []
    assert client.get("/orders", headers=auth("owner")).json == {"count": 0, "orders": []}


def test_orders_require_auth(app, orders_table):
    client = app.test_client()
    assert client.get("/orders").status_code == 401
    assert client.get("/orders", headers={"Authorization": "t-owner.x.y"}).status_code == 401
    assert orders_table.calls == []


def data_url(content, mime="image/png"):
    return f"data:{mime};base64,{base64.b64encode(content).decode()}"


@pytest.fixture
def s3(app, monkeypatch):
    puts = []
    repository = app.extensions["upload_service"]._uploads
    def put_image(key, content, content_type):
        puts.append((key, content, content_type))
        return f"https://test-covers.s3.ap-southeast-2.amazonaws.com/{key}"
    monkeypatch.setattr(repository, "put_image", put_image)
    return puts


@pytest.mark.parametrize("content,mime,ext", [(PNG, "image/png", "png"), (JPEG, "image/jpeg", "jpg"), (WEBP, "image/webp", "webp")])
def test_upload_success(app, s3, content, mime, ext):
    response = app.test_client().post("/upload_file", headers=auth("admin"),
                                      json={"filename": "../../evil name.png", "dataUrl": data_url(content, mime)})
    assert response.status_code == 201
    body = response.json
    assert set(body) == {"url", "s3Key"}
    assert body["s3Key"].startswith("covers/uploads/img-") and body["s3Key"].endswith("." + ext)
    assert "evil" not in body["s3Key"]
    assert body["url"] == f"https://test-covers.s3.ap-southeast-2.amazonaws.com/{body['s3Key']}"
    assert s3 == [(body["s3Key"], content, mime)]


def test_upload_rejects_mismatched_content(app, s3):
    client = app.test_client()
    response = client.post("/upload_file", headers=auth("admin"),
                           json={"filename": "x.png", "dataUrl": data_url(b"<svg></svg>")})
    assert response.status_code == 400
    assert client.post("/upload_file", headers=auth("admin"),
                       json={"filename": "x.jpg", "dataUrl": data_url(PNG, "image/jpeg")}).status_code == 400
    assert s3 == []


def test_upload_validation_and_authorization(app, s3):
    client = app.test_client()
    good = {"filename": "x.png", "dataUrl": data_url(PNG)}
    assert client.post("/upload_file", json=good).status_code == 401
    assert client.post("/upload_file", headers=auth("owner"), json=good).status_code == 403
    assert client.post("/upload_file", headers=auth("admin"), json={"filename": "x.gif", "dataUrl": "data:image/gif;base64,R0lG"}).status_code == 400
    assert client.post("/upload_file", headers=auth("admin"), json={**good, "extra": 1}).status_code == 400
    assert client.post("/upload_file", headers=auth("admin"), json={"dataUrl": good["dataUrl"]}).status_code == 400
    assert s3 == []


def test_upload_repository_writes_public_prefix(settings, monkeypatch):
    from repositories import uploads
    calls = {}
    class Client:
        def put_object(self, **kwargs):
            calls.update(kwargs)
    class Session:
        def client(self, name, region_name):
            assert (name, region_name) == ("s3", "ap-southeast-2")
            return Client()
    monkeypatch.setattr(uploads, "Session", Session)
    url = uploads.UploadRepository(settings).put_image("covers/uploads/img-1.png", PNG, "image/png")
    assert url == "https://test-covers.s3.ap-southeast-2.amazonaws.com/covers/uploads/img-1.png"
    assert calls["Bucket"] == "test-covers" and calls["ContentType"] == "image/png" and calls["Body"] == PNG
