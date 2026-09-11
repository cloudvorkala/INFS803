# Backend Cloud Architecture

## Implementation Status (2026-09-11)

This document defines the intended architecture. The repository currently
implements the Flask application foundation, Lambda WSGI adapter, configuration,
Cognito verification helpers, Pydantic models, and HTTP/CORS handling. Business
routes, DynamoDB repositories, checkout logic, and S3 writes are still pending.
The diagram and persistence rules below describe the target, not verified live
AWS resources. See [current-status.md](current-status.md) for implementation and
test evidence.

## High-Level Architecture

```text
Client
  |
  | HTTPS / REST
  v
AWS API Gateway REST API (ANY / and ANY /{proxy+})
  |
  v
One AWS Lambda (Python 3.12)
  |
serverless-wsgi
  |
Flask Application
  |
  +------------------+
  |                  |
  v                  v
DynamoDB             S3

Authentication:
Client <-> AWS Cognito

Protected API requests:
Client -> API Gateway proxy -> Lambda / serverless-wsgi
       -> Flask Cognito decorator -> verified claims -> application logic

Header: Authorization: Bearer <Cognito ID token>
```

## Current Code Layout

| Location | Responsibility |
| --- | --- |
| `backend/app.py` | Application factory, explicit JSON provider, CORS, OPTIONS handling, and request-body limit; no resource routes yet. |
| `backend/lambda_handler.py` | Caches one Flask application per warm execution environment and calls `serverless_wsgi.handle_request`. |
| `backend/config.py` | Validates environment settings and loads the backend-local `.env` as a fallback; performs no AWS resource lookup. |
| `backend/auth/` | Cognito JWT verification, authenticated request context, and admin/user helpers. |
| `backend/models/` | Pydantic request/response contracts, validation, and JSON serializers. |
| `backend/http_helpers.py` / `backend/errors.py` | Explicit HTTP validation/serialization boundaries and JSON error responses. |
| `backend/serverless.yml` | Initial Lambda and REST API proxy configuration referencing existing resource names. |
| `backend/tests/` | Offline foundation tests; current results and known failure are recorded in `current-status.md`. |

Future API/routes, services/repositories, and core/domain modules must preserve
the separation below. Those business layers do not exist yet. Response models
are returned through `api_response()`; only client-body validation through
`parse_json_request()` is translated to 400. Internal model failures remain 500.

## AWS Services

### API Gateway

Provides the public REST API endpoint.

ANY / and ANY /{proxy+} forward to the same WSGI Lambda. Flask owns application
routing. Version one does not use an API Gateway Cognito User Pool Authorizer
as the primary authentication mechanism. Public product GET routes and CORS
preflight requests do not require Flask authentication decorators.

The backend must remain directly accessible to markers without requiring the
web frontend.

### AWS Lambda

Runs the Python Flask backend.

Use Python 3.12 and ap-southeast-2 by default unless existing Paperbound
infrastructure requires otherwise.

Serverless compute is selected to remain consistent with the previous Adroit
project and is explicitly permitted as an Option B architecture.

### Flask + serverless-wsgi

Flask provides the API routing/application layer.

serverless-wsgi adapts the Flask WSGI application to AWS Lambda.

### DynamoDB

Cloud-hosted application database.

Stores application entities such as:

- products,
- carts,
- orders.

No local VM-hosted database is used.

Preserve Paperbound-Products (partition key id), Paperbound-Carts (userId,
productId), and Paperbound-Orders (userId, placedAtOrderId), and existing product
indexes. Checkout transactionally updates stock, creates the order, and clears
purchased cart lines, with at most 40 unique lines. Version one has no cart
revisions or checkout idempotency keys. Product deletion never scans all carts;
missing references are omitted and cleaned lazily on cart reads.

### S3

Cloud object storage for product images/files uploaded through `/upload_file`.

### Cognito

Provides authentication.

Frontend authentication occurs directly against Cognito.

Reusable Flask authentication middleware/decorators require the Bearer header,
fetch JWKS from the configured User Pool, cache public keys in memory, and verify
signature, expiration, issuer, token_use=id, and audience against the configured
Cognito App Client ID. Malformed or unverifiable tokens fail closed. Never merely
decode an unverified token.

Expose verified claims in request context. Ownership uses only verified sub;
admin decorators require exact admins membership in cognito:groups. Public
GET /products and GET /products/:id do not require authentication.

Keep HTTP handling, Pydantic contracts, domain logic, and boto3 repository/service
access separated. Do not introduce Adroit-specific business concepts.

### IAM

Lambda accesses DynamoDB and S3 through an IAM execution role.

No AWS access keys are stored in application source code.

Use least-privilege permissions scoped to the Paperbound tables/indexes and the
configured S3 covers/ prefix. AWS configuration comes from environment variables.

## Deployment

Infrastructure and backend deployment are managed using Serverless Framework
and `serverless.yml`.

The current configuration declares one Python 3.12 / x86_64 Lambda, a 15-second
timeout, 256 MiB memory, 14-day log retention, and a default `dev` stage. It
defines the two REST proxy events without a Gateway authorizer. The Python
`serverless-wsgi` dependency is called directly by the Lambda handler.
`package.json` declares Serverless `^4.22.0`, and `pythonRequirements` configures
`dockerizePip: non-linux`. Packaging has not been verified in this review.

No DynamoDB tables, S3 buckets, or Cognito pools are declared for creation in the
current configuration. Application DynamoDB/S3 IAM grants are also absent and
must be added with the corresponding services. Local `.env` files, tests, and
development artifacts are excluded by deployment packaging patterns.

Initially reference existing DynamoDB, S3, and Cognito resources through
configuration. Do not create replacements until actual AWS state has been
separately verified and changes authorized. Asset delivery URLs remain pending
verification of the existing S3/CloudFront setup. Add only packaging dependencies
and Serverless plugins needed by Paperbound; do not copy historical choices blindly.

Configure CORS for the separately deployed frontend without unnecessarily allowing
unrestricted production origins. The older Express/EC2 handover is not an
implementation target.

The deployed API Gateway URL must remain publicly reachable for assignment
marking.
