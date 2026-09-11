# Paperbound backend

The backend supplies Flask scaffolding, configuration, Cognito authentication,
Pydantic contracts, JSON errors, CORS, and initial Serverless configuration.
Public `GET /products` and `GET /products/:id` routes read the configured existing
DynamoDB product table. Product writes, cart/order endpoints, checkout logic,
and S3 writes are not implemented.

## Product reads

`routes/products.py` handles HTTP queries, response envelopes, and missing-product
404s. `repositories/products.py` owns SDK access, filtering, and explicit mapping
into the existing `Product` response model. `app.py` registers the blueprint and
repository. Creating the app does not create an SDK session or contact DynamoDB.

- `GET /products` returns 200 `{ "count": number, "products": Product[] }`.
  Optional `category` matches the complete category without case sensitivity;
  optional `search` matches a substring of title, author, or ISBN without case
  sensitivity. Both filters must match when supplied together. Query values are
  trimmed, and empty values mean no filter. Repeated `category` or `search`
  parameters return 400; unrelated query parameters are ignored.
- The repository scans every page of `PRODUCTS_TABLE`, using each
  `LastEvaluatedKey` as the next `ExclusiveStartKey`. All matching products are
  returned, including an empty array/count 0 when nothing matches. There are no
  API pagination fields or new indexes. Scan order is not a guaranteed sort order;
  the frontend continues to sort and paginate the complete result locally.
- `GET /products/:id` uses `GetItem` with the string partition key `id`.
  Found items return 200 with the Product object directly. An absent item returns
  404 `{ "message": "Product not found." }`. Both reads use the SDK's default
  eventual consistency.
- Both routes are public and do not invoke Cognito verification, including when
  a caller happens to send an Authorization header. Existing CORS rules apply.
- Mapping selects only the ten documented Product fields, excluding `searchText`
  and other storage attributes. All ten stored fields are required; creation
  defaults are not used to mask incomplete stored records. Integral, finite
  DynamoDB `Decimal` stock/year values convert to `int` without truncation, then
  pass the existing model's range validation. Price remains validated `Decimal`
  internally and is serialized as a JSON number by `api_response()`.
- Invalid stored data and DynamoDB/backend exceptions reach the existing safe
  500 `{ "message": "An unexpected backend error occurred." }` handler. A missing
  table or denied AWS permission is a backend failure, not a product 404.

The table name and region come from `Settings` (`PRODUCTS_TABLE=Paperbound-Products`
and the configured `AWS_REGION`). The repository uses the default AWS credential
chain; Lambda must use its execution role. It never creates a table or index.
The current Serverless configuration still has no application data-access IAM
grants. Actual reads require `dynamodb:Scan` and `dynamodb:GetItem` on the existing
product table; any IAM/infrastructure change or deployment needs separate authorization.

The frontend's `listProducts()` / `getProduct()` bindings already use these paths
and response shapes. Its query builder omits the `All` category sentinel; the
backend does not reserve a category name. Prices support the frontend's
`toFixed(2)` usage, and searching by author supports detail-page related books.
Real frontend integration still needs the correct API base URL and allowed CORS
origin. Frontend files are unchanged.

This feature was limited to syntax/import, route-registration, and static/config
validation; no new test suite or live AWS verification is included. Existing
foundation tests that expect `/products` to be unregistered now need updating
before they can validate the business implementation.

## Local setup

From this directory, create a Python 3.12 virtual environment and install:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
```

The tests generate RSA keys locally and replace JWKS HTTP transport. Network
access is blocked by an autouse fixture; no AWS credentials or resources are used.

Fill in `backend/.env` using `.env.example` as a reference, then run:

```powershell
.\.venv\Scripts\python.exe -m flask --app app:create_app run
```

`Settings.from_env()` loads `.env` beside `config.py` using python-dotenv,
regardless of the current working directory. Existing process environment
variables take precedence; the file supplies only missing values. An explicit
`Settings.from_env(environ=...)` mapping bypasses dotenv for isolated callers.
The file remains excluded from Git and deployment packaging. Missing/invalid required
configuration fails at application creation; existing resource names are required
but are never looked up during startup. Empty ALLOWED_ORIGINS permits no browser
origins. The final asset-delivery URL setting is deferred until infrastructure is verified.

## Contracts and authentication

`models/` follows `../docs/api-contract.md`. Product updates use `changes()` or
`model_dump(exclude_unset=True)` so omitted fields remain unchanged; only coverUrl
accepts explicit null. Monetary values remain Decimal internally and serialize
as JSON numbers through the HTTP response helper below. Request models reject
unknown fields, including ownership IDs.
Cart add quantities are positive integers (default 1); cart update quantities are
non-negative integers. The 40-line checkout limit is declared for later domain code;
it is not enforced on cart reads or historical order lists.

### HTTP boundaries for future routes

Use `parse_json_request(RequestModel)` from `http_helpers.py` for client JSON.
It converts Pydantic failures only at this request-validation boundary into
400 `{ "message": "..." }` responses, without echoing input values. Malformed
JSON retains Flask's 400 handling; unsupported content types retain its 415
handling. Construct domain/response models separately: their ValidationErrors
are server-side failures and receive the safe 500 envelope.

Return `api_response(response_model, status=200)` (or the contract's 201 status).
The helper requires a Contract instance and always calls
`model_dump(mode="json")`, preserving field-specific serializers for nested
money and dates. Map repository data into the appropriate API response model
before calling it. Raw dictionaries are not accepted by the helper.

Do not use `jsonify(model)` or `jsonify(model.model_dump())`. The JSON provider
rejects implicit Pydantic model and Decimal conversion rather than silently
returning monetary strings. Plain JSON error envelopes continue to work.
The existing foundation test that calls `jsonify(ProductCreate(...))` and relies
on global validation-to-400 handling reflects the old boundary; it has not been
updated as part of this task's no-test-change scope.

Use `@require_auth` or `@require_admin` on future routes and
`authenticated_user_id()` for ownership. These helpers accept only the documented
Bearer ID-token convention, validate RS256 signatures and required Cognito claims,
and check exact `admins` membership. JWKS are fetched only during verification,
cached for a bounded lifetime, and refreshed on an unknown key ID. Key-service
failures reject authentication; tokens and claim contents are not returned in errors.

Upload contracts validate the declared JPEG/PNG/WebP MIME type, strict base64,
and decoded 3 MiB limit. Actual image-content inspection and S3 storage belong to
the future upload implementation; this foundation does not claim that arbitrary
bytes declared as an image have been decoded as a real image.

## Deployment configuration (not deployed)

`serverless.yml` declares Python 3.12, Sydney by default, one Lambda, and REST
API proxy events for ANY / and ANY /{proxy+}. `lambda_handler.py` calls the Python
`serverless-wsgi` adapter directly. There is no Gateway authorizer: Flask owns
authentication and routing. No tables, buckets, or pools are declared and no
application data-access IAM permissions are granted in this step.

`package.json` declares Serverless `^4.22.0` (minimum 4.22.0, below 5), meeting
the minimum for the built-in Python requirements integration. No project-local
Serverless installation or lockfile was present when this configuration was
reviewed, so the installed version and actual packaging remain unverified.
`dockerizePip: non-linux` uses Docker on Windows/macOS and native packaging on
Linux. Linux packaging must still use Python 3.12 and dependencies compatible
with the configured Lambda x86_64 runtime; Linux alone does not guarantee that.
No additional Serverless plugin is necessary. A future packaging/deployment check
requires the Node dependency, Docker, and any Framework authentication requirements.
Do not deploy or inspect AWS without separate authorization. Reference:
https://www.serverless.com/framework/docs/providers/aws/guide/python

Frontend integration still requires its owner to adopt the Bearer header. The
frontend currently restricts uploads to 2 MiB and offers more MIME types than the
backend allows. Neither frontend files nor shared project docs are modified here.
