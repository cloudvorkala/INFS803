/* ---------------------------------------------------------------------------
   The single place the client layer talks to the backend.

   Every call attaches the current ID token as the `Authorization` header, which
   is exactly what API Gateway's Cognito Authorizer inspects before the request
   ever reaches Lambda. When VITE_API_BASE_URL is empty the same call is routed
   to `mockApi.js` instead, so the UI is fully functional before deployment.

   Components never call fetch() directly — they call the named functions at the
   bottom of this file. That keeps the endpoint list in one auditable place,
   which is also what you screenshot for the RESTful API section of the report.
   --------------------------------------------------------------------------- */

import { API_BASE_URL, USE_MOCK_API } from './config.js';
import { getIdToken } from './authService.js';
import { handleRequest, ApiError } from './mockApi.js';

export { ApiError };

/**
 * Perform a request against the real API, or the mock when no base URL is set.
 *
 * @param {string} method
 * @param {string} path   path + query string, e.g. "/products?category=Poetry"
 * @param {object} [body] JSON body for POST/PUT
 */
async function request(method, path, body) {
  const token = await getIdToken();

  if (USE_MOCK_API) {
    return handleRequest(method, path, { body, token });
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // API Gateway's Cognito Authorizer reads the raw JWT from this header.
        // If your teammate uses a custom Lambda authorizer expecting a Bearer
        // prefix, change this one line to `Bearer ${token}`.
        ...(token ? { Authorization: token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the API. Is the backend deployed and CORS enabled?');
  }

  if (response.status === 204) return null;

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ?? `Request failed with status ${response.status}.`
    );
  }

  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '' && value !== 'All') search.set(key, value);
  });
  const str = search.toString();
  return str ? `?${str}` : '';
};

/* --- Endpoint bindings ------------------------------------------------------
   One function per RESTful route. The comment above each is the exact row you
   can lift into the API table in the report.
   -------------------------------------------------------------------------- */

/** GET /products — list products, optional ?category= and ?search= */
export const listProducts = ({ category, search } = {}) =>
  request('GET', `/products${qs({ category, search })}`);

/** GET /products/:id — one product */
export const getProduct = (id) => request('GET', `/products/${id}`);

/** POST /products — create a product (admin) */
export const createProduct = (product) => request('POST', '/products', product);

/** PUT /products/:id — update a product (admin) */
export const updateProduct = (id, changes) => request('PUT', `/products/${id}`, changes);

/** DELETE /products/:id — remove a product (admin) */
export const deleteProduct = (id) => request('DELETE', `/products/${id}`);

/** GET /cart — the signed-in user's cart */
export const getCart = () => request('GET', '/cart');

/** POST /cart — add an item { productId, quantity } */
export const addToCart = (productId, quantity = 1) =>
  request('POST', '/cart', { productId, quantity });

/** PUT /cart/:productId — set an item's quantity outright (0 removes it) */
export const updateCartItem = (productId, quantity) =>
  request('PUT', `/cart/${productId}`, { quantity });

/** DELETE /cart/:productId — remove an item */
export const removeFromCart = (productId) => request('DELETE', `/cart/${productId}`);

/** POST /checkout — convert the cart into an order */
export const checkout = (shippingAddress) => request('POST', '/checkout', { shippingAddress });

/** GET /orders — order history for the signed-in user */
export const getOrders = () => request('GET', '/orders');

/** POST /upload_file — upload a cover image to S3, returns { url, s3Key } (admin) */
export const uploadFile = (filename, dataUrl) =>
  request('POST', '/upload_file', { filename, dataUrl });
