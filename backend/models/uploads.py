import base64
import binascii
import re

from pydantic import field_validator

from models.common import Contract, NonEmptyText, Text

MAX_UPLOAD_BYTES = 3 * 1024 * 1024
MAX_BASE64_LENGTH = 4 * ((MAX_UPLOAD_BYTES + 2) // 3)
DATA_URL = re.compile(r"data:(image/jpeg|image/png|image/webp);base64,([A-Za-z0-9+/]*={0,2})")


class UploadRequest(Contract):
    filename: NonEmptyText
    dataUrl: Text

    @field_validator("dataUrl")
    @classmethod
    def validate_data_url(cls, value):
        if len(value) > MAX_BASE64_LENGTH + 32:
            raise ValueError("Decoded upload must not exceed 3 MiB")
        match = DATA_URL.fullmatch(value)
        if match is None:
            raise ValueError("Expected a base64 JPEG, PNG, or WebP data URL")
        try:
            content = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Invalid base64 image data") from error
        if not content or len(content) > MAX_UPLOAD_BYTES:
            raise ValueError("Image must contain from 1 byte through 3 MiB")
        return value


class UploadResponse(Contract):
    url: NonEmptyText
    s3Key: NonEmptyText
