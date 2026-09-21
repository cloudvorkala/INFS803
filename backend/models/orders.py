from typing import Literal

from pydantic import AwareDatetime

from models.common import Contract, Money, NonEmptyText, NonNegativeInt, PositiveInt

MAX_CHECKOUT_LINES = 40


class ShippingAddress(Contract):
    fullName: NonEmptyText
    line1: NonEmptyText
    city: NonEmptyText
    postcode: NonEmptyText
    country: NonEmptyText


class CheckoutRequest(Contract):
    shippingAddress: ShippingAddress


class OrderItem(Contract):
    productId: NonEmptyText
    title: NonEmptyText
    author: NonEmptyText
    price: Money
    quantity: PositiveInt
    subtotal: Money


class Order(Contract):
    orderId: NonEmptyText
    userId: NonEmptyText
    placedAt: AwareDatetime
    status: Literal["CONFIRMED"]
    shippingAddress: ShippingAddress
    items: list[OrderItem]
    total: Money


class OrderListResponse(Contract):
    count: NonNegativeInt
    orders: list[Order]
