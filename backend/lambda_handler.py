"""One WSGI application per warm Lambda execution environment."""

from functools import lru_cache

import serverless_wsgi

from app import create_app


@lru_cache(maxsize=1)
def get_application():
    return create_app()


def handler(event, context):
    return serverless_wsgi.handle_request(get_application(), event, context)
