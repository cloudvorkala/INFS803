"""One error envelope for application, validation and HTTP errors."""

from flask import current_app, jsonify
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def application_error(error):
        return jsonify(message=error.message), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        response = error.get_response()
        response.set_data(current_app.json.dumps({"message": error.description}))
        response.content_type = "application/json"
        return response

    @app.errorhandler(Exception)
    def unexpected_error(error):
        # Includes internal/domain/response ValidationErrors. Only client-body
        # validation in parse_json_request() is explicitly translated to 400.
        current_app.logger.exception("Unhandled backend error")
        return jsonify(message="An unexpected backend error occurred."), 500
