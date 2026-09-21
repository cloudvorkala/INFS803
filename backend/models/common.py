from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer, StringConstraints


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


Text = Annotated[str, StringConstraints(strict=True)]
NonEmptyText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1)]
NonNegativeInt = Annotated[int, Field(strict=True, ge=0)]
PositiveInt = Annotated[int, Field(strict=True, gt=0)]


def numeric_only(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("Expected a numeric value")
    return value


Money = Annotated[
    Decimal,
    BeforeValidator(numeric_only),
    Field(ge=0, allow_inf_nan=False),
    PlainSerializer(lambda value: float(value), return_type=float, when_used="json"),
]
