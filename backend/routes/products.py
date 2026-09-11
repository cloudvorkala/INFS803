"""Public product reads; persistence and record mapping live in the repository."""

from flask import Blueprint, current_app, request

from errors import ApiError
from http_helpers import api_response
from models.products import ProductListResponse

products_blueprint = Blueprint("products", __name__)


def _query_filter(name: str) -> str | None:
    values = request.args.getlist(name)
    if len(values) > 1:
        raise ApiError(400, f"Query parameter '{name}' must be provided only once.")
    if not values:
        return None
    return values[0].strip() or None


@products_blueprint.get("/products")
def list_products():
    category = _query_filter("category")
    search = _query_filter("search")
    products = current_app.extensions["product_repository"].list_products(
        category=category, search=search,
    )
    return api_response(ProductListResponse(count=len(products), products=products))


@products_blueprint.get("/products/<string:product_id>")
def get_product(product_id: str):
    product = current_app.extensions["product_repository"].get_product(product_id)
    if product is None:
        raise ApiError(404, "Product not found.")
    return api_response(product)
