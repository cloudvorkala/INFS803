"""Build user-owned carts using current product details and Decimal arithmetic."""

from decimal import Decimal

from errors import ApiError
from models.cart import CartAddRequest, CartItem, CartResponse, CartUpdateRequest
from models.products import Product
from repositories.cart import CartRepository
from repositories.products import ProductRepository


class CartService:
    def __init__(self, carts: CartRepository, products: ProductRepository):
        self._carts = carts
        self._products = products

    def get_cart(self, user_id: str) -> CartResponse:
        items = []
        item_count = 0
        total = Decimal(0)
        for line in self._carts.list_lines(user_id):
            # An eventually consistent miss must not delete a valid cart reference.
            product = self._products.get_product(line.productId, consistent_read=True)
            if product is None:
                self._carts.remove_stale_line(user_id, line.productId, line.quantity)
                continue
            item = CartItem(
                productId=line.productId, title=product.title, author=product.author,
                price=product.price, stock=product.stock, quantity=line.quantity,
                subtotal=product.price * line.quantity,
            )
            items.append(item)
            item_count += item.quantity
            total += item.subtotal
        return CartResponse(items=items, itemCount=item_count, total=total)

    def _require_product(self, product_id: str) -> Product:
        product = self._products.get_product(product_id, consistent_read=True)
        if product is None:
            raise ApiError(404, "Product not found.")
        return product

    def add_item(self, user_id: str, payload: CartAddRequest) -> CartResponse:
        product = self._require_product(payload.productId)
        existing = self._carts.get_line(user_id, payload.productId)
        quantity = (existing.quantity if existing else 0) + payload.quantity
        if quantity > product.stock:
            raise ApiError(409, "Requested quantity exceeds available stock.")
        self._carts.set_quantity(
            user_id, payload.productId, quantity,
            expected_quantity=existing.quantity if existing else None,
        )
        return self.get_cart(user_id)

    def update_item(self, user_id: str, product_id: str, payload: CartUpdateRequest) -> CartResponse:
        if payload.quantity == 0:
            return self.delete_item(user_id, product_id)
        existing = self._carts.get_line(user_id, product_id)
        if existing is None:
            raise ApiError(404, "That item is not in your cart.")
        product = self._require_product(product_id)
        if payload.quantity > product.stock:
            raise ApiError(409, "Requested quantity exceeds available stock.")
        self._carts.set_quantity(
            user_id, product_id, payload.quantity, expected_quantity=existing.quantity,
        )
        return self.get_cart(user_id)

    def delete_item(self, user_id: str, product_id: str) -> CartResponse:
        self._carts.delete_line(user_id, product_id)
        return self.get_cart(user_id)
