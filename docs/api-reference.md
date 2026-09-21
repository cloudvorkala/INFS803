# Paperbound REST API Reference

Maintained practical reference for frontend developers, Postman/manual testing,
markers, and future maintainers. [api-contract.md](api-contract.md) is the
authoritative design/contract boundary; this reference describes current usage.
Implementation and verification evidence comes from
[current-status.md](current-status.md). Last reviewed: 2026-09-21.

## 1. Base URL

| Environment | Base URL |
| --- | --- |
| Local development | `http://127.0.0.1:5000` |
| AWS development | `https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/dev` |

Replace `<api-id>` with the actual deployment output. Append the paths below to
the base URL. `:id` and `:productId` denote required product-ID path segments;
replace them with an actual returned ID, URL-encoded as needed. No `/api` prefix
is used. Local setup is in the [backend README](../backend/README.md).

Curl examples below use POSIX-shell syntax and illustrative data:

```sh
BASE_URL='http://127.0.0.1:5000'
ID_TOKEN='<Cognito ID token>'
PRODUCT_ID='<actual product id>'
```

For Postman, set the base URL as an environment variable, use raw JSON bodies,
and select Bearer Token authorization for protected requests. Examples are usage
instructions, not evidence that requests were executed.

## 2. Authentication

```text
Authorization: Bearer <Cognito ID token>
```

- Public endpoints require no token and do not validate an Authorization header.
- Authenticated endpoints require a valid Cognito **ID token**, not an access
  token or a raw JWT without the `Bearer ` prefix. The current parser requires
  exactly that capitalization and one space.
- Admin endpoints additionally require exact `admins` membership in verified
  `cognito:groups`; another role label or group capitalization does not qualify.
- Identity comes only from verified Cognito `sub`. Never supply `userId`, role,
  group, or identity headers as trusted identity. Request models reject unknown
  body fields, including client-supplied ownership or role fields; query/header
  identity values cannot select another user's cart.
- Cognito verification checks RS256 signature, expiration, issuer, App Client
  audience, and `token_use=id`. Authentication runs before protected route body
  validation. Missing/invalid tokens return **401**; authenticated users lacking
  admin permission receive **403** on admin endpoints. Cart requires no admin role.

The frontend authenticates directly with Cognito. There are no backend login,
registration, or logout endpoints. Its adoption of the Bearer header remains an
integration task in the recorded status.

## 3. Content type

Send request bodies as JSON objects with:

```text
Content-Type: application/json
```

Successful business responses and Flask error responses use
`Content-Type: application/json`. Monetary values, stock, years, quantities, and
counts serialize as JSON numbers, never numeric strings. Money uses Decimal
internally; JSON output does not guarantee two trailing decimal places.

POST/PUT request models reject unknown fields, wrong types, and disallowed nulls.
Malformed JSON returns 400; unsupported non-JSON content types on body-taking
routes retain Flask's 415 response. The request-body limit is 5 MiB (413).
GET/DELETE require no request body.

Browser access requires an exact configured `ALLOWED_ORIGINS` match. CORS
preflight OPTIONS returns 204 without a JSON body; it is not a business operation.
Allowed origins receive the configured methods and `Content-Type, Authorization`
headers. CORS does not replace token validation.

## 4. Error format

```json
{ "message": "Human-readable reason" }
```

| Status | Current meaning |
| --- | --- |
| 400 | Malformed JSON, request-model validation failure, or endpoint-specific invalid input. |
| 401 | Missing, invalid, expired, or unverifiable Cognito ID token. |
| 403 | Authenticated user lacks the required admin group. |
| 404 | Missing resource, missing cart line where specified, or unregistered route. |
| 405 | Unsupported HTTP method on a registered path. |
| 409 | Endpoint-specific stock or conditional-write conflict. |
| 413 | Request body exceeds the Flask size limit. |
| 415 | Unsupported content type when parsing a JSON request body. |
| 500 | Invalid stored data or unexpected backend/storage failure. |

400 model errors identify invalid field locations without echoing values, for
example `{"message":"Invalid request field(s): quantity."}`. Unexpected failures
return `{"message":"An unexpected backend error occurred."}`. A missing table
or denied storage permission is a backend failure, not a resource 404. These are
the Flask API envelopes; failures before Flask (for example at API Gateway) are
not specified here. Endpoint status lists below also inherit these applicable
framework errors and 500 handling.

## 5. Products API

### Product response and writable fields

Every Product response contains exactly these ten fields:

```json
{
  "id": "bk-example",
  "title": "Example Book",
  "author": "Example Author",
  "category": "Fiction",
  "price": 19.99,
  "stock": 5,
  "isbn": "9780000000000",
  "publishedYear": 2026,
  "coverUrl": null,
  "description": "An example book."
}
```

`bk-example` is illustrative; use a real returned ID for subsequent requests.
`searchText` is internal storage-only data and is never an API response field.

| Field | Create validation/default | Update |
| --- | --- | --- |
| `id` | Backend-generated `bk-` plus UUID4 hex; forbidden in request bodies. | Never writable. |
| `title` | Required string, trimmed, non-empty. | Same validation when supplied. |
| `author` | Required string, trimmed, non-empty. | Same validation when supplied. |
| `category` | Required string, trimmed, non-empty; no fixed category list. | Same validation when supplied. |
| `price` | Required finite JSON number >= 0; bool and numeric strings rejected. | Same validation when supplied. |
| `stock` | Strict non-negative integer; default 0. | Same validation when supplied. |
| `isbn` | String; default `""`. | String, including `""`. |
| `publishedYear` | Strict integer; default backend's current calendar year at creation; 0 means unknown, otherwise 1400..2100 inclusive. | Same accepted values; omission does not reset the year. |
| `coverUrl` | Nullable string; default null; `""` normalizes to null. No URL-format validation is currently applied. | String or null; `""` clears to null. |
| `description` | String; default `""`. | String, including `""`. |

Only `coverUrl` accepts explicit null. Integer fields reject bools, numeric
strings, and JSON floating-point values (including `2.0`). All writable fields
are optional on update; omission means unchanged. Creation defaults apply only
when a create field is omitted. Unknown fields are rejected.

### GET /products

List the catalogue. **Public**; no body or path parameters.

| Optional query parameter | Behavior |
| --- | --- |
| `category` | Case-insensitive equality with the complete category. |
| `search` | Case-insensitive substring match in title, author, or ISBN. |

Both filters must match when combined. Values are trimmed; absent/empty values
mean no filter. No filters returns all products. Repeated `category` or `search`
parameters return 400; unrelated query parameters are ignored. `All` is not a
special backend category. The complete matching set is returned, including all
DynamoDB pages. There is no backend pagination or guaranteed sort order; the
frontend sorts/paginates locally. Public Product reads are eventually consistent.

**200 response:**

```json
{
  "count": 1,
  "products": [
    {
      "id": "bk-example",
      "title": "Example Book",
      "author": "Example Author",
      "category": "Fiction",
      "price": 19.99,
      "stock": 5,
      "isbn": "9780000000000",
      "publishedYear": 2026,
      "coverUrl": null,
      "description": "An example book."
    }
  ]
}
```

No matches: `{"count":0,"products":[]}`. Relevant statuses: **200, 400, 500**.

```sh
curl -G "$BASE_URL/products" --data-urlencode 'category=Fiction' --data-urlencode 'search=Example'
```

### GET /products/:id

Read one product. **Public**. Required path `id`: product ID; no query parameters
or body. **200** returns the [Product JSON object](#product-response-and-writable-fields)
directly, with no wrapper. **404** returns
`{"message":"Product not found."}`. Other relevant status: **500**.

```sh
curl "$BASE_URL/products/$PRODUCT_ID"
```

### POST /products

Create a product. **Admins only**; no path/query parameters. Apply the field
rules above; do not send `id`. Example request:

```json
{
  "title": "Example Book",
  "author": "Example Author",
  "category": "Fiction",
  "price": 19.99,
  "stock": 5
}
```

**201** returns the full [Product JSON object](#product-response-and-writable-fields),
with the generated ID and creation defaults for omitted fields (in this example,
`isbn` and `description` are `""`, `coverUrl` is null, and `publishedYear` is the
current year). The conditional create cannot overwrite an existing ID.

Relevant statuses: **201, 400, 401, 403, 409, 500**. An ID collision returns
`{"message":"Product ID conflict. Please retry."}` with 409.

```sh
curl -X POST "$BASE_URL/products" -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' --data '{"title":"Example Book","author":"Example Author","category":"Fiction","price":19.99,"stock":5}'
```

### PUT /products/:id

Partially update a product. **Admins only**. Required path `id`; no query
parameters. Only supplied writable fields change. Example request:

```json
{ "price": 17.5, "coverUrl": null }
```

**200** returns the complete updated [Product JSON object](#product-response-and-writable-fields)
directly; for the illustrated Product, `price` becomes 17.5, `coverUrl` is null,
and all other fields remain unchanged. `{}` returns the existing Product without
a write. `id` and unknown fields are rejected; null rules remain as above.

Relevant statuses: **200, 400, 401, 403, 404, 409, 500**. Missing/deleted Product:
`{"message":"Product not found."}` (404). Conflicting changes during the
repository read/write window return
`{"message":"Product changed during update. Please retry."}` (409).
This does not detect a stale client form loaded before the request. Changes to
title/author/ISBN also maintain the internal search data.

```sh
curl -X PUT "$BASE_URL/products/$PRODUCT_ID" -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' --data '{"price":17.5,"coverUrl":null}'
```

### DELETE /products/:id

Delete one Product record. **Admins only**. Required path `id`; no query
parameters or body. It does not scan or immediately delete all users' cart rows;
Cart reads handle stale references.

**200 response:**

```json
{ "deleted": "<product-id>" }
```

The value is the deleted ID. Relevant statuses: **200, 401, 403, 404, 500**.
Missing Product (including repeated deletion) returns
`{"message":"Product not found."}` (404).

```sh
curl -X DELETE "$BASE_URL/products/$PRODUCT_ID" -H "Authorization: Bearer $ID_TOKEN"
```

## 6. Cart API

All four operations require a valid Cognito ID token, with **no admin requirement**.
They operate only on the verified `sub` user's cart. There is no `userId` request
field or owner-selecting query parameter. No Cart endpoint has supported query
filters or pagination parameters.

### Cart response

Every successful Cart operation returns **200** and the complete current cart:

```json
{
  "items": [
    {
      "productId": "bk-example",
      "title": "Example Book",
      "author": "Example Author",
      "price": 19.99,
      "stock": 5,
      "quantity": 2,
      "subtotal": 39.98
    }
  ],
  "itemCount": 2,
  "total": 39.98
}
```

`itemCount` is **total units (sum of quantities)**, not distinct product lines.
Title/author/price/stock come from current Products, not client-supplied details.
Quantity comes from the stored cart line; subtotal is price times quantity and
total sums subtotals using Decimal internally. All numeric output is JSON numeric.
No ownership or storage-only Product fields are exposed.

Empty cart (also returned after removing its last line):

```json
{ "items": [], "itemCount": 0, "total": 0 }
```

Cart mutations do not reserve inventory. Stock/price can change concurrently;
GET does not cap an existing quantity if stock later falls. Responses are rebuilt
after mutation, rather than representing an atomic cart-and-products snapshot.

### GET /cart

Read the authenticated user's cart. No path parameters or body. Queries only
the user's partition, follows all DynamoDB pages, and loads current Products
with strong consistency. Missing Product references are omitted from the
[Cart response](#cart-response) and conditionally cleaned from this user's cart.
If the observed row changes concurrently, cleanup leaves it for a later read.
A stale reference does not itself produce 404.

Relevant statuses: **200, 401, 500**. Malformed stored data or unexpected cleanup
failure uses the safe 500 envelope.

```sh
curl "$BASE_URL/cart" -H "Authorization: Bearer $ID_TOKEN"
```

### POST /cart

Add a new line or **increment** an existing line. No path parameters. Request:

```json
{ "productId": "bk-example", "quantity": 2 }
```

`productId` is a required string, trimmed and non-empty. `quantity` defaults to 1
when omitted; if supplied it must be a strict positive integer. Null, zero,
negative, bool, string, and floating-point quantities are rejected. Unknown
fields, including `userId` or Product details, are rejected.

The Product must exist. The resulting quantity (existing quantity plus supplied
quantity) must not exceed current stock. **200** returns the complete
[Cart response](#cart-response), not just the changed line. Adding 2 to an empty
cart containing the example Product produces the response shown above.

Relevant statuses: **200, 400, 401, 404, 409, 500**:

- Missing Product: 404 `{"message":"Product not found."}`.
- Existing line deleted during the conditional-write window: 404
  `{"message":"That item is not in your cart."}`.
- Excess stock: 409 `{"message":"Requested quantity exceeds available stock."}`.
- Conflicting concurrent cart write: 409
  `{"message":"Cart changed during update. Please retry."}`.

```sh
curl -X POST "$BASE_URL/cart" -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' --data "{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}"
```

### PUT /cart/:productId

Set the line's **absolute quantity**. Required path `productId`: trimmed,
non-empty product ID. Request:

```json
{ "quantity": 2 }
```

`quantity` is required and must be a strict non-negative integer; null, bool,
string, fractional values, and unknown fields are rejected. Positive quantity
requires an existing cart line, then an existing Product, and must be within
current stock. It does not create a missing line.

`{"quantity":0}` removes an existing line without requiring the Product to still
exist. **200** returns the full [Cart response](#cart-response); removing the last
line returns the empty JSON example above.

Relevant statuses: **200, 400, 401, 404, 409, 500**. Missing cart line (including
zero quantity) returns 404 `{"message":"That item is not in your cart."}`.
For positive quantity, a missing Product returns 404
`{"message":"Product not found."}`. Stock and concurrent-write 409 messages
are the same as POST. A line deleted during the write window returns 404.

```sh
curl -X PUT "$BASE_URL/cart/$PRODUCT_ID" -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' --data '{"quantity":0}'
```

### DELETE /cart/:productId

Remove only that authenticated user's product line. Required path `productId`:
trimmed, non-empty product ID. No body. A live Product is not required, but the
cart line must exist. **200** returns the complete [Cart response](#cart-response),
including the empty JSON example when the last line is removed; it is not 204.

Relevant statuses: **200, 400, 401, 404, 500**. A whitespace-only ID returns 400.
A missing line (including repeated deletion) returns
`{"message":"That item is not in your cart."}` (404). This endpoint does not
define a 409 business conflict.

```sh
curl -X DELETE "$BASE_URL/cart/$PRODUCT_ID" -H "Authorization: Bearer $ID_TOKEN"
```

## 7. Checkout API

### POST /checkout

Create one Order from the authenticated user's cart. Requires
`Authorization: Bearer <Cognito ID token>`; no admin group is required. Ownership
comes only from verified `sub`. No path/query parameters or client-supplied
identity, product details, prices, totals, or order IDs are accepted in the body.

Request (`Content-Type: application/json`):

```json
{
  "shippingAddress": {
    "fullName": "Example Reader",
    "line1": "1 Example Street",
    "city": "Auckland",
    "postcode": "1010",
    "country": "New Zealand"
  }
}
```

All five address fields are required strings, trimmed and non-empty. Missing
fields, null, invalid types, and unknown fields at either body/address level
return 400. The existing malformed-JSON 400 and unsupported-content-type 415
boundary applies.

The cart must contain 1..40 unique product lines. Every referenced Product must
still exist and have enough stock. Checkout uses current Product title, author,
and price to store purchase-time Order item snapshots; totals are computed with
Decimal on the backend and returned as JSON numbers. There is no payment step.

**201 response** (illustrative IDs/time):

```json
{
  "orderId": "ord-example",
  "userId": "verified-cognito-sub",
  "placedAt": "2026-09-21T00:00:00Z",
  "status": "CONFIRMED",
  "shippingAddress": {
    "fullName": "Example Reader",
    "line1": "1 Example Street",
    "city": "Auckland",
    "postcode": "1010",
    "country": "New Zealand"
  },
  "items": [
    {
      "productId": "bk-example",
      "title": "Example Book",
      "author": "Example Author",
      "price": 19.99,
      "quantity": 2,
      "subtotal": 39.98
    }
  ],
  "total": 39.98
}
```

`orderId` is generated by the backend (`ord-` plus UUID4 hex). `placedAt` is a
UTC ISO timestamp. Items preserve purchase-time values even if Products later
change. The internal order sort key is not exposed.

Order creation, stock decrements, and removal of purchased cart lines commit
atomically. A rejected transaction makes none of those changes. Missing/stale
Products cause checkout to fail; checkout does not perform Cart's lazy cleanup.
Stock must still be sufficient at commit, and changes to price/title/author or
the checked-out cart quantities cause a 409 conflict. Refresh the cart before
retrying a conflict. Newly added product lines outside the checkout's observed
cart are not removed; there is no whole-cart revision lock.

There is no checkout idempotency key or replay guarantee. A timeout or lost
response can leave the outcome unknown even if the transaction committed;
inspect persisted state before resubmitting. Repeating after a successful
checkout normally finds an empty cart unless items were subsequently added.

| Status | Meaning/message |
| --- | --- |
| 201 | Created Order, returned directly. |
| 400 | Invalid body/address; `Your cart is empty.`; or `Checkout supports at most 40 unique cart lines.` |
| 401 | Missing/invalid Cognito ID token. |
| 404 | Product missing during initial validation: `Product not found.` |
| 409 | Initially insufficient stock: `Requested quantity exceeds available stock.` |
| 409 | Transaction condition/concurrency conflict, including a Product deleted after validation: `Checkout conflict. Refresh your cart and try again.` |
| 500 | Unexpected storage/internal failure, including capacity/configuration failure; standard safe envelope. |

Common framework errors (including 413/415) also apply. Errors expose neither
transaction cancellation details nor AWS resource identifiers.

```sh
curl -X POST "$BASE_URL/checkout" -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' --data '{"shippingAddress":{"fullName":"Example Reader","line1":"1 Example Street","city":"Auckland","postcode":"1010","country":"New Zealand"}}'
```

## 8. Future/not-yet-implemented APIs

These are contract targets with **no implemented Flask business routes**:

| Endpoint | Intended purpose/access |
| --- | --- |
| `GET /orders` | Authenticated user's order history. |
| `POST /upload_file` | Admin image upload. |

See the [authoritative contract](api-contract.md) for planned schemas. Existing
models do not make these operations available. Do not treat route-not-found
responses as implemented business behavior or claim uploads/S3 delivery work.

## 9. Verification status

As recorded in [current-status.md](current-status.md) on 2026-09-21:

| Endpoint | Implemented | Local manual verification | AWS manual verification |
| --- | --- | --- | --- |
| `GET /products` | Yes | Not recorded | Yes, user-reported |
| `GET /products/:id` | Yes | Not recorded | Yes, user-reported |
| `POST /products` | Yes | Not recorded | Yes, user-reported |
| `PUT /products/:id` | Yes | Not recorded | Yes, user-reported |
| `DELETE /products/:id` | Yes | Not recorded | Yes, user-reported |
| `GET /cart` | Yes | Yes, user-reported | Yes, user-reported |
| `POST /cart` | Yes | Yes, user-reported | Yes, user-reported |
| `PUT /cart/:productId` | Yes | Yes, user-reported | Yes, user-reported |
| `DELETE /cart/:productId` | Yes | Yes, user-reported | Yes, user-reported |
| `POST /checkout` | Yes | No | No |
| `GET /orders` | No | No | No |
| `POST /upload_file` | No | No | No |

Product CRUD was manually verified through the deployed API Gateway URL across
API Gateway -> Lambda Python 3.12 -> serverless-wsgi -> Flask -> DynamoDB,
including Cognito ID tokens, exact `admins` authorization, real Products-table
reads/writes, execution-role permissions, storage-only search data maintenance,
and numeric JSON output. This does not establish all error/concurrency cases.

The user reported Cart manual verification both locally and through the deployed
AWS API, including isolation between two Cognito users. This does not establish
every pagination/error/concurrency edge case.

Checkout is implemented but has not been deployed or manually verified locally
or in AWS. Recorded syntax/import, route registration, schema and configuration
checks are **not manual endpoint verification**. No verification is inferred from
code or generated tests. Checkout atomicity, conflicts, money, identity isolation,
and real Orders persistence/IAM remain manual integration work. GET /orders,
uploads, S3 delivery, and frontend integration remain unverified.

The contract's dated 2026-09-11 implementation-status paragraph describes an older
snapshot with no business routes; it is not the current implementation inventory.
No behavioral contract conflict was found during this reference review. Current
415 handling is an existing framework behavior documented in current-status.md,
not a replacement for invalid-JSON 400 handling.

API changes must update this reference in the same task under
[AGENTS.md](../AGENTS.md#api-reference-maintenance). Report conflicts with the
authoritative contract rather than silently rewriting it. Keep implementation,
local manual verification, and AWS manual verification as separate claims.
