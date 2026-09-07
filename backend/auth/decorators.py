from functools import wraps
from types import MappingProxyType

from flask import current_app, g, request

from auth.cognito import parse_bearer_header
from errors import ApiError


def is_admin(claims) -> bool:
    groups = claims.get("cognito:groups", [])
    return isinstance(groups, list) and all(isinstance(group, str) for group in groups) and "admins" in groups


def authenticated_user_id() -> str:
    claims = getattr(g, "auth_claims", None)
    if claims is None:
        raise ApiError(401, "Authentication required.")
    return claims["sub"]


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        token = parse_bearer_header(request.headers.get("Authorization"))
        claims = current_app.extensions["cognito_verifier"].verify(token)
        g.auth_claims = MappingProxyType(claims)
        return view(*args, **kwargs)
    return wrapped


def require_admin(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin(g.auth_claims):
            raise ApiError(403, "This action requires an admin account.")
        return view(*args, **kwargs)
    return require_auth(wrapped)
