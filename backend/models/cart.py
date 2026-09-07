from models.common import Contract, Money, NonEmptyText, NonNegativeInt, PositiveInt


class CartAddRequest(Contract):
    productId: NonEmptyText
    quantity: PositiveInt = 1


class CartUpdateRequest(Contract):
    quantity: NonNegativeInt


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
