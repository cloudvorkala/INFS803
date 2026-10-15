# Paperbound

[![Backend tests](https://github.com/cloudvorkala/INFS803/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/cloudvorkala/INFS803/actions/workflows/backend-tests.yml)

Paperbound is an online bookstore developed for **INFS803 Cloud Computing 2026, Assignment 2, Option B**. It separates the React client, a cloud-hosted REST API, and managed application data and asset storage.

Users can browse the 100-book catalogue, search and filter books, manage their own cart, check out, and view order history. Administrators can manage products and upload cover images.

## Architecture

```text
React + Vite (AWS Amplify Hosting)
    |
    | HTTPS / REST
    v
API Gateway -> Lambda -> serverless-wsgi -> Flask
                                             |
                                             +-> DynamoDB: Products, Carts, Orders
                                             +-> S3: cover uploads

Browser <-> Cognito: registration and sign-in
Browser -> S3: cover image requests
```

| Layer | Technology |
| --- | --- |
| Client | React 18, Vite, React Router, AWS Amplify |
| Application | Python 3.12, Flask, serverless-wsgi, Pydantic |
| Hosting and deployment | API Gateway, Lambda, Serverless Framework 4.22.0 |
| Database | DynamoDB |
| Assets | S3, with uploaded covers under `covers/uploads/` |
| Authentication | Cognito User Pool; backend verification of Cognito ID tokens |

The backend exposes **12 functional REST operations, including 4 POST operations**. Checkout uses a conditional DynamoDB transaction to create the order, decrement stock, and remove the purchased cart lines together.

## Repository layout

```text
frontend/                 React client, build scripts, and catalogue/setup tools
backend/
  app.py                  Flask application factory and CORS handling
  lambda_handler.py       Lambda entry point and WSGI adapter
  auth/                   Cognito token verification and permissions
  routes/                 HTTP endpoints
  models/                 Pydantic request and response models
  services/               Cart, checkout, and upload logic
  repositories/           DynamoDB and S3 access
  tests/                  Offline automated tests
  serverless.yml          Lambda, API Gateway, IAM, and packaging configuration
docs/                     API contract, usage reference, architecture, and status
```

## Prerequisites

- Python 3.12 for backend development.
- Node.js and npm for frontend tooling and the local Serverless CLI.
- AWS credentials with access to the configured resources for backend requests against AWS.
- An existing Cognito User Pool and browser app client, DynamoDB tables, and S3 uploads bucket.
- Docker Desktop with the Linux engine running for Lambda dependency packaging.
- AWS deployment credentials and Serverless Framework authentication for deployment.

## Run the backend locally

From the repository root, use PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Edit `backend/.env` with your resource identifiers:

| Variable | Purpose |
| --- | --- |
| `AWS_REGION` | AWS region, normally `ap-southeast-2` |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `COGNITO_APP_CLIENT_ID` | Cognito app client ID |
| `PRODUCTS_TABLE` | Products table, normally `Paperbound-Products` |
| `CARTS_TABLE` | Carts table, normally `Paperbound-Carts` |
| `ORDERS_TABLE` | Orders table, normally `Paperbound-Orders` |
| `UPLOADS_BUCKET` | Existing S3 bucket for cover uploads |
| `ALLOWED_ORIGINS` | Comma-separated browser origins, such as `http://localhost:5173` |
| `JWKS_CACHE_SECONDS` | Cognito public-key cache lifetime; default `300` |
| `JWKS_TIMEOUT_SECONDS` | Public-key request timeout; default `3` |

Start Flask:

```powershell
.\.venv\Scripts\python.exe -m flask --app app:create_app run
```

The local API is available at `http://127.0.0.1:5000`. Local Flask execution still uses the configured AWS database, storage, and Cognito resources. AWS credentials are resolved through the SDK credential provider chain.

## Run the frontend locally

In a separate terminal, from the repository root:

```powershell
cd frontend
npm.cmd ci
Copy-Item .env.example .env
```

For the real backend, configure `frontend/.env`:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:5000
VITE_AUTH_MODE=cognito
VITE_COGNITO_USER_POOL_ID=<your-user-pool-id>
VITE_COGNITO_CLIENT_ID=<your-app-client-id>
VITE_COGNITO_REGION=ap-southeast-2
```

The frontend and backend must reference the same Cognito pool and app client. Use an app client without a client secret. To connect directly to AWS, replace `VITE_API_BASE_URL` with the deployed API Gateway stage URL. Ensure the browser origin is included in the backend's `ALLOWED_ORIGINS`.

```powershell
npm.cmd run dev
```

Open `http://localhost:5173`. The frontend also supports a local demo: leave `VITE_API_BASE_URL` empty and set `VITE_AUTH_MODE=mock`.

Build commands, run inside `frontend/`:

```powershell
npm.cmd run build
npm.cmd run preview
```

The production build checks the API and authentication configuration. For an explicit mock demo build, use `npm.cmd run build:demo`. Production frontend hosting uses AWS Amplify.

## REST API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/products` | Public | List products; optional `category` and `search` filters |
| GET | `/products/:id` | Public | Get one product |
| POST | `/products` | Admin | Create a product |
| PUT | `/products/:id` | Admin | Update a product |
| DELETE | `/products/:id` | Admin | Delete a product |
| GET | `/cart` | Signed-in user | Get the caller's cart |
| POST | `/cart` | Signed-in user | Add a product to the cart |
| PUT | `/cart/:productId` | Signed-in user | Set a cart-line quantity |
| DELETE | `/cart/:productId` | Signed-in user | Remove a cart line |
| POST | `/checkout` | Signed-in user | Place an order |
| GET | `/orders` | Signed-in user | Get the caller's order history |
| POST | `/upload_file` | Admin | Upload a JPEG, PNG, or WebP cover image |

Protected requests use a Cognito **ID token**:

```http
Authorization: Bearer <Cognito ID token>
```

Admin operations require membership in the `admins` Cognito group. Cart and order ownership comes from the verified token's `sub`. Sign-in and registration are handled by Cognito.

The shared dev endpoint recorded in the project documentation is:

```text
https://8lvgv7w3l0.execute-api.ap-southeast-2.amazonaws.com/dev
```

Example public request:

```powershell
curl.exe "https://8lvgv7w3l0.execute-api.ap-southeast-2.amazonaws.com/dev/products?category=Fiction"
```

See [the API reference](docs/api-reference.md) for request bodies, response examples, validation, and status codes. The [API contract](docs/api-contract.md) defines the agreed frontend/backend interface.

## Data and assets

| DynamoDB table | Partition key | Sort key |
| --- | --- | --- |
| `Paperbound-Products` | `id` | None |
| `Paperbound-Carts` | `userId` | `productId` |
| `Paperbound-Orders` | `userId` | `placedAtOrderId` |

Catalogue listing scans the Products table and filters in Python; the frontend sorts and paginates the returned list. Checkout supports up to 40 unique cart lines and returns `409` for stock or concurrent-write conflicts. Orders retain a snapshot of the purchased items and prices.

Cover uploads accept base64 JPEG, PNG, or WebP images up to 3 MiB decoded size. The upload API returns the S3 URL and object key. The bucket's read policy must allow the returned cover URLs to be displayed by the browser.

Table setup files are under `frontend/tools/aws/`, and catalogue exports are under `frontend/tools/seed-data/`. See the [AWS setup notes](frontend/tools/aws/README.md) and [seed data notes](frontend/tools/seed-data/README.md) before using those tools against shared resources.

## Deploy the backend

Run from `backend/` after filling in `.env`, configuring deployment credentials, and starting Docker Desktop's Linux engine:

```powershell
npm.cmd ci
npx.cmd --no-install serverless deploy --stage dev --region ap-southeast-2
```

Use the repository's pinned local Serverless CLI. `npm.cmd ci` is needed for a fresh checkout or after Node dependency changes.

The configuration deploys the Lambda function, API Gateway proxy routes, execution role, and associated logging resources. It references existing DynamoDB tables, the S3 uploads bucket, and Cognito identifiers; provision those application resources separately before deployment.

Current settings in `backend/serverless.yml`:

| Setting | Value |
| --- | --- |
| Runtime | Python 3.12, x86_64 |
| Memory | 512 MB |
| Execution timeout | 15 seconds |
| CloudWatch log retention | 14 days |
| Default region / stage | `ap-southeast-2` / `dev` |

For the deployed frontend, include its exact HTTPS origin in `ALLOWED_ORIGINS` and redeploy the backend after changing deployment settings.

## Testing

Run the existing offline backend suite from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The suite replaces AWS/network dependencies. Recorded test results and known legacy assertions are documented in [current-status.md](docs/current-status.md).

The backend can also be tested independently through curl or Postman. Use the deployed stage URL and a fresh Cognito ID token for protected operations.

Two k6 scripts are included:

- `backend/load-products.js`: catalogue load scenario with a target request rate ramping up to 10 requests per second. Review its configured endpoint before running it.
- `backend/test-checkout.js`: checkout correctness scenarios for competing purchases and insufficient stock. These create real test products, carts, and orders; use dedicated test accounts and the intended dev endpoint.

See [checkout test instructions](backend/test-checkout.md) for setup and assertions. The PowerShell runner `backend/run-checkout-test.ps1` loads local `.env.k6` settings, refreshes test tokens, and selects `race` or `rollback`. Test configuration and thresholds are separate from measured results.

## Configuration and credentials

Keep `.env` files, test passwords, JWTs, and AWS credentials out of source control. Frontend `VITE_*` values are exposed in the browser bundle and must contain only public configuration. Lambda uses its execution role to access DynamoDB and S3.

## Further documentation

- [Backend development notes](backend/README.md)
- [Frontend development notes](frontend/README.md)
- [REST API reference](docs/api-reference.md)
- [API contract](docs/api-contract.md)
- [Architecture design](docs/architecture.md)
- [Implementation and verification history](docs/current-status.md)
