"""Authenticated cart routes; identity comes exclusively from verified Cognito sub."""

from flask import Blueprint, current_app

from auth.decorators import authenticated_user_id, require_auth
from errors import ApiError
from http_helpers import api_response, parse_json_request
from models.cart import CartAddRequest, CartUpdateRequest

cart_blueprint = Blueprint("cart", __name__)


def _product_id(value: str) -> str:
    value = value.strip()
    if not value:
        raise ApiError(400, "productId must be non-empty.")
    return value


@cart_blueprint.get("/cart")
@require_auth
def get_cart():
    return api_response(current_app.extensions["cart_service"].get_cart(authenticated_user_id()))


@cart_blueprint.post("/cart")
@require_auth
def add_item():
    payload = parse_json_request(CartAddRequest)
    return api_response(current_app.extensions["cart_service"].add_item(authenticated_user_id(), payload))


@cart_blueprint.put("/cart/<string:product_id>")
@require_auth
def update_item(product_id: str):
    product_id = _product_id(product_id)
    payload = parse_json_request(CartUpdateRequest)
    return api_response(current_app.extensions["cart_service"].update_item(
        authenticated_user_id(), product_id, payload,
    ))


@cart_blueprint.delete("/cart/<string:product_id>")
@require_auth
def delete_item(product_id: str):
    return api_response(current_app.extensions["cart_service"].delete_item(
        authenticated_user_id(), _product_id(product_id),
    ))
