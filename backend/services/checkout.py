"""Validate an owned cart and construct purchase-time Order snapshots."""

from datetime import datetime, timezone
from decimal import Decimal, Inexact, localcontext
from uuid import uuid4

from errors import ApiError
from models.orders import MAX_CHECKOUT_LINES, CheckoutRequest, Order, OrderItem
from repositories.cart import CartRepository
from repositories.checkout import CheckoutRepository
from repositories.products import ProductRepository


class CheckoutService:
    def __init__(self, carts: CartRepository, products: ProductRepository, checkout: CheckoutRepository):
        self._carts = carts
        self._products = products
        self._checkout = checkout

    def checkout(self, user_id: str, payload: CheckoutRequest) -> Order:
        # Read raw validated cart lines, not CartService's stale-reference cleanup.
        # No writes occur until every line is validated and the transaction commits.
        lines = self._carts.list_lines(user_id)
        if not lines:
            raise ApiError(400, "Your cart is empty.")
        if len(lines) > MAX_CHECKOUT_LINES:
            raise ApiError(400, "Checkout supports at most 40 unique cart lines.")
        if len({line.productId for line in lines}) != len(lines):
            raise ValueError("Duplicate stored cart lines.")

        items = []
        total = Decimal(0)
        # Match storage's decimal precision and fail safely rather than round money.
        with localcontext() as context:
            context.prec = 38
            context.traps[Inexact] = True
            for line in lines:
                product = self._products.get_product(line.productId, consistent_read=True)
                if product is None:
                    raise ApiError(404, "Product not found.")
                if product.stock < line.quantity:
                    raise ApiError(409, "Requested quantity exceeds available stock.")
                item = OrderItem(
                    productId=line.productId, title=product.title, author=product.author,
                    price=product.price, quantity=line.quantity,
                    subtotal=product.price * line.quantity,
                )
                items.append(item)
                total += item.subtotal

        order = Order(
            orderId=f"ord-{uuid4().hex}", userId=user_id,
            placedAt=datetime.now(timezone.utc), status="CONFIRMED",
            shippingAddress=payload.shippingAddress, items=items, total=total,
        )
        self._checkout.commit(order)
        return order
