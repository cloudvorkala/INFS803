# Current Backend Status

Last reviewed: 2026-09-11, against the local backend source and checks below.
This records repository implementation status; live AWS state has not been
verified as part of this review.

## Implementation Summary

The backend foundation is implemented. Business REST endpoints and cloud data
access are not implemented yet. `create_app()` registers no resource routes;
all 12 contracted operations currently return JSON 404 responses. CORS OPTIONS
requests return 204, which is not a functional business API operation.

The contract defines 12 operations, including 4 POST operations. The current
backend therefore does not yet meet the assignment's requirement for at least
10 functional REST operations and at least 3 functional POST operations.

| Area | Current code | Remaining work |
| --- | --- | --- |
| Flask / Lambda | Application factory, cached WSGI application, REST proxy adapter. | Register product, cart, checkout, order, and upload routes. |
| Configuration | Pydantic settings, backend-local dotenv loading, required resource names, exact CORS origins. | Verify resource identifiers and configure deployment values. |
| Authentication | Cognito verifier, `require_auth`, `require_admin`, and verified-user helper. | Apply helpers to business routes and verify against the real User Pool. |
| API models | Product, cart, shipping address, checkout, order, and upload request/response contracts. | Map repository results into response models and implement business rules. |
| HTTP handling | Explicit request validation / response serialization, JSON errors, CORS, 5 MiB request-body limit. | Use the helpers in routes and align the legacy application test. |
| DynamoDB / checkout | Resource names in settings; `MAX_CHECKOUT_LINES = 40` declared. | Repositories, persistence, ownership-scoped queries, stock checks, and checkout transaction. |
| S3 uploads | MIME declaration, strict base64, non-empty decoded data, and 3 MiB size validation in the request model. | Actual image-content validation, S3 writes, object keys, and usable asset URLs. |
| Deployment | Initial `serverless.yml` and Serverless dependency declaration. | Application data-access IAM, packaging validation, authorized deployment, and live API checks. |

## Confirmed Target

- Assignment option: Option B.
- Backend-only development scope.
- Frontend is developed by another team member.
- AWS serverless backend architecture.
- REST API Gateway.
- One Lambda + Python 3.12 + Flask + serverless-wsgi.
- API Gateway proxy routes: ANY / and ANY /{proxy+}; Flask owns application routing.
- Default AWS region: ap-southeast-2, unless existing infrastructure requires otherwise.
- DynamoDB.
- S3.
- Cognito.
- Serverless Framework.
- Pydantic validation.
- [API contract](api-contract.md) defines 12 REST API operations, including 4 POST operations.

## Implemented Foundation

### Configuration and local execution

- `Settings.from_env()` in [config.py](../backend/config.py) loads `backend/.env`
  relative to the module, independently of the shell's working directory.
  Existing process environment values take precedence. An explicit environment
  mapping bypasses dotenv loading.
- Required configuration: `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`,
  `PRODUCTS_TABLE`, `CARTS_TABLE`, `ORDERS_TABLE`, and `UPLOADS_BUCKET`.
  Region defaults to `ap-southeast-2`; the User Pool ID must match that region.
- `ALLOWED_ORIGINS` is a comma-separated list of exact HTTP(S) origins, with no
  paths or wildcards. Empty configuration allows no browser origins. Allowed
  origins receive CORS headers for `Content-Type, Authorization` and
  `GET, POST, PUT, DELETE, OPTIONS`; responses vary by `Origin`.
- `JWKS_CACHE_SECONDS` defaults to 300 (allowed 1-3600), and
  `JWKS_TIMEOUT_SECONDS` defaults to 3 (greater than 0, at most 10).
- Invalid or missing required configuration fails application creation.
  Startup validates configuration without looking up AWS resources.
- `.env` is excluded from Git and deployment packaging. Use
  [.env.example](../backend/.env.example) for variable names and placeholders;
  it is not evidence of provisioned resources. See the
  [backend README](../backend/README.md) for local setup commands.

### Authentication and authorization

- Frontend authenticates directly with Cognito.
- No custom `/login`, `/register`, `/logout` APIs are planned.
- Backend authentication/authorization helpers are implemented, but no business
  routes exist yet to apply them to protected/admin resources.
- Protected requests use `Authorization: Bearer <Cognito ID token>`.
- Reusable Flask middleware/decorators verify Cognito JWTs using cached JWKS,
  including signature, expiration, issuer, token_use=id, and App Client audience.
- No primary API Gateway Cognito User Pool Authorizer in version one.
- Verified sub determines ownership; verified admins group membership grants admin access.
- The verifier accepts RS256, checks required claims, refreshes JWKS for an
  unknown key ID, and fails closed on invalid tokens or key-service failures.

### Models and HTTP boundaries

- [models/](../backend/models/) contains Pydantic request and response contracts.
  Unknown fields, including client-supplied ownership IDs, are rejected by request
  models. Product updates preserve omitted fields using `changes()` or
  `model_dump(exclude_unset=True)`; only `coverUrl` accepts explicit null.
- Money uses `Decimal` internally and JSON numbers in serialized models.
  Shipping address strings are trimmed and required; upload models validate the
  declared JPEG/PNG/WebP MIME type and decoded size, but do not inspect whether
  the decoded bytes form a real image.
- Future routes must use `parse_json_request(RequestModel)` and
  `api_response(response_model, status=...)` from
  [http_helpers.py](../backend/http_helpers.py). Request-model validation becomes
  400 `{ "message": "..." }` without echoing input values. Domain/response model
  validation failures remain safe 500 responses.
- `api_response()` requires a `Contract` instance and serializes in JSON mode.
  The JSON provider rejects implicit Pydantic model / `Decimal` conversion;
  `jsonify(model)` and `jsonify(model.model_dump())` are not the route convention.
- [errors.py](../backend/errors.py) supplies the JSON `{ "message": "..." }`
  envelope for application errors, HTTP exceptions, and unexpected failures.
  HTTP exceptions retain their status, including 405, 413, and 415. These are
  current framework behaviors, not newly agreed business endpoint success/error
  rules. Non-JSON bodies passed to `parse_json_request()` retain Flask's 415;
  malformed JSON retains 400.

## Confirmed Business Rules Still Awaiting Implementation

- Product CRUD, filtering, cart mutations, checkout, order history, and upload
  must follow [api-contract.md](api-contract.md). Models alone do not implement
  these operations or enforce resource ownership in persistence.
- Keep Paperbound-Products (id), Paperbound-Carts (userId/productId), and
  Paperbound-Orders (userId/placedAtOrderId), including existing product indexes.
- Initially reference existing DynamoDB, S3, and Cognito resources through configuration.
  Do not provision replacements before separate verification of actual AWS state.
- Checkout must use one DynamoDB transaction, with at most 40 unique cart lines.
  The current constant does not enforce that limit; stock checks, total
  calculation, order creation, and cart-line deletion are not implemented.
- No cart revision fields or checkout idempotency keys in version one.
- Deleted products must be omitted/lazily cleaned from carts; no scan of all user carts.
- Catalogue search must return all matching products; pagination remains frontend-side.
- Uploads must accept filename/dataUrl, allow JPEG/PNG/WebP up to 3 MiB decoded,
  upload to S3, and return { url, s3Key }; no presigned upload workflow.

## Validation Results

Run on 2026-09-11 from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

- Environment: Windows, Python 3.13.2, pytest 9.1.1.
- Result: **136 passed, 1 failed** (137 collected).
- Failure: `tests/test_app.py::test_foundation_errors_and_cors` expects 400 but
  receives 500. Its temporary route calls `ProductCreate.model_validate()`
  directly instead of `parse_json_request()`, so the error reaches the internal
  exception handler. The same test still attempts direct `jsonify(model)`;
  that assertion is not reached and also uses the old serialization boundary.
  The test remains unresolved in this documentation update.
- Additional in-memory smoke checks passed: no registered application routes;
  JSON 404 for all 12 resource operations; OPTIONS `/cart` returns 204; a
  temporary route using the current HTTP helpers returns 400 for invalid input,
  200 with numeric money for valid input, and 415 for an unsupported content type.
  Temporary smoke routes were not added to the application source.
- The unit tests block network access and use local RSA keys / substituted JWKS
  transport. These checks do not verify real Cognito, DynamoDB, S3, or a deployed API.
- The configured Lambda runtime is Python 3.12; this run on Python 3.13.2 does
  not establish Python 3.12 or Lambda packaging compatibility.

## Remaining Integration / Deployment Work

- Implement the business routes, repositories/services, and checkout domain logic.
- Align the legacy application test with the current HTTP helpers and add
  appropriate coverage as resource endpoints are implemented.
- Verify existing AWS resources separately when authorized; record actual resource
  identifiers and confirm S3/CloudFront asset delivery strategy.
- Add least-privilege DynamoDB/S3 permissions when implementing AWS access.
  `serverless.yml` currently grants no application data-access permissions and
  declares no replacement tables, buckets, or User Pools.
- Validate packaging for Python 3.12 / x86_64 and the declared Serverless v4
  setup (`package.json`: `^4.22.0`; `dockerizePip: non-linux`). Packaging and
  deployment were not run during this review.
- Configure deployment-specific values, including allowed frontend CORS origins.
- Coordinate frontend adoption of the agreed Bearer header; current code sends a raw token.
- Frontend upload UI currently limits files to 2 MiB and offers image/*; the backend
  upload request model enforces the confirmed 3 MiB JPEG/PNG/WebP declaration
  rules, but the upload endpoint is still absent.
- After an authorized deployment, verify the API directly using curl, Postman,
  or an equivalent HTTP client and record evidence of functional operations.

No live AWS inspection or deployment was performed for this documentation review.
