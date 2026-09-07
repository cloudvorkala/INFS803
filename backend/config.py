"""Environment-only configuration; loading never contacts AWS."""

import os
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    aws_region: Annotated[RequiredText, Field(pattern=r"^[a-z]{2}(?:-[a-z]+)+-[0-9]+$")] = "ap-southeast-2"
    cognito_user_pool_id: RequiredText
    cognito_app_client_id: RequiredText
    products_table: RequiredText
    carts_table: RequiredText
    orders_table: RequiredText
    uploads_bucket: RequiredText
    allowed_origins: tuple[str, ...] = ()
    jwks_cache_seconds: int = Field(default=300, ge=1, le=3600)
    jwks_timeout_seconds: float = Field(default=3, gt=0, le=10)

    @model_validator(mode="after")
    def pool_region_matches(self):
        prefix, separator, suffix = self.cognito_user_pool_id.partition("_")
        if not separator or prefix != self.aws_region or not suffix.isalnum():
            raise ValueError("Cognito User Pool ID must belong to the configured AWS region.")
        return self

    @field_validator("allowed_origins")
    @classmethod
    def validate_origins(cls, origins):
        for origin in origins:
            parsed = urlsplit(origin)
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.path
                    or parsed.query or parsed.fragment or "*" in origin):
                raise ValueError("CORS origins must be exact HTTP(S) origins without paths or wildcards.")
        return origins

    @property
    def cognito_issuer(self) -> str:
        return f"https://cognito-idp.{self.aws_region}.amazonaws.com/{self.cognito_user_pool_id}"

    @classmethod
    def from_env(cls, environ=None):
        env = os.environ if environ is None else environ
        mapping = {
            "aws_region": "AWS_REGION",
            "cognito_user_pool_id": "COGNITO_USER_POOL_ID",
            "cognito_app_client_id": "COGNITO_APP_CLIENT_ID",
            "products_table": "PRODUCTS_TABLE",
            "carts_table": "CARTS_TABLE",
            "orders_table": "ORDERS_TABLE",
            "uploads_bucket": "UPLOADS_BUCKET",
            "jwks_cache_seconds": "JWKS_CACHE_SECONDS",
            "jwks_timeout_seconds": "JWKS_TIMEOUT_SECONDS",
        }
        values = {field: env[name] for field, name in mapping.items() if name in env}
        values["allowed_origins"] = tuple(
            origin.strip() for origin in env.get("ALLOWED_ORIGINS", "").split(",") if origin.strip()
        )
        return cls.model_validate(values)
