"""S3 writes for uploaded cover images under the publicly readable covers/ prefix."""

from boto3.session import Session

from config import Settings


class UploadRepository:
    def __init__(self, settings: Settings):
        self._region = settings.aws_region
        self._bucket = settings.uploads_bucket

    def put_image(self, key: str, content: bytes, content_type: str) -> str:
        # Lambda's execution role supplies credentials; no keys in source.
        Session().client("s3", region_name=self._region).put_object(
            Bucket=self._bucket, Key=key, Body=content, ContentType=content_type,
            CacheControl="public,max-age=31536000,immutable",
        )
        return f"https://{self._bucket}.s3.{self._region}.amazonaws.com/{key}"
