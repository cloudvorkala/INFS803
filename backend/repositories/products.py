"""Product persistence with explicit mapping and conditional admin writes."""

from collections.abc import Mapping
from decimal import Decimal
from uuid import uuid4

from boto3.dynamodb.conditions import Attr
from boto3.session import Session
from botocore.exceptions import ClientError

from config import Settings
from errors import ApiError
from models.products import Product, ProductCreate, ProductUpdate

SEARCHABLE_FIELDS = ("title", "author", "isbn")


def _search_text(product: Product) -> str:
    return " ".join(getattr(product, field) for field in SEARCHABLE_FIELDS).strip().casefold()


def _stored_integer(value: object) -> int:
    """Convert DynamoDB numbers without truncation or accepting bools/strings."""
    if isinstance(value, Decimal):
        if not value.is_finite() or value != value.to_integral_value():
            raise ValueError("Stored product integer must be finite and integral.")
        return int(value)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise ValueError("Stored product integer has an invalid type.")


def _product_from_item(item: Mapping[str, object]) -> Product:
    # Require every response field; do not apply creation defaults to stored data.
    # Extra attributes such as searchText are deliberately not mapped.
    return Product(
        id=item["id"],
        title=item["title"],
        author=item["author"],
        category=item["category"],
        price=item["price"],  # Money validates Decimal and serializes a JSON number.
        stock=_stored_integer(item["stock"]),
        isbn=item["isbn"],
        publishedYear=_stored_integer(item["publishedYear"]),
        coverUrl=item["coverUrl"],
        description=item["description"],
    )


class ProductRepository:
    def __init__(self, settings: Settings):
        self._region = settings.aws_region
        self._table_name = settings.products_table

    def _get_table(self):
        # Create the SDK resource only during an operation, never at app startup.
        # Each operation owns its session/resource; no shared resource across threads.
        # The default credential chain uses the Lambda execution role in AWS.
        return Session().resource("dynamodb", region_name=self._region).Table(self._table_name)

    def list_products(self, *, category: str | None = None, search: str | None = None) -> list[Product]:
        category_filter = category.casefold() if category else None
        search_filter = search.casefold() if search else None
        table = self._get_table()
        products = []
        scan_kwargs = {}

        # A full scan is proportional to this ~100-product catalogue. Read every
        # DynamoDB page; filtering and frontend pagination must not truncate it.
        while True:
            page = table.scan(**scan_kwargs)
            for item in page.get("Items", []):
                product = _product_from_item(item)
                if category_filter and product.category.casefold() != category_filter:
                    continue
                if search_filter and not any(
                    search_filter in value.casefold()
                    for value in (product.title, product.author, product.isbn)
                ):
                    continue
                products.append(product)

            last_key = page.get("LastEvaluatedKey")
            if not last_key:
                return products
            scan_kwargs = {"ExclusiveStartKey": last_key}

    def get_product(self, product_id: str, *, consistent_read: bool = False) -> Product | None:
        options = {"Key": {"id": product_id}}
        if consistent_read:
            options["ConsistentRead"] = True
        response = self._get_table().get_item(**options)
        if "Item" not in response:
            return None
        return _product_from_item(response["Item"])

    def create_product(self, payload: ProductCreate) -> Product:
        product = Product(id=f"bk-{uuid4().hex}", **payload.model_dump())
        item = product.model_dump()  # Python mode preserves Decimal for boto3.
        item["searchText"] = _search_text(product)
        try:
            self._get_table().put_item(Item=item, ConditionExpression=Attr("id").not_exists())
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise ApiError(409, "Product ID conflict. Please retry.") from None
            raise
        return _product_from_item(item)

    def update_product(self, product_id: str, payload: ProductUpdate) -> Product:
        table = self._get_table()
        response = table.get_item(Key={"id": product_id}, ConsistentRead=True)
        if "Item" not in response:
            raise ApiError(404, "Product not found.")
        item = response["Item"]
        existing = _product_from_item(item)
        changes = payload.changes()
        if not changes:
            return existing

        updated = Product.model_validate({**existing.model_dump(), **changes})
        writes = dict(changes)
        watched_fields = set(changes)
        if watched_fields.intersection(SEARCHABLE_FIELDS):
            writes["searchText"] = _search_text(updated)
            watched_fields.update(SEARCHABLE_FIELDS)

        # Guard fields being replaced and all inputs used to derive searchText.
        # Compare raw stored values, not the response model's normalized values.
        # Unrelated concurrent edits remain intact because this is UpdateItem.
        condition = Attr("id").exists()
        for field in sorted(watched_fields):
            condition &= Attr(field).eq(item[field])

        names = {}
        values = {}
        assignments = []
        for index, (field, value) in enumerate(writes.items()):
            name, placeholder = f"#write{index}", f":write{index}"
            names[name] = field
            values[placeholder] = value
            assignments.append(f"{name} = {placeholder}")

        try:
            response = table.update_item(
                Key={"id": product_id},
                UpdateExpression="SET " + ", ".join(assignments),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ConditionExpression=condition,
                ReturnValues="ALL_NEW",
                ReturnValuesOnConditionCheckFailure="ALL_OLD",
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                # The failed-write snapshot distinguishes deletion from a conflict
                # without a second read racing with another write. Never expose it.
                if not error.response.get("Item"):
                    raise ApiError(404, "Product not found.") from None
                raise ApiError(409, "Product changed during update. Please retry.") from None
            raise
        return _product_from_item(response["Attributes"])

    def delete_product(self, product_id: str) -> None:
        try:
            self._get_table().delete_item(
                Key={"id": product_id}, ConditionExpression=Attr("id").exists(),
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise ApiError(404, "Product not found.") from None
            raise
