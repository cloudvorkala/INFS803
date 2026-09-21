"""Verify Cognito ID tokens against the configured pool, never client-provided URLs."""

import re

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError

from errors import ApiError

BEARER = re.compile(r"Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)")


def parse_bearer_header(header: str | None) -> str:
    match = BEARER.fullmatch(header) if isinstance(header, str) else None
    if match is None:
        raise ApiError(401, "Authorization must use Bearer <Cognito ID token>.")
    return match.group(1)


class CognitoVerifier:
    def __init__(self, settings):
        self.issuer = settings.cognito_issuer
        self.audience = settings.cognito_app_client_id
        self.jwks = PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json",
            cache_jwk_set=True,
            cache_keys=False,  # Avoid a separate indefinite per-key cache.
            lifespan=settings.jwks_cache_seconds,
            timeout=settings.jwks_timeout_seconds,
        )

    def verify(self, token: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
            # The unverified header selects a key only; it never grants identity.
            if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str) or not header["kid"]:
                raise ValueError("Unsupported signing header")
            signing_key = self.jwks.get_signing_key(header["kid"])
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=self.issuer,
                audience=self.audience,
                options={
                    "require": ["exp", "iss", "aud", "sub", "token_use"],
                    "strict_aud": True,
                },
            )
            if claims["token_use"] != "id":
                raise ValueError("Expected ID token")
            if not isinstance(claims["sub"], str) or not claims["sub"].strip():
                raise ValueError("Missing identity")
            # Cognito emits an integer NumericDate, not a coercible string/bool.
            if type(claims["exp"]) is not int:
                raise ValueError("Invalid expiration")
            return claims
        except (PyJWTError, ValueError, TypeError, KeyError, AttributeError, OverflowError, OSError) as error:
            # Malformed JWK entries can surface built-in parsing errors from
            # the JWT library. They must never authenticate a request either.
            raise ApiError(401, "Invalid or expired Cognito ID token.") from error
