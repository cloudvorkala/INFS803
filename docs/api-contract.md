# API Contract

This document is the authoritative frontend/backend compatibility boundary.
Confirmed project decisions below take precedence over older frontend handover
documents. Observed frontend response conventions are preserved below.

Do not change it without coordination.

## Authentication and Authorization

The frontend authenticates directly with Cognito. Protected requests use exactly:

```text
Authorization: Bearer <Cognito ID token>
```

Reusable Flask middleware/decorators verify the token; version one does not use
an API Gateway Cognito User Pool Authorizer as its primary authentication layer.
Verification includes signature, expiration, issuer, `token_use = id`, and
audience matching the configured Cognito App Client ID, using cached Cognito
JWKS. Malformed or unverifiable tokens fail closed.

Cart and order ownership comes only from verified `sub`, never a request-body
or query-parameter `userId`. Admin operations require exact membership in
`admins` in the verified `cognito:groups` claim. No custom `/login`, `/register`,
or `/logout` endpoints are planned.

Integration gap: the current frontend sends a raw token. The frontend owner
must coordinate the Bearer-header change; this document does not change frontend code.

## Product Schema

The following rules are confirmed. Defaults apply when fields are omitted on
creation, not when fields are omitted on update. Only `coverUrl` is nullable;
optional does not imply that explicit JSON null is accepted for other fields.

| Field | Create rule |
| --- | --- |
| `id` | Server-generated; not accepted in create or update payloads. |
| `title` | Required string; trim and require non-empty. |
| `author` | Required string; trim and require non-empty. |
| `category` | Required string; trim and require non-empty. Not restricted to the admin form's six categories. |
| `price` | Required finite numeric value >= 0. |
| `stock` | Optional; default 0; non-negative integer. |
| `isbn` | Optional string; default empty string. |
| `publishedYear` | Optional integer; default current year; accept 0 for unknown/cleared year, otherwise 1400 through 2100 inclusive. |
| `coverUrl` | Optional nullable string; default null; normalize empty string to null. |
| `description` | Optional string; default empty string. |

For updates, every writable field is optional and omitted means unchanged.
Explicit null follows the same field rules above; `id` is never writable.
Zero price is valid even though the current mock/reference creation check rejects it.

Product responses contain all ten fields above. Prices and other monetary
response fields are JSON numbers, not numeric strings.

## Products

GET /products?category=&search=
- Public
- Lists products
- category and search are optional
- Return `{ "count": number, "products": Product[] }`.
- Preserve observed case-insensitive category filtering and search across title,
  author, and ISBN, including combined category/search filters.
- Return the complete matching result set; sorting/pagination stays in the frontend.
- Keep search proportional to the approximately 100-product catalogue; no separate search service.

GET /products/:id
- Public
- Returns one product
- Return a Product object.

POST /products
- Admin only
- Product fields in body
- Return the created Product object.

PUT /products/:id
- Admin only
- Changed fields in body
- Return the updated Product object.

DELETE /products/:id
- Admin only
- Return `{ "deleted": "<id>" }`.
- Do not scan all carts. Missing product references may be omitted and lazily
  cleaned when the owning user's cart is read.

## Cart

All cart operations require authentication and return the complete updated cart:

```text
{ items: CartItem[], itemCount: number, total: number }
CartItem = { productId, title, author, price, stock, quantity, subtotal }
```

This preserves the observed frontend response shape. `itemCount` sums quantities;
`subtotal` and `total` are monetary JSON numbers.

GET /cart
- Authentication required
- Returns the current authenticated user's cart

POST /cart

Adds quantity to an existing line rather than replacing its quantity.

Request:
{
  "productId": "...",
  "quantity": 1
}

PUT /cart/:productId

Request:
{
  "quantity": 1
}

quantity = 0 removes the item.
Otherwise PUT sets the absolute quantity.

DELETE /cart/:productId

## Checkout

POST /checkout

Request:
{
  "shippingAddress": ...
}

Turns the authenticated user's cart into an order.

Authentication is required. `shippingAddress` is an object with these required
string fields, each trimmed and non-empty:

```text
{ fullName, line1, city, postcode, country }
```

Checkout supports at most 40 unique cart lines. Stock updates, order creation,
and purchased cart-line deletion commit together in a DynamoDB transaction.
Recheck stock and calculate totals on the backend. Version one has no cart
revision fields or checkout idempotency keys. No payment processing is included.

Return the created Order using the observed frontend shape:

```text
Order = {
  orderId, userId, placedAt, status, shippingAddress, items: OrderItem[], total
}
OrderItem = { productId, title, author, price, quantity, subtotal }
```

`userId` is the verified Cognito `sub`; `placedAt` is an ISO timestamp;
`status` is `CONFIRMED`. Items preserve purchase-time details and prices.

## Orders

GET /orders

Returns order history for the authenticated user.
Return `{ "count": number, "orders": Order[] }`, newest first.
The DynamoDB sort key `placedAtOrderId` is not part of the frontend response.

## Upload

POST /upload_file
- Admin only
- Accept JPEG (`image/jpeg`), PNG (`image/png`), and WebP (`image/webp`) only.
- Maximum decoded file size: 3 MiB (3,145,728 bytes).
- Validate and decode `dataUrl`, upload to S3, then return the response below.
- Do not replace this endpoint with a presigned upload workflow.

Request:
{
  "filename": "...",
  "dataUrl": "..."
}

Response:
{
  "url": "...",
  "s3Key": "..."
}

`url` must be usable as the product cover image source. Final asset URL delivery
is pending separate verification of the existing S3/CloudFront infrastructure.
The current frontend has a stricter 2 MiB limit and an `image/*` picker; those
observed UI constraints do not replace the confirmed backend rules above.

## HTTP Response Conventions

Preserve the observed reference-server success codes: 201 for POST /products,
POST /checkout, and POST /upload_file; 200 for other successful operations.
Cart deletion returns the updated cart rather than an empty 204 response.

Errors use JSON with a human-readable message:

```json
{ "message": "Human-readable reason" }
```

Preserve the observed 400 (invalid input), 401 (missing/invalid authentication),
403 (not authorized), 404 (not found), and 409 (business conflict, including
insufficient stock) conventions. Unexpected backend failures use 500 with a
safe message rather than exposing internal details.
