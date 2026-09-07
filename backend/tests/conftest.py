import socket
import urllib.request

import pytest

from config import Settings


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Unit tests must not access the network")
    monkeypatch.setattr(urllib.request, "urlopen", blocked)
    monkeypatch.setattr(socket.socket, "connect", blocked)


@pytest.fixture
def settings():
    return Settings(
        cognito_user_pool_id="ap-southeast-2_TestPool",
        cognito_app_client_id="test-app-client",
        products_table="Paperbound-Products",
        carts_table="Paperbound-Carts",
        orders_table="Paperbound-Orders",
        uploads_bucket="test-covers",
        allowed_origins=("http://localhost:5173",),
    )
