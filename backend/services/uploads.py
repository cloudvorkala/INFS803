"""Decode a validated data URL, confirm real image content, and store it in S3."""

import base64
from uuid import uuid4

from errors import ApiError
from models.uploads import DATA_URL, UploadRequest, UploadResponse
from repositories.uploads import UploadRepository

EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _matches_declared_type(content: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return False


class UploadService:
    def __init__(self, uploads: UploadRepository):
        self._uploads = uploads

    def upload(self, payload: UploadRequest) -> UploadResponse:
        # UploadRequest already enforced the MIME allow-list, base64 and 3 MiB limit.
        match = DATA_URL.fullmatch(payload.dataUrl)
        content_type = match.group(1)
        content = base64.b64decode(match.group(2), validate=True)
        if not _matches_declared_type(content, content_type):
            raise ApiError(400, "File content does not match a JPEG, PNG, or WebP image.")
        # Server-generated key: the client filename never becomes part of the S3 path.
        key = f"covers/uploads/img-{uuid4().hex}.{EXTENSIONS[content_type]}"
        url = self._uploads.put_image(key, content, content_type)
        return UploadResponse(url=url, s3Key=key)
