"""Application factory. Future routes use the boundaries in http_helpers.py."""

from flask import Flask, request

from auth.cognito import CognitoVerifier
from config import Settings
from errors import register_error_handlers
from http_helpers import ExplicitJSONProvider


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings if settings is not None else Settings.from_env()
    app = Flask(__name__, static_folder=None)
    app.json = ExplicitJSONProvider(app)
    app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # Room for a 3 MiB base64 image plus JSON.
    app.extensions["settings"] = settings
    app.extensions["cognito_verifier"] = CognitoVerifier(settings)
    register_error_handlers(app)

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
