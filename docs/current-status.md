# Current Backend Status

Last reviewed: 2026-09-14, against the local backend source and checks below.
This records repository implementation status; live AWS state has not been
verified as part of this review.

## Implementation Summary

The backend foundation and all five product CRUD operations are implemented in
the repository. Product reads are public; product writes require a verified
Cognito ID token and exact `admins` group membership. Cart, checkout, orders,
and upload operations remain unimplemented. CORS OPTIONS requests return 204,
which is not a functional business API operation.

The contract defines 12 operations, including 4 POST operations. Five operations
are implemented, including one POST; seven operations remain. The assignment's
minimum of 10 functional operations and 3 POST operations is not yet met, and
live operation of the implemented APIs still requires manual verification.

| Area | Current code | Remaining work |
| --- | --- | --- |
| Flask / Lambda | Application factory, cached WSGI application, REST proxy adapter, and five product routes. | Implement cart, checkout, order, and upload routes. |
| Configuration | Pydantic settings, backend-local dotenv loading, required resource names, exact CORS origins. | Verify resource identifiers and configure deployment values. |
| Authentication | Cognito verifier and `require_admin` applied to POST/PUT/DELETE products. | Verify real tokens/groups; apply ownership helpers to future cart/order routes. |
| API models | Product models wired into CRUD; cart, checkout, order, and upload contracts available. | Implement remaining operations using their models. |
| HTTP handling | Product routes use explicit validation / serialization and JSON errors; CORS and body limit retained. | Align legacy application tests and integrate remaining routes. |
| DynamoDB / checkout | Product repository with paginated reads, conditional writes, and explicit response mapping. | Real AWS verification, cart/order repositories, and checkout transaction; the 40-line limit is still only a constant. |
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

## Implemented Product Operations

| Operation | Access | Success response |
| --- | --- | --- |
| `GET /products` | Public | 200 `{ "count": number, "products": Product[] }`. |
| `GET /products/:id` | Public | 200 Product. |
| `POST /products` | Cognito `admins` | 201 created Product. |
| `PUT /products/:id` | Cognito `admins` | 200 updated Product. |
| `DELETE /products/:id` | Cognito `admins` | 200 `{ "deleted": "<product-id>" }`. |

- [routes/products.py](../backend/routes/products.py) handles HTTP concerns;
  [repositories/products.py](../backend/repositories/products.py) owns DynamoDB
  access and Product mapping. The existing GET functions remain unchanged.
- `PRODUCTS_TABLE` selects the existing product table (configured convention:
  `Paperbound-Products`, string partition key `id`). No new table or index is
  introduced. Application startup does not create an SDK resource or contact AWS.
- Lists scan every DynamoDB page using `LastEvaluatedKey` / `ExclusiveStartKey`
  and return the complete matching set. Category equality and substring search
  across title/author/ISBN are case-insensitive and combine with AND. Empty
  filters are ignored; duplicate category/search parameters return 400. Sorting
  and pagination remain frontend-side. GET reads retain eventual consistency.
- Create uses `ProductCreate` defaults and a server-generated `bk-` plus full
  UUID4 hex ID. `PutItem` requires that ID to be absent, preventing overwrite;
  a collision returns 409. `id` and unknown/identity fields are rejected in
  create/update request bodies.
- Update uses `ProductUpdate.changes()` and a strongly consistent read. It sets
  only supplied fields; omitted fields stay unchanged. Empty updates return the
  existing Product without a write. When title, author, or ISBN is supplied,
  storage-only `searchText` is recomputed from all three normalized fields.
- Update conditions require existence and unchanged raw values for fields being
  replaced, plus all three search fields when rebuilding `searchText`. Changes
  to those values during the read/write window produce 409; unrelated concurrent
  edits are preserved. The failed-write `ALL_OLD` snapshot distinguishes a
  deleted record (404) from a conflict (409) and is never exposed to clients.
  Successful updates map `ALL_NEW` into the Product response.
- These conditions do not detect a stale frontend form before the request
  starts. There is no client version field, and the current admin form submits
  all writable fields, including price and stock.
- Delete conditionally removes only the product record and never scans carts.
  Missing products on GET-detail/PUT/DELETE return 404
  `{ "message": "Product not found." }`. Lazy cleanup of stale cart references
  belongs to the future cart implementation.
- Responses deliberately map only the ten documented Product fields, excluding
  `searchText` and other storage attributes. Stock/year Decimal values are checked
  for finite integers before conversion; price remains Decimal in Python-mode
  writes and becomes a JSON number via `api_response()`. All stored response
  fields are required; malformed stored data and unexpected SDK errors produce
  the existing safe 500 envelope.

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
- Product write routes use the existing `require_admin` decorator. Authentication
  runs before body validation and DynamoDB access: missing/invalid tokens return
  401; authenticated non-admin users return 403. Public GET routes have no auth
  decorator. Client-supplied identity headers or fields cannot grant permissions.
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
- Product create/update routes use `parse_json_request(RequestModel)`; responses use
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

- Cart mutations, checkout, order history, and upload must follow
  [api-contract.md](api-contract.md). Models alone do not implement these
  operations or enforce resource ownership in persistence.
- Keep Paperbound-Products (id), Paperbound-Carts (userId/productId), and
  Paperbound-Orders (userId/placedAtOrderId), including existing product indexes.
- Initially reference existing DynamoDB, S3, and Cognito resources through configuration.
  Do not provision replacements before separate verification of actual AWS state.
- Checkout must use one DynamoDB transaction, with at most 40 unique cart lines.
  The current constant does not enforce that limit; stock checks, total
  calculation, order creation, and cart-line deletion are not implemented.
- No cart revision fields or checkout idempotency keys in version one.
- Deleted products must be omitted/lazily cleaned from carts; no scan of all user carts.
- Uploads must accept filename/dataUrl, allow JPEG/PNG/WebP up to 3 MiB decoded,
  upload to S3, and return { url, s3Key }; no presigned upload workflow.

## Validation Results

Lightweight local validation on 2026-09-14, after implementing admin writes:

- Environment: Windows, Python 3.13.2, boto3 1.43.92.
- Production syntax/compilation checks passed, including Python 3.12 grammar.
  Imports and `create_app()` succeeded with network connections blocked and
  explicit placeholder settings that bypass `.env` loading.
- Flask route-map inspection confirmed all five product operations. No route
  handlers were invoked and no DynamoDB reads/writes were performed.
- Static inspection confirmed administrator decorators on all three writes,
  existing model/HTTP helpers, and unchanged GET implementations.
- The installed botocore service model supports the configured conditional
  PutItem/UpdateItem/DeleteItem parameters, `ALL_NEW`, and `ALL_OLD` on condition
  failure, including the returned `Item` field. This is an SDK schema check,
  not proof of live conditional-write behavior.
- Dependency consistency (`pip check`) passed. Configuration inspection confirmed
  the environment-driven product table name, Python 3.12 runtime, and absence
  of application data-access IAM grants in `serverless.yml`.
- No new tests were created and no test suite was run. The earlier foundation
  test results are not evidence for these product operations. Existing application
  tests still assume unregistered product routes and the old direct
  `model_validate()` / `jsonify(model)` boundary; they require later alignment.
- Python 3.12 runtime execution, Lambda packaging, real Cognito, DynamoDB, and
  end-to-end HTTP behavior remain unverified.

## Remaining Integration / Deployment Work

- Implement cart/order/upload routes, their repositories/services, and checkout logic.
- Align the legacy application test with the current HTTP helpers and add
  appropriate coverage as resource endpoints are implemented.
- Verify existing AWS resources separately when authorized; record actual resource
  identifiers and confirm S3/CloudFront asset delivery strategy.
- Verify the execution role can use `dynamodb:Scan`, `dynamodb:GetItem`,
  `dynamodb:PutItem`, `dynamodb:UpdateItem`, and `dynamodb:DeleteItem` on the
  configured existing product table. `serverless.yml` currently grants no
  application data-access permissions. IAM/infrastructure changes were not made
  and require separate authorization; future S3 permissions are also pending.
- Validate packaging for Python 3.12 / x86_64 and the declared Serverless v4
  setup (`package.json`: `^4.22.0`; `dockerizePip: non-linux`). Packaging and
  deployment were not run during this review.
- Configure deployment-specific values, including allowed frontend CORS origins.
- Coordinate frontend adoption of the agreed Bearer header; current code sends
  a raw token and therefore cannot authenticate its new admin product calls.
- Using Postman or an equivalent client, manually verify valid admin/non-admin
  Cognito tokens and missing/invalid tokens; create defaults and field validation;
  partial updates, explicit null/zero values, missing products, and deletion.
  Inspect stored `searchText`, numeric fields, and responses for storage-field
  leakage. Verify concurrent update/delete conflicts and full GET results against
  the existing table. No such live requests were made in this task.
- Frontend upload UI currently limits files to 2 MiB and offers image/*; the backend
  upload request model enforces the confirmed 3 MiB JPEG/PNG/WebP declaration
  rules, but the upload endpoint is still absent.
- After an authorized deployment, verify the API directly using curl, Postman,
  or an equivalent HTTP client and record evidence of functional operations.

No live AWS inspection or deployment was performed for this documentation review.
