# Current Backend Status

## Confirmed

- Assignment option: Option B.
- Backend-only development scope.
- Frontend is developed by another team member.
- AWS serverless backend architecture.
- REST API Gateway.
- Lambda + Python + Flask + serverless-wsgi.
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

## Pending / To Confirm

- Exact Product schema.
- Exact shippingAddress structure.
- Exact Order response schema.
- Exact Cart response schema.
- Cognito admin role/group convention.
- Exact Authorization header token format.
- S3 asset URL strategy.
- DynamoDB table design.
- Error-response format.
- Pagination requirements.