from datetime import date
from typing import Annotated

from pydantic import AfterValidator, BeforeValidator, Field

from models.common import Contract, Money, NonEmptyText, NonNegativeInt, Text


def valid_year(value):
    if value != 0 and not 1400 <= value <= 2100:
        raise ValueError("Year must be 0 or from 1400 through 2100")
    return value


Year = Annotated[int, Field(strict=True), AfterValidator(valid_year)]
CoverUrl = Annotated[Text | None, BeforeValidator(lambda value: None if value == "" else value)]


class ProductCreate(Contract):
    title: NonEmptyText
    author: NonEmptyText
    category: NonEmptyText
    price: Money
    stock: NonNegativeInt = 0
    isbn: Text = ""
    publishedYear: Year = Field(default_factory=lambda: date.today().year)
    coverUrl: CoverUrl = None
    description: Text = ""


class ProductUpdate(Contract):
    # Non-nullable annotations intentionally retain null rejection. Defaults are
    # omission sentinels; only model_dump(exclude_unset=True) is a changeset.
    title: NonEmptyText = Field(default=None)
    author: NonEmptyText = Field(default=None)
    category: NonEmptyText = Field(default=None)
    price: Money = Field(default=None)
    stock: NonNegativeInt = Field(default=None)
    isbn: Text = Field(default=None)
    publishedYear: Year = Field(default=None)
    coverUrl: CoverUrl = None
    description: Text = Field(default=None)

    def changes(self):
        return self.model_dump(exclude_unset=True)


class Product(ProductCreate):
    id: NonEmptyText
    stock: NonNegativeInt
    isbn: Text
    publishedYear: Year
    coverUrl: CoverUrl
    description: Text


class ProductListResponse(Contract):
    count: NonNegativeInt
    products: list[Product]


class ProductDeleteResponse(Contract):
    deleted: NonEmptyText
