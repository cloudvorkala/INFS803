from decimal import Decimal

from pydantic import field_validator

from models.common import Contract, Money, NonEmptyText, NonNegativeInt, PositiveInt


class CartAddRequest(Contract):
    productId: NonEmptyText
    quantity: PositiveInt = 1


class CartUpdateRequest(Contract):
    quantity: NonNegativeInt


class CartLine(Contract):
    """Internal stored row; never used as an HTTP request or response model."""

    userId: NonEmptyText
    productId: NonEmptyText
    quantity: PositiveInt

    @field_validator("quantity", mode="before")
    @classmethod
    def stored_quantity(cls, value):
        if isinstance(value, Decimal):
            if not value.is_finite() or value != value.to_integral_value():
                raise ValueError("Stored cart quantity must be a finite integer.")
            return int(value)
        return value  # PositiveInt rejects bool, strings, floats, zero and negatives.


class CartItem(Contract):
    productId: NonEmptyText
    title: NonEmptyText
    author: NonEmptyText
    price: Money
    stock: NonNegativeInt
    quantity: PositiveInt
    subtotal: Money


class CartResponse(Contract):
    items: list[CartItem]
    itemCount: NonNegativeInt
    total: Money
