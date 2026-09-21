import pytest
from pydantic import ValidationError

from config import Settings


ENV = {
    "COGNITO_USER_POOL_ID": "ap-southeast-2_TestPool", "COGNITO_APP_CLIENT_ID": "client",
    "PRODUCTS_TABLE": "Paperbound-Products", "CARTS_TABLE": "Paperbound-Carts",
    "ORDERS_TABLE": "Paperbound-Orders", "UPLOADS_BUCKET": "test-covers",
}


def test_environment_loading():
    settings = Settings.from_env({**ENV, "ALLOWED_ORIGINS": "http://localhost:5173, https://shop.example", "JWKS_CACHE_SECONDS": "60"})
    assert settings.aws_region == "ap-southeast-2"
    assert settings.allowed_origins == ("http://localhost:5173", "https://shop.example")
    assert settings.jwks_cache_seconds == 60


@pytest.mark.parametrize("key", list(ENV))
def test_required_configuration(key):
    for value in (None, "", "  "):
        env = ENV.copy()
        if value is None:
            del env[key]
        else:
            env[key] = value
        with pytest.raises(ValidationError):
            Settings.from_env(env)


@pytest.mark.parametrize("extra", [
    {"COGNITO_USER_POOL_ID": "us-east-1_WrongRegion"}, {"JWKS_CACHE_SECONDS": "0"},
    {"AWS_REGION": "ap-southeast-2.attacker.example"},
    {"JWKS_TIMEOUT_SECONDS": "0"}, {"ALLOWED_ORIGINS": "*"},
    {"ALLOWED_ORIGINS": "https://shop.example/path"}, {"ALLOWED_ORIGINS": "https://user:pass@shop.example"},
])
def test_invalid_configuration(extra):
    with pytest.raises(ValidationError):
        Settings.from_env({**ENV, **extra})
