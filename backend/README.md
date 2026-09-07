# Paperbound backend foundation

This step supplies Flask scaffolding, configuration, Cognito authentication,
Pydantic contracts, JSON errors, CORS, tests, and initial Serverless configuration.
Resource endpoints, database operations, checkout logic, and S3 writes are not
implemented. Requests to resource paths currently return JSON 404 responses.

## Local setup

From this directory, create a Python 3.12 virtual environment and install:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
```

The tests generate RSA keys locally and replace JWKS HTTP transport. Network
access is blocked by an autouse fixture; no AWS credentials or resources are used.

Set the environment variables listed in `.env.example` in the process, then run:

```powershell
.\.venv\Scripts\python.exe -m flask --app app:create_app run
```

The application does not automatically load `.env`. Missing/invalid required
configuration fails at application creation; existing resource names are required
but are never looked up during startup. Empty ALLOWED_ORIGINS permits no browser
origins. The final asset-delivery URL setting is deferred until infrastructure is verified.

## Contracts and authentication

`models/` follows `../docs/api-contract.md`. Product updates use `changes()` or
`model_dump(exclude_unset=True)` so omitted fields remain unchanged; only coverUrl
accepts explicit null. Monetary values remain Decimal internally and serialize
as JSON numbers. Request models reject unknown fields, including ownership IDs.
Cart add quantities are positive integers (default 1); cart update quantities are
non-negative integers. The 40-line checkout limit is declared for later domain code;
it is not enforced on cart reads or historical order lists.

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

Serverless Framework v4 provides built-in Python requirements packaging; Docker
packaging is selected for Linux-compatible cryptography and Pydantic dependencies.
No additional Serverless plugin is necessary. A future packaging/deployment check
requires the Node dependency, Docker, and any Framework authentication requirements.
Do not deploy or inspect AWS without separate authorization. Reference:
https://www.serverless.com/framework/docs/providers/aws/guide/python

Frontend integration still requires its owner to adopt the Bearer header. The
frontend currently restricts uploads to 2 MiB and offers more MIME types than the
backend allows. Neither frontend files nor shared project docs are modified here.
