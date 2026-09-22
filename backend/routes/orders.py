"""Authenticated order history; ownership comes only from the verified Cognito sub."""

from flask import Blueprint, current_app

from auth.decorators import authenticated_user_id, require_auth
from http_helpers import api_response
from models.orders import OrderListResponse

orders_blueprint = Blueprint("orders", __name__)


@orders_blueprint.get("/orders")
@require_auth
def list_orders():
    orders = current_app.extensions["order_repository"].list_orders(authenticated_user_id())
    return api_response(OrderListResponse(count=len(orders), orders=orders))
