# Project Instructions

## Scope

I am responsible for backend development only.

The frontend is developed by another team member.

You may inspect relevant files throughout the repository when necessary to
understand the project and frontend/backend integration.

Do not modify files under `/frontend` unless explicitly requested.

By default, only modify files under `/backend`.

Do not modify `/docs`, `AGENTS.md`, or other repository-level files unless
explicitly requested.

Exception: API changes require the accompanying `docs/api-reference.md` update
described under API Reference Maintenance below; this documentation update is
part of the authorized API task.

---

## Assignment

This project is INFS803 Cloud Computing 2026 S2 Assignment 2, Option B.

The backend must:

- provide independently accessible REST APIs,
- be deployed to the cloud,
- use a cloud database,
- use cloud storage for uploaded assets,
- provide at least 10 functional REST API operations,
- include at least 3 POST operations.

The deployed backend must remain testable independently of the frontend using
HTTP tools such as curl, Postman, or equivalent clients.

---

## Architecture

Use the following architecture as the backend baseline. It is derived from the
previous Adroit project and should be preserved where practical.

Backend baseline:

- AWS API Gateway
- AWS Lambda
- Python
- Flask
- serverless-wsgi
- Serverless Framework
- DynamoDB
- S3
- Cognito
- Pydantic

Treat `docs/architecture.md` as the authoritative description of the intended
backend architecture.

Do not introduce a different backend framework, persistence technology, or
cloud architecture without a clear technical reason.

If a deviation appears necessary, explain the reason and proposed change
before implementing it.

---

## Development Rules

- Do not modify frontend code.
- Treat `docs/api-contract.md` as the frontend/backend compatibility boundary.
- Do not change API paths or request fields without telling me first.
- Keep Flask routes thin.
- Put AWS access in service/repository modules.
- Use IAM roles instead of hard-coded AWS credentials.
- Enforce admin permissions on the backend.
- Derive user identity from Cognito rather than request body user IDs.
- Inspect existing code before modifying it.
- Do not rewrite unrelated working code.
- Run relevant tests or validation checks after changes.
- Keep the backend independently testable without requiring the frontend.
- Configure API/CORS behaviour as needed for the separately deployed frontend,
  without unnecessarily allowing unrestricted origins in production.

---

## Backend Structure

Keep responsibilities separated:

- API/routes: HTTP request and response handling only.
- auth: authentication and authorization helpers.
- services/repositories: DynamoDB, S3, and other AWS access.
- models/contracts: Pydantic API and domain models.
- core/domain logic: business logic such as checkout/order creation.

Do not put large amounts of business logic directly inside Flask route
handlers.

Reuse existing services, models, and helpers where appropriate instead of
creating duplicate abstractions.

---

## Authentication

Authentication is handled using AWS Cognito.

The frontend authenticates directly with Cognito.

Do not implement custom `/login`, `/register`, or `/logout` backend endpoints
unless explicitly requested.

Protected backend API requests use:

`Authorization: Bearer <token>`

Do not change this header convention without coordination with the frontend
developer.

Never place AWS access keys, Cognito client secrets, or other credentials in
source code.

Use IAM roles for Lambda access to DynamoDB and S3.

---

## Authorization

Enforce authorization on the backend.

Do not rely on the frontend hiding admin controls.

Admin-only API operations must verify the authenticated user's admin role or
Cognito group/claim.

User-owned resources such as cart and order data must derive the user identity
from the authenticated Cognito identity rather than accepting a `userId` from
the request body.

Users must not be able to access another user's cart or orders by changing
request parameters or payload fields.

---

## API Compatibility

Treat `docs/api-contract.md` as authoritative.

Do not silently:

- rename endpoints,
- rename request fields,
- rename response fields,
- change HTTP methods,
- change expected status codes,
- change authentication requirements.

If an API contract appears unsafe, ambiguous, inconsistent, or technically
problematic, report the issue before changing the implementation or contract.

Do not invent unresolved frontend-facing schemas when the contract does not
define them clearly. Report the missing decision first.

---

## API Reference Maintenance

`docs/api-reference.md` is the maintained developer-facing REST API usage
reference. `docs/api-contract.md` remains authoritative for design and contract
decisions.

Whenever an API endpoint, request body, response body, authentication requirement,
validation rule, or HTTP status behavior changes, update `docs/api-reference.md`
in the same task. Document only behavior supported by the authoritative contract
or current implementation, clearly identifying unimplemented APIs.

Do not rewrite `docs/api-contract.md` merely to match an implementation change.
If implementation conflicts with the authoritative contract, report the conflict
instead of silently changing the contract or documenting the conflict as agreed.

Verification status in the reference must separately distinguish implemented,
locally/manual verified, and AWS/manual verified. Use recorded evidence in
`docs/current-status.md`; never mark an endpoint verified solely because code or
generated tests exist. If manual verification is not recorded, say so.

---

## AWS and Deployment Safety

Do not deploy to AWS or modify live cloud resources unless explicitly
requested.

Do not run commands such as deployment, resource deletion, database deletion,
bucket deletion, or destructive infrastructure updates without explicit
approval.

Before a deployment or infrastructure change:

1. Explain what AWS resources will be created, modified, or removed.
2. Explain any expected cost or persistence implications.
3. Wait for explicit approval before performing the change.

Never delete production or shared cloud data unless explicitly instructed.

Prefer least-privilege IAM permissions.

---

## Git Safety

Do not commit, push, merge, rebase, reset, force-push, or rewrite Git history
unless explicitly requested.

You may inspect Git status, history, and diffs when useful.

After completing code changes, report the changes so I can review them before
committing.

---

## Implementation Behaviour

Before changing code:

1. Inspect existing relevant files.
2. Understand the current implementation.
3. Read the relevant documentation under `/docs`.
4. Reuse existing services/models where possible.
5. Preserve existing architectural conventions.

When implementing:

- Make the smallest complete change.
- Avoid unnecessary dependencies.
- Avoid unnecessary abstraction.
- Validate request payloads.
- Handle expected errors explicitly.
- Do not modify unrelated files.
- Do not silently make architecture or API-contract decisions.

After implementing:

- Run relevant tests or build checks.
- Report changed files.
- Report tests/checks performed and their results.
- Report assumptions.
- Report unresolved issues.
