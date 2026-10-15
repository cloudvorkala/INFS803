from app import create_app
from errors import ApiError
from http_helpers import api_response, parse_json_request
from models.products import ProductCreate


def test_foundation_errors_and_cors(settings):
    app = create_app(settings)
    @app.post("/test-validation")
    def validate():
        # Same boundary as the real routes: client-body errors become 400, responses use api_response().
        return api_response(parse_json_request(ProductCreate))
    @app.get("/test-failure")
    def fail():
        raise RuntimeError("private implementation details")
    @app.get("/test-conflict")
    def conflict():
        raise ApiError(409, "Stock changed.")

    client = app.test_client()
    # An unregistered route exercises the shared 404 envelope and CORS without AWS access.
    response = client.get("/no-such-route", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 404
    assert set(response.json) == {"message"}
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "Access-Control-Allow-Origin" not in client.get("/no-such-route", headers={"Origin": "https://untrusted.example"}).headers
    assert client.options("/cart").status_code == 204
    response = client.post("/test-validation", json={"title": "secret-value"})
    assert response.status_code == 400
    assert "secret-value" not in response.json["message"]
    assert client.post("/test-validation", data="{", content_type="application/json").status_code == 400
    assert client.get("/test-validation").status_code == 405
    assert client.get("/test-conflict").json == {"message": "Stock changed."}
    response = client.get("/test-failure")
    assert response.status_code == 500
    assert "private implementation" not in response.json["message"]
    response = client.post("/test-validation", json={"title": "Book", "author": "Writer", "category": "Poetry", "price": 2.5})
    assert response.status_code == 200
    assert response.json["price"] == 2.5


def test_wsgi_rest_proxy(settings, monkeypatch):
    import lambda_handler
    monkeypatch.setattr(lambda_handler, "get_application", lambda: create_app(settings))
    event = {
        "httpMethod": "GET", "path": "/no-such-route", "resource": "/{proxy+}",
        "headers": {"Host": "local.example", "X-Forwarded-Proto": "https"},
        "requestContext": {"stage": "dev", "identity": {"sourceIp": "127.0.0.1"}},
        "queryStringParameters": None, "body": None, "isBase64Encoded": False,
    }
    response = lambda_handler.handler(event, None)
    assert response["statusCode"] == 404
    assert '"message"' in response["body"]
