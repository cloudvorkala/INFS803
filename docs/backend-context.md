# Backend Project Context

## Project

This project is a cloud-hosted e-commerce web application developed for
INFS803 Cloud Computing 2026 S2 Assignment 2, Option B.

The system consists of three tiers:

1. Client tier
   - Developed separately by another team member.

2. Backend/API tier
   - This is the scope of this repository contribution.
   - Provides RESTful APIs for products, cart, checkout, orders and file upload.

3. Data/storage tier
   - DynamoDB for persistent application data.
   - S3 for uploaded product images/files.

These tiers describe the intended system. As of 2026-09-11, the backend has a
Flask/Lambda foundation, configuration loading, Cognito verification helpers,
Pydantic contracts, and HTTP/CORS handling. Resource endpoints, cloud persistence,
checkout, and S3 uploads are not implemented yet. The 12 operations (including
4 POST operations) in the API contract are planned interfaces, not currently
functional APIs.

## Working References

- [current-status.md](current-status.md): implemented capabilities, test results,
  known issues, and remaining work.
- [architecture.md](architecture.md): intended AWS architecture and current code layout.
- [api-contract.md](api-contract.md): authoritative frontend/backend interface.
- [backend README](../backend/README.md): local setup and HTTP/auth helper usage.
- [environment example](../backend/.env.example): configuration names and placeholders.
  Local `.env` contents are not shared project documentation or proof of AWS state.

## Backend Responsibilities

The backend's target responsibilities are:

- Product retrieval and filtering.
- Product administration.
- Per-user shopping cart state.
- Checkout and order creation.
- Order history.
- Product/file upload to S3.
- Authentication integration with Cognito.
- Backend authorization for admin-only operations.
- Data validation.
- Cloud persistence.
- Stable REST API contracts for the frontend.

## Frontend Boundary

The frontend is maintained by another developer.

Do not make assumptions about frontend implementation details beyond the API
contract.

The backend must remain independently testable using tools such as curl,
Postman or similar HTTP clients.
