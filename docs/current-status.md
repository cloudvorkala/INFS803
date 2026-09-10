# Current Backend Status

## Confirmed

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
- Current frontend API contract contains 12 REST API operations.
- Current frontend API contract contains 4 POST operations.

## Authentication Decisions

- Frontend authenticates directly with Cognito.
- No custom `/login`, `/register`, `/logout` APIs are planned.
- Backend performs authorization for protected/admin resources.
- Protected requests use Authorization: Bearer <Cognito ID token>.
- Reusable Flask middleware/decorators verify Cognito JWTs using cached JWKS,
  including signature, expiration, issuer, token_use=id, and App Client audience.
- No primary API Gateway Cognito User Pool Authorizer in version one.
- Verified sub determines ownership; verified admins group membership grants admin access.

## Confirmed Contracts and Persistence

- Product create/update rules and nullability are recorded in docs/api-contract.md.
- Shipping address requires trimmed, non-empty fullName, line1, city, postcode, country.
- Observed Product, Cart, Order, and upload response shapes are preserved in the contract.
- Errors use { message }; response status conventions are recorded in the contract.
- Keep Paperbound-Products (id), Paperbound-Carts (userId/productId), and
  Paperbound-Orders (userId/placedAtOrderId), including existing product indexes.
- Initially reference existing DynamoDB, S3, and Cognito resources through configuration.
  Do not provision replacements before separate verification of actual AWS state.
- Checkout uses one DynamoDB transaction, with at most 40 unique cart lines.
- No cart revision fields or checkout idempotency keys in version one.
- Deleted products are omitted/lazily cleaned from carts; no scan of all user carts.
- Simple catalogue search returns all matching products; pagination remains frontend-side.
- Uploads accept filename/dataUrl, allow JPEG/PNG/WebP up to 3 MiB decoded,
  upload to S3, and return { url, s3Key }; no presigned upload workflow.

## Remaining Integration / Deployment Work

- Verify existing AWS resources separately when authorized; record actual resource
  identifiers and confirm S3/CloudFront asset delivery strategy.
- Configure deployment-specific values, including allowed frontend CORS origins.
- Coordinate frontend adoption of the agreed Bearer header; current code sends a raw token.
- Frontend upload UI currently limits files to 2 MiB and offers image/*; the backend
  will enforce the confirmed 3 MiB JPEG/PNG/WebP contract.

These integration items do not block initial backend implementation. This status
records agreed decisions, not evidence that a backend is implemented or deployed.
