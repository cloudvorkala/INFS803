"""Authenticated checkout HTTP boundary."""

from flask import Blueprint, current_app

from auth.decorators import authenticated_user_id, require_auth
from http_helpers import api_response, parse_json_request
from models.orders import CheckoutRequest

checkout_blueprint = Blueprint("checkout", __name__)


@checkout_blueprint.post("/checkout")
@require_auth
def checkout():
    payload = parse_json_request(CheckoutRequest)
    order = current_app.extensions["checkout_service"].checkout(authenticated_user_id(), payload)
    return api_response(order, status=201)
