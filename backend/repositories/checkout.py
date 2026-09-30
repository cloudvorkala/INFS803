"""One atomic write of an Order, Product stock decrements, and owned cart deletes."""

from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from config import Settings
from errors import ApiError
from models.orders import MAX_CHECKOUT_LINES, Order
from repositories.dynamodb import DynamoDBConnections


class CheckoutRepository:
    def __init__(self, settings: Settings, connections: DynamoDBConnections | None = None):
        self._connections = connections if connections is not None else DynamoDBConnections(settings.aws_region)
        self._products_table = settings.products_table
        self._carts_table = settings.carts_table
        self._orders_table = settings.orders_table

    def commit(self, order: Order) -> None:
        if not 1 <= len(order.items) <= MAX_CHECKOUT_LINES:
            raise ValueError("Invalid checkout transaction size.")
        if len({item.productId for item in order.items}) != len(order.items):
            raise ValueError("Duplicate checkout product keys.")

        serializer = TypeSerializer()

        def attributes(values):
            return {key: serializer.serialize(value) for key, value in values.items()}

        stored = order.model_dump()  # Python mode keeps monetary Decimal values.
        stored["placedAt"] = order.placedAt.isoformat().replace("+00:00", "Z")
        stored["placedAtOrderId"] = f"{stored['placedAt']}#{order.orderId}"
        operations = [{"Put": {
            "TableName": self._orders_table,
            "Item": attributes(stored),
            "ConditionExpression": "attribute_not_exists(#user) AND attribute_not_exists(#sort)",
            "ExpressionAttributeNames": {"#user": "userId", "#sort": "placedAtOrderId"},
        }}]

        for item in order.items:
            operations.append({"Update": {
                "TableName": self._products_table,
                "Key": attributes({"id": item.productId}),
                "UpdateExpression": "SET #stock = #stock - :quantity",
                # Stock may change if enough remains. Snapshot fields must match
                # so concurrent admin edits cannot change what the user purchases.
                "ConditionExpression": (
                    "attribute_exists(#id) AND #stock >= :quantity "
                    "AND #price = :price AND #title = :title AND #author = :author"
                ),
                "ExpressionAttributeNames": {
                    "#id": "id", "#stock": "stock", "#price": "price",
                    "#title": "title", "#author": "author",
                },
                "ExpressionAttributeValues": attributes({
                    ":quantity": item.quantity, ":price": item.price,
                    ":title": item.title, ":author": item.author,
                }),
            }})
            operations.append({"Delete": {
                "TableName": self._carts_table,
                "Key": attributes({"userId": order.userId, "productId": item.productId}),
                "ConditionExpression": "attribute_exists(#user) AND #quantity = :quantity",
                "ExpressionAttributeNames": {"#user": "userId", "#quantity": "quantity"},
                "ExpressionAttributeValues": attributes({":quantity": item.quantity}),
            }})

        # 1 Order Put + N Product Updates + N Cart Deletes; at most 81 operations.
        # No separate writes/cleanup, application retry loop, or idempotency layer.
        client = self._connections.client()
        try:
            client.transact_write_items(TransactItems=operations)
        except ClientError as error:
            if error.response["Error"]["Code"] == "TransactionCanceledException":
                codes = {reason.get("Code") for reason in error.response.get("CancellationReasons", [])}
                conflicts = {"ConditionalCheckFailed", "TransactionConflict"}
                if codes & conflicts and codes <= conflicts | {"None", None}:
                    raise ApiError(409, "Checkout conflict. Refresh your cart and try again.") from None
            # Capacity, permissions, malformed data, and unknown failures are 500,
            # not falsely reported as insufficient stock. No AWS details in HTTP.
            raise
