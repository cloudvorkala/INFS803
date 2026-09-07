import io
import json
import time
import urllib.error

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import create_app
from auth.cognito import CognitoVerifier, parse_bearer_header
from auth.decorators import authenticated_user_id, is_admin, require_admin, require_auth
from errors import ApiError


@pytest.fixture(scope="module")
def keys():
    return [rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(2)]


def public_jwk(key, kid):
    return {**jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True), "kid": kid, "use": "sig", "alg": "RS256"}


@pytest.fixture
def jwks_transport(monkeypatch, keys):
    state = {"keys": [public_jwk(keys[0], "key-1")], "calls": 0, "fail": False}
    def urlopen(request, **kwargs):
        state["calls"] += 1
        assert request.full_url == "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_TestPool/.well-known/jwks.json"
        if state["fail"]:
            raise urllib.error.URLError("offline")
        return io.BytesIO(json.dumps({"keys": state["keys"]}).encode())
    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    return state


def token_for(settings, key, changes=None, remove=None, kid="key-1"):
    claims = {"sub": "owner", "iss": settings.cognito_issuer, "aud": settings.cognito_app_client_id,
              "exp": int(time.time()) + 600, "iat": int(time.time()), "token_use": "id"}
    claims.update(changes or {})
    if remove:
        del claims[remove]
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})


def test_bearer_parser():
    assert parse_bearer_header("Bearer abc.def.ghi") == "abc.def.ghi"


@pytest.mark.parametrize("header", [None, "", "abc.def.ghi", "bearer abc.def.ghi", "Basic abc", "Bearer", "Bearer ", "Bearer  abc.def.ghi", "Bearer abc.def.ghi ", "Bearer abc.def.", "Bearer abc.def.ghi\n", "Bearer abc.def.ghi,other"])
def test_invalid_bearer_header(header):
    with pytest.raises(ApiError) as error:
        parse_bearer_header(header)
    assert error.value.status == 401


def test_verification_cache_and_rotation(settings, keys, jwks_transport):
    verifier = CognitoVerifier(settings)
    token = token_for(settings, keys[0])
    assert verifier.verify(token)["sub"] == "owner"
    verifier.verify(token)
    assert jwks_transport["calls"] == 1
    jwks_transport["keys"] = [public_jwk(keys[1], "key-2")]
    assert verifier.verify(token_for(settings, keys[1], kid="key-2"))["sub"] == "owner"
    assert jwks_transport["calls"] == 2


@pytest.mark.parametrize("changes", [
    {"exp": 1}, {"iss": "https://attacker.example"}, {"aud": "wrong-client"},
    {"aud": ["test-app-client"]}, {"token_use": "access"}, {"sub": ""},
    {"sub": "  "}, {"sub": 123}, {"exp": "9999999999"}, {"exp": True},
])
def test_bad_claims(settings, keys, jwks_transport, changes):
    with pytest.raises(ApiError) as error:
        CognitoVerifier(settings).verify(token_for(settings, keys[0], changes))
    assert error.value.status == 401


@pytest.mark.parametrize("claim", ["exp", "iss", "aud", "sub", "token_use"])
def test_missing_required_claim(settings, keys, jwks_transport, claim):
    with pytest.raises(ApiError):
        CognitoVerifier(settings).verify(token_for(settings, keys[0], remove=claim))


def test_signature_unknown_key_and_algorithm_failures(settings, keys, jwks_transport):
    verifier = CognitoVerifier(settings)
    invalid = [
        token_for(settings, keys[1]),
        token_for(settings, keys[0], kid="unknown"),
        jwt.encode({"sub": "owner"}, "x" * 32, algorithm="HS256", headers={"kid": "key-1"}),
        jwt.encode({"sub": "owner"}, "", algorithm="none"),
        "abc.def.ghi",
    ]
    for token in invalid:
        with pytest.raises(ApiError) as error:
            verifier.verify(token)
        assert error.value.status == 401


def test_unavailable_or_empty_jwks_fail_closed(settings, keys, jwks_transport):
    jwks_transport["fail"] = True
    with pytest.raises(ApiError):
        CognitoVerifier(settings).verify(token_for(settings, keys[0]))
    jwks_transport.update(fail=False, keys=[])
    with pytest.raises(ApiError):
        CognitoVerifier(settings).verify(token_for(settings, keys[0]))


@pytest.mark.parametrize("malformed_keys", [[None], [123], {"kid": "key-1"}])
def test_malformed_jwks_fail_closed(settings, keys, jwks_transport, malformed_keys):
    jwks_transport["keys"] = malformed_keys
    with pytest.raises(ApiError) as error:
        CognitoVerifier(settings).verify(token_for(settings, keys[0]))
    assert error.value.status == 401


@pytest.mark.parametrize("groups,expected", [
    (["admins"], True), (["readers", "admins"], True), (["admin"], False),
    (["Admins"], False), (["superadmins"], False), ("admins", False),
    (None, False), ({"admins": True}, False), (["admins", 1], False), ([], False),
])
def test_exact_admin_membership(groups, expected):
    assert is_admin({"cognito:groups": groups}) is expected


def test_decorators_use_verified_sub_only(settings, keys, jwks_transport):
    app = create_app(settings)
    @app.post("/test-owner")
    @require_auth
    def owner():
        return {"userId": authenticated_user_id()}
    @app.get("/test-admin")
    @require_admin
    def admin():
        return {"userId": authenticated_user_id()}
    client = app.test_client()
    token = token_for(settings, keys[0])
    headers = {"Authorization": f"Bearer {token}", "X-User-Id": "attacker"}
    assert client.post("/test-owner?userId=attacker", headers=headers, json={"userId": "attacker"}).json == {"userId": "owner"}
    assert client.get("/test-admin", headers=headers).status_code == 403
    assert client.post("/test-owner").status_code == 401
    admin_token = token_for(settings, keys[0], {"cognito:groups": ["admins"]})
    assert client.get("/test-admin", headers={"Authorization": f"Bearer {admin_token}"}).status_code == 200
    # Context is request-local: a previous successful request does not authenticate the next.
    assert client.get("/test-admin").status_code == 401
