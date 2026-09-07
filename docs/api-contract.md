# API Contract

This contract is currently agreed with the frontend developer.

Do not change it without coordination.

## Products

GET /products?category=&search=
- Public
- Lists products
- category and search are optional

GET /products/:id
- Public
- Returns one product

POST /products
- Admin only
- Product fields in body

PUT /products/:id
- Admin only
- Changed fields in body

DELETE /products/:id
- Admin only

## Cart

GET /cart
- Authentication required
- Returns the current authenticated user's cart

POST /cart

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

DELETE /cart/:productId

## Checkout

POST /checkout

Request:
{
  "shippingAddress": ...
}

Turns the authenticated user's cart into an order.

## Orders

GET /orders

Returns order history for the authenticated user.

## Upload

POST /upload_file
- Admin only

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