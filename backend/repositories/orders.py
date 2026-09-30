"""Partition-scoped order history reads; keys use only the caller's verified user ID."""

from collections.abc import Mapping
from decimal import Decimal

from boto3.dynamodb.conditions import Key

from config import Settings
from models.orders import Order, OrderItem, ShippingAddress
from repositories.dynamodb import DynamoDBConnections


def _stored_integer(value: object) -> int:
    if isinstance(value, Decimal):
        if not value.is_finite() or value != value.to_integral_value():
            raise ValueError("Stored order integer must be finite and integral.")
        return int(value)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise ValueError("Stored order integer has an invalid type.")


def _order_from_item(item: Mapping[str, object], user_id: str) -> Order:
    # Map fields explicitly: storage-only placedAtOrderId never reaches the response.
    if item["userId"] != user_id:
        raise ValueError("Stored order does not belong to the requested partition.")
    return Order(
        orderId=item["orderId"],
        userId=item["userId"],
        placedAt=item["placedAt"],
        status=item["status"],
        shippingAddress=ShippingAddress(**{
            field: item["shippingAddress"][field] for field in ShippingAddress.model_fields
        }),
        items=[
            OrderItem(
                productId=line["productId"], title=line["title"], author=line["author"],
                price=line["price"], quantity=_stored_integer(line["quantity"]),
                subtotal=line["subtotal"],
            )
            for line in item["items"]
        ],
        total=item["total"],
    )


class OrderRepository:
    def __init__(self, settings: Settings, connections: DynamoDBConnections | None = None):
        self._connections = connections if connections is not None else DynamoDBConnections(settings.aws_region)
        self._table_name = settings.orders_table

    def _get_table(self):
        return self._connections.table(self._table_name)

    def list_orders(self, user_id: str) -> list[Order]:
        # Sort key is "<ISO timestamp>#<orderId>", so descending order is newest first.
        table = self._get_table()
        options = {"KeyConditionExpression": Key("userId").eq(user_id), "ScanIndexForward": False}
        orders = []
        while True:
            page = table.query(**options)
            orders.extend(_order_from_item(item, user_id) for item in page.get("Items", []))
            last_key = page.get("LastEvaluatedKey")
            if not last_key:
                return orders
            options["ExclusiveStartKey"] = last_key
