"""Partition-scoped cart persistence; all keys use the caller's verified user ID."""

from boto3.dynamodb.conditions import Attr, Key
from boto3.session import Session
from botocore.exceptions import ClientError

from config import Settings
from errors import ApiError
from models.cart import CartLine


def _line_from_item(item, user_id: str) -> CartLine:
    line = CartLine(
        userId=item["userId"], productId=item["productId"], quantity=item["quantity"],
    )
    if item["userId"] != user_id or line.userId != user_id or line.productId != item["productId"]:
        raise ValueError("Stored cart keys do not match the requested partition or valid key format.")
    return line


class CartRepository:
    def __init__(self, settings: Settings):
        self._region = settings.aws_region
        self._table_name = settings.carts_table

    def _get_table(self):
        # No SDK resource or AWS access at app startup; each operation owns its session.
        return Session().resource("dynamodb", region_name=self._region).Table(self._table_name)

    def list_lines(self, user_id: str) -> list[CartLine]:
        table = self._get_table()
        options = {"KeyConditionExpression": Key("userId").eq(user_id), "ConsistentRead": True}
        lines = []
        while True:
            page = table.query(**options)
            lines.extend(_line_from_item(item, user_id) for item in page.get("Items", []))
            last_key = page.get("LastEvaluatedKey")
            if not last_key:
                return lines
            options["ExclusiveStartKey"] = last_key

    def get_line(self, user_id: str, product_id: str) -> CartLine | None:
        response = self._get_table().get_item(
            Key={"userId": user_id, "productId": product_id}, ConsistentRead=True,
        )
        if "Item" not in response:
            return None
        line = _line_from_item(response["Item"], user_id)
        if line.productId != product_id:
            raise ValueError("Stored cart key does not match the requested product.")
        return line

    def set_quantity(
        self, user_id: str, product_id: str, quantity: int, *, expected_quantity: int | None,
    ) -> None:
        # New POST lines may be inserted; existing lines must still have the value
        # used by the service to calculate the increment/check stock. No lost updates.
        condition = Attr("userId").not_exists() if expected_quantity is None else (
            Attr("userId").exists() & Attr("quantity").eq(expected_quantity)
        )
        try:
            self._get_table().update_item(
                Key={"userId": user_id, "productId": product_id},
                UpdateExpression="SET #quantity = :quantity",
                ExpressionAttributeNames={"#quantity": "quantity"},
                ExpressionAttributeValues={":quantity": quantity},
                ConditionExpression=condition,
                ReturnValuesOnConditionCheckFailure="ALL_OLD",
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                if expected_quantity is not None and not error.response.get("Item"):
                    raise ApiError(404, "That item is not in your cart.") from None
                raise ApiError(409, "Cart changed during update. Please retry.") from None
            raise

    def delete_line(self, user_id: str, product_id: str) -> None:
        try:
            self._get_table().delete_item(
                Key={"userId": user_id, "productId": product_id},
                ConditionExpression=Attr("userId").exists(),
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise ApiError(404, "That item is not in your cart.") from None
            raise

    def remove_stale_line(self, user_id: str, product_id: str, quantity: int) -> None:
        try:
            self._get_table().delete_item(
                Key={"userId": user_id, "productId": product_id},
                ConditionExpression=Attr("quantity").eq(quantity),
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return  # Another request already removed or changed the observed row.
            raise
