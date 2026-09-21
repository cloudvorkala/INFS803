"""HTTP boundaries for future routes: parse_json_request() and api_response().

Validate only client JSON through parse_json_request(). Map service/repository
results into an API response Contract, then return api_response(model, status).
Do not pass internal DynamoDB dictionaries or model.model_dump() to jsonify().
"""

from decimal import Decimal
from typing import TypeVar

from flask import Response, current_app, request
from flask.json.provider import DefaultJSONProvider
from pydantic import BaseModel, ValidationError

from errors import ApiError
from models.common import Contract

RequestContract = TypeVar("RequestContract", bound=Contract)


class ExplicitJSONProvider(DefaultJSONProvider):
    """Reject implicit model/Decimal conversion; plain JSON error envelopes work."""

    @staticmethod
    def default(value):
        if isinstance(value, (BaseModel, Decimal)):
            raise TypeError(
                "Use api_response() with an API response model; "
                "map internal Decimal values into that model first."
            )
        return DefaultJSONProvider.default(value)


def api_response(model: Contract, status: int = 200) -> Response:
    """Serialize a mapped API response model in JSON mode, including nested money.

    Raw dictionaries are deliberately rejected: once a model has been dumped,
    its field-specific serializers cannot be recovered reliably.
    """
    if not isinstance(model, Contract):
        raise TypeError("api_response() requires an API response Contract instance.")
    response = current_app.json.response(model.model_dump(mode="json"))
    response.status_code = status
    return response


def parse_json_request(model_type: type[RequestContract]) -> RequestContract:
    """Translate validation failures only while parsing the current client body.

    Keep domain/response model construction outside this helper so internal
    ValidationErrors reach the application's safe 500 handler.
    """
    payload = request.get_json()
    try:
        return model_type.model_validate(payload)
    except ValidationError as error:
        # Report field locations, never token, upload, or other input values.
        fields = sorted({".".join(map(str, item["loc"])) or "body" for item in error.errors()})
        raise ApiError(400, f"Invalid request field(s): {', '.join(fields)}.") from error
