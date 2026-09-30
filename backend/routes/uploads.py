"""Admin-only cover image upload to S3."""

from flask import Blueprint, current_app

from auth.decorators import require_admin
from http_helpers import api_response, parse_json_request
from models.uploads import UploadRequest

uploads_blueprint = Blueprint("uploads", __name__)


@uploads_blueprint.post("/upload_file")
@require_admin
def upload_file():
    payload = parse_json_request(UploadRequest)
    return api_response(current_app.extensions["upload_service"].upload(payload), status=201)
