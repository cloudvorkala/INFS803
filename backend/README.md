# Paperbound backend

See the maintained [REST API reference](../docs/api-reference.md) for endpoint
usage, request/response examples, authentication, and verification status.

The backend supplies Flask scaffolding, configuration, Cognito authentication,
Pydantic contracts, JSON errors, CORS, and initial Serverless configuration.
Public `GET /products` and `GET /products/:id` routes read the configured existing
DynamoDB product table. Admin-only `POST /products`, `PUT /products/:id`, and
`DELETE /products/:id` persist product changes in the same table. Authenticated
Cart endpoints and POST /checkout are implemented. All ten Product/Cart/Checkout
operations are deployed to AWS and have passed user-reported testing (2026-09-21).
Authenticated GET /orders and admin-only POST /upload_file (S3) are implemented and
passed Postman testing on a separate `orderstest` stage (2026-09-30); see
[current-status.md](../docs/current-status.md).

## Product reads

`routes/products.py` handles HTTP queries, response envelopes, and missing-product
404s. `repositories/products.py` owns SDK access, filtering, and explicit mapping
into the existing `Product` response model. `app.py` registers the blueprint and
repository. Creating the app does not create an SDK session or contact DynamoDB.

`repositories/dynamodb.py` lazily reuses a Session, DynamoDB resource/table handles,
and their HTTP connection pool per application worker thread. Product, Cart and
Order repositories share that resource; Checkout uses a separate low-level client
so its explicitly serialized transaction values are not converted twice. The
cached Lambda application retains these SDK objects between warm invocations.
Resources are isolated by thread in local Flask execution, following
[boto3's threading guidance](https://docs.aws.amazon.com/boto3/latest/guide/resources.html#multithreading-or-multiprocessing-with-resources).
Only SDK objects are reused: records, stock, credentials copied out of the SDK,
and API responses are not cached. Existing read consistency and write conditions
remain unchanged; role credentials continue through the SDK's provider chain.

Allowed-origin OPTIONS responses advertise a 300-second preflight lifetime,
reducing repeated browser preflights without changing the exact-origin allowlist
or authentication. See the [API reference](../docs/api-reference.md). This does
not remove first-request initialization or the first browser preflight; measure
cold and warm requests separately after deployment before claiming a speedup.

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
The Serverless execution-role configuration grants `dynamodb:Scan` and
`dynamodb:GetItem`, plus the three implemented product write actions, only on
the configured product table. No index is accessed or granted permissions.
Product CRUD and its live IAM permissions have been manually AWS-verified;
Cart and Checkout are also deployed and have passed user-reported AWS testing.
See the API reference for current status.

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

## Admin product writes

All three write routes use the existing `require_admin` decorator. Requests must
send `Authorization: Bearer <Cognito ID token>` with exact `admins` membership
in verified `cognito:groups`. Missing/invalid authentication returns 401 and
authenticated non-admin users receive 403, before request-body parsing or DynamoDB
access. Client identity headers or payload fields do not grant permissions.

- `POST /products` validates through `parse_json_request(ProductCreate)`, applies
  the documented defaults, and generates a `bk-` ID using a full UUID4 hex value.
  A conditional `PutItem` prevents replacing an existing ID; a collision returns
  409. Success returns 201 with the Product response.
- `PUT /products/:id` uses `ProductUpdate.changes()`. After a strongly consistent
  read and stored-data validation, `UpdateItem` sets only supplied fields and,
  when title/author/ISBN are supplied, recomputes `searchText`. Omitted fields and
  other storage attributes remain unchanged. An empty object returns the existing
  Product without writing. Success returns 200 with the mapped `ALL_NEW` record.
- Update conditions require the record to exist and the raw old values of fields
  being replaced to match. When rebuilding `searchText`, all three source fields
  are also checked. Concurrent changes to those fields return 409; a product
  deleted before the write returns 404. `ALL_OLD` on a failed condition is used
  only to distinguish those cases and is never returned to the caller.
- These conditions protect the repository's read/write window. They cannot detect
  stale values in an admin form loaded before this request; the contract has no
  client version field. The frontend currently submits the whole edit form.
- `DELETE /products/:id` conditionally deletes only an existing product and
  returns 200 `{ "deleted": "<product-id>" }`. It does not read or scan carts.
  Missing products on PUT/DELETE return 404 `{ "message": "Product not found." }`.

Writes use Python-mode model dumps so money remains `Decimal` for DynamoDB.
`searchText` joins title, author, and ISBN with case folding and outer whitespace
trimming; the existing GET search continues to search those fields directly.
Responses retain only the ten Product fields and use `api_response()` for numeric
JSON serialization. Request models reject `id`, identity fields, and other unknown
fields. Expected request-validation errors use 400; unexpected SDK/internal
failures use the existing safe 500 envelope.

In addition to read permissions, the execution-role configuration includes
`dynamodb:PutItem`, `dynamodb:UpdateItem`, and `dynamodb:DeleteItem` on the configured
product table. No live resources were changed. The frontend still sends
raw JWTs and must adopt the agreed Bearer header before its admin calls will work.
See `../docs/current-status.md` for the latest validation and manual verification work.

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
non-negative integers. Checkout enforces the 40-line maximum before its atomic
transaction; the limit is not imposed on Cart reads.

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
and decoded 3 MiB limit. `services/uploads.py` additionally checks the file
signature (magic bytes) against the declared type; it does not fully decode images.

## First dev deployment preparation (historical)

The preparation notes below predate the successful manual Product CRUD deployment
verification recorded in [current-status.md](../docs/current-status.md).

`serverless.yml` retains Python 3.12 / x86_64, ap-southeast-2 by default, one
Lambda, and REST API proxy events for ANY / and ANY /{proxy+}.
`lambda_handler.py` calls `serverless-wsgi` directly; Flask owns routing and
authentication. Existing application tables, bucket, and Cognito resources are
only referenced through environment variables and are never declared for creation.

Deployment variable resolution loads the local `.env`; process environment
variables take precedence, and an optional `.env.dev` can affect stage settings.
All application settings are explicitly forwarded to Lambda except `AWS_REGION`:
Lambda supplies that reserved variable from the deployment region. Do not add it
to `provider.environment`. See the
[AWS reserved-variable reference](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html#configuration-envvars-runtime).
The existing exact-origin CORS policy is unchanged; the current local configuration
includes `http://localhost:5173`. No production frontend origin has been invented.

Serverless is pinned to 4.22.0 in both configuration and `package.json`, with
`package-lock.json` for reproducible Node dependency installation. Use the local
CLI: the global `serverless` installation on this machine is v3.40.0. The
[built-in Python integration](https://www.serverless.com/framework/docs/providers/aws/guide/python)
uses Docker for dependency packaging, explicitly selecting
`public.ecr.aws/sam/build-python3.12:latest-x86_64`. The host's Python 3.13 virtual
environment is not packaged or used to build Lambda dependencies. No additional
Serverless plugin or local Python 3.12 installation is required for this Docker
packaging path. Start Docker Desktop with its Linux engine before packaging.

`.env` files, the local virtual environment, tests, Node modules, and Node manifests
are excluded from the Lambda ZIP. The application uploads bucket is not assigned
as a deployment bucket: Serverless manages a separate artifact bucket. The first
deployment may create that bucket and the API/Lambda deployment stack, including
its execution role and logs; it must not recreate application data resources.

From `backend/`, install dependencies on a fresh checkout with `npm.cmd ci`.
Authenticate Serverless v4 with `npx.cmd --no-install serverless login` if needed,
and configure AWS deployment credentials using the normal AWS profile/SSO flow.
Select the intended account/profile in the terminal; never put credentials into
source or `.env`. The deployment identity needs permissions to deploy the stack
and manage Serverless artifacts; the product-only execution policy is for Lambda,
not for the deployer's identity.

When those prerequisites are ready, run the first deployment yourself:

```powershell
npx.cmd --no-install serverless deploy --stage dev --region ap-southeast-2
```

Preparation validation on 2026-09-17 passed YAML/configuration, local `.env`
validation (values withheld), exact IAM-to-repository comparison, dependency
consistency, and Serverless v4 `print --path provider.runtime` resolution.
The Docker client is installed but its Linux engine is not running, so an actual
dependency build / ZIP package was not produced or verified. No deployment or
live AWS resource operation was performed. After deployment, manually verify the
API URL, CORS, Cognito admin authorization, and product CRUD using an HTTP client.

Frontend integration still requires its owner to adopt the Bearer header. The
frontend currently restricts uploads to 2 MiB and offers more MIME types than the
backend allows. Frontend files are unchanged; `docs/current-status.md` records
the implemented product operations and remaining manual integration work.
