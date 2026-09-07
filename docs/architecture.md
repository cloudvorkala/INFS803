# Backend Cloud Architecture

## High-Level Architecture

Client
  |
  | HTTPS / REST
  v
AWS API Gateway
  |
  v
AWS Lambda
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
Client -> API Gateway with Cognito token

## AWS Services

### API Gateway

Provides the public REST API endpoint.

The backend must remain directly accessible to markers without requiring the
web frontend.

### AWS Lambda

Runs the Python Flask backend.

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

### S3

Cloud object storage for product images/files uploaded through `/upload_file`.

### Cognito

Provides authentication.

Frontend authentication occurs directly against Cognito.

Backend protected routes validate authenticated identity and authorization.

### IAM

Lambda accesses DynamoDB and S3 through an IAM execution role.

No AWS access keys are stored in application source code.

## Deployment

Infrastructure and backend deployment are managed using Serverless Framework
and `serverless.yml`.

The deployed API Gateway URL must remain publicly reachable for assignment
marking.