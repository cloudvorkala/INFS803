"""Public product reads and admin writes using the shared HTTP boundaries."""

from flask import Blueprint, current_app, request

from auth.decorators import require_admin
from errors import ApiError
from http_helpers import api_response, parse_json_request
from models.products import ProductCreate, ProductDeleteResponse, ProductListResponse, ProductUpdate

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


@products_blueprint.post("/products")
@require_admin
def create_product():
    payload = parse_json_request(ProductCreate)
    product = current_app.extensions["product_repository"].create_product(payload)
    return api_response(product, status=201)


@products_blueprint.put("/products/<string:product_id>")
@require_admin
def update_product(product_id: str):
    payload = parse_json_request(ProductUpdate)
    product = current_app.extensions["product_repository"].update_product(product_id, payload)
    return api_response(product)


@products_blueprint.delete("/products/<string:product_id>")
@require_admin
def delete_product(product_id: str):
    current_app.extensions["product_repository"].delete_product(product_id)
    return api_response(ProductDeleteResponse(deleted=product_id))
