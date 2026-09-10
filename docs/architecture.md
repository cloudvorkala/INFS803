# Backend Cloud Architecture

## High-Level Architecture

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
