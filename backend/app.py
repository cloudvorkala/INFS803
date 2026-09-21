"""Application factory with product/cart/checkout routes and shared HTTP boundaries."""

from flask import Flask, request

from auth.cognito import CognitoVerifier
from config import Settings
from errors import register_error_handlers
from http_helpers import ExplicitJSONProvider
from repositories.cart import CartRepository
from repositories.checkout import CheckoutRepository
from repositories.products import ProductRepository
from routes.cart import cart_blueprint
from routes.checkout import checkout_blueprint
from routes.products import products_blueprint
from services.cart import CartService
from services.checkout import CheckoutService


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings if settings is not None else Settings.from_env()
    app = Flask(__name__, static_folder=None)
    app.json = ExplicitJSONProvider(app)
    app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # Room for a 3 MiB base64 image plus JSON.
    app.extensions["settings"] = settings
    app.extensions["cognito_verifier"] = CognitoVerifier(settings)
    app.extensions["product_repository"] = ProductRepository(settings)
    app.extensions["cart_repository"] = CartRepository(settings)
    app.extensions["cart_service"] = CartService(
        app.extensions["cart_repository"], app.extensions["product_repository"],
    )
    app.extensions["checkout_repository"] = CheckoutRepository(settings)
    app.extensions["checkout_service"] = CheckoutService(
        app.extensions["cart_repository"], app.extensions["product_repository"],
        app.extensions["checkout_repository"],
    )
    register_error_handlers(app)
    app.register_blueprint(products_blueprint)
    app.register_blueprint(cart_blueprint)
    app.register_blueprint(checkout_blueprint)

    @app.before_request
    def preflight():
        if request.method == "OPTIONS":
            return app.response_class(status=204)

    @app.after_request
    def cors(response):
        origin = request.headers.get("Origin")
        response.vary.add("Origin")
        if origin in settings.allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        return response

    return app
