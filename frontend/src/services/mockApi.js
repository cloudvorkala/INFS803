/* ---------------------------------------------------------------------------
   In-memory mock of the team's RESTful API.

   WHY THIS EXISTS
   ---------------
   The client layer must be buildable and demonstrable before the backend
   teammate has deployed anything. This module implements the same routes, the
   same request/response JSON, and the same status codes the real API will use,
   so when VITE_API_BASE_URL is finally set the components do not change at all.

   WHAT IT COVERS
   --------------
   The 11 resource routes below. Sign-up / sign-in / sign-out are NOT here:
   those are served by the auth provider (Cognito in production, `mockAuth.js`
   locally) — see the note in README.md about how that affects the endpoint
   count you report.

     GET    /products              list, supports ?category= and ?search=
     GET    /products/:id          one product
     POST   /products              create (admin)
     PUT    /products/:id          update (admin)
     DELETE /products/:id          delete (admin)
     GET    /cart                  current user's cart
     POST   /cart                  add item { productId, quantity }
     DELETE /cart/:productId       remove item
     POST   /checkout              cart -> order
     GET    /orders                order history
     POST   /upload_file           cover image upload (admin) -> returns URL

   State persists to localStorage so a page refresh does not wipe the demo.
   --------------------------------------------------------------------------- */

import seedBooks from '../data/books.json';
import { MOCK_DB_KEY } from './config.js';
import { readJSON, writeJSON } from './storage.js';

/** Mirrors the error shape the real API returns: { message } with an HTTP status. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* --- Persistence ----------------------------------------------------------- */

function freshDb() {
  return {
    products: seedBooks.map((b) => ({ ...b })),
    carts: {}, // { [userSub]: [{ productId, quantity }] }
    orders: {}, // { [userSub]: Order[] }
    uploads: {}, // { [fileId]: dataUrl }
  };
}

function loadDb() {
  const db = readJSON(MOCK_DB_KEY, null);
  if (db?.products?.length) return db;
  const seeded = freshDb();
  writeJSON(MOCK_DB_KEY, seeded);
  return seeded;
}

function saveDb(db) {
  writeJSON(MOCK_DB_KEY, db);
}

/** Wipe the mock database back to seed data (used by the dev reset button). */
export function resetMockDb() {
  writeJSON(MOCK_DB_KEY, freshDb());
}

/* --- Auth helpers ---------------------------------------------------------- */

function decodeToken(token) {
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Equivalent to API Gateway's Cognito Authorizer rejecting with 401. */
function requireUser(token) {
  const claims = decodeToken(token);
  if (!claims?.sub) throw new ApiError(401, 'Unauthorized — please sign in.');
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new ApiError(401, 'Session expired — please sign in again.');
  }
  return claims;
}

/** Equivalent to a Lambda checking the `cognito:groups` claim, rejecting 403. */
function requireAdmin(token) {
  const claims = requireUser(token);
  const groups = claims['cognito:groups'] ?? [];
  if (!groups.includes('admins')) {
    throw new ApiError(403, 'Forbidden — this action requires an admin account.');
  }
  return claims;
}

/* --- Helpers --------------------------------------------------------------- */

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function findProduct(db, id) {
  const product = db.products.find((p) => p.id === id);
  if (!product) throw new ApiError(404, `No product with id "${id}".`);
  return product;
}

/** Expand stored cart lines into the shape the UI renders. */
function expandCart(db, sub) {
  const lines = db.carts[sub] ?? [];
  const items = lines
    .map((line) => {
      const product = db.products.find((p) => p.id === line.productId);
      if (!product) return null;
      return {
        productId: product.id,
        title: product.title,
        author: product.author,
        price: product.price,
        stock: product.stock,
        quantity: line.quantity,
        subtotal: Number((product.price * line.quantity).toFixed(2)),
      };
    })
    .filter(Boolean);

  const total = Number(items.reduce((sum, i) => sum + i.subtotal, 0).toFixed(2));
  return { items, itemCount: items.reduce((n, i) => n + i.quantity, 0), total };
}

/* --- Router ---------------------------------------------------------------- */

/**
 * Dispatch a request against the mock backend.
 *
 * @param {string} method  HTTP verb
 * @param {string} path    e.g. "/products/bk-001?search=maps"
 * @param {object} opts    { body, token }
 * @returns {Promise<any>} parsed response body
 */
export async function handleRequest(method, path, { body = null, token = null } = {}) {
  await delay();

  const db = loadDb();
  const [rawPath, rawQuery = ''] = path.split('?');
  const query = new URLSearchParams(rawQuery);
  const segments = rawPath.split('/').filter(Boolean);
  const [resource, param] = segments;

  /* ---- /products --------------------------------------------------------- */
  if (resource === 'products') {
    if (method === 'GET' && !param) {
      let results = [...db.products];

      const category = query.get('category');
      if (category && category !== 'All') {
        results = results.filter(
          (p) => p.category.toLowerCase() === category.toLowerCase()
        );
      }

      const search = (query.get('search') || '').trim().toLowerCase();
      if (search) {
        results = results.filter(
          (p) =>
            p.title.toLowerCase().includes(search) ||
            p.author.toLowerCase().includes(search) ||
            p.isbn.includes(search)
        );
      }

      return { count: results.length, products: results };
    }

    if (method === 'GET' && param) {
      return findProduct(db, param);
    }

    if (method === 'POST' && !param) {
      requireAdmin(token);
      const required = ['title', 'author', 'category', 'price'];
      const missing = required.filter((f) => !body?.[f]);
      if (missing.length) {
        throw new ApiError(400, `Missing required field(s): ${missing.join(', ')}.`);
      }
      const product = {
        id: `bk-${Date.now().toString(36)}`,
        title: body.title,
        author: body.author,
        category: body.category,
        price: Number(body.price),
        stock: Number(body.stock ?? 0),
        isbn: body.isbn ?? '',
        publishedYear: Number(body.publishedYear ?? new Date().getFullYear()),
        coverUrl: body.coverUrl ?? null,
        description: body.description ?? '',
      };
      db.products.unshift(product);
      saveDb(db);
      return product;
    }

    if (method === 'PUT' && param) {
      requireAdmin(token);
      const product = findProduct(db, param);
      Object.assign(product, {
        ...body,
        id: product.id, // id is immutable
        price: body.price != null ? Number(body.price) : product.price,
        stock: body.stock != null ? Number(body.stock) : product.stock,
      });
      saveDb(db);
      return product;
    }

    if (method === 'DELETE' && param) {
      requireAdmin(token);
      findProduct(db, param);
      db.products = db.products.filter((p) => p.id !== param);
      // Drop the product from every cart so nothing dangles.
      Object.keys(db.carts).forEach((sub) => {
        db.carts[sub] = db.carts[sub].filter((l) => l.productId !== param);
      });
      saveDb(db);
      return { deleted: param };
    }
  }

  /* ---- /cart ------------------------------------------------------------- */
  if (resource === 'cart') {
    const { sub } = requireUser(token);

    if (method === 'GET' && !param) {
      return expandCart(db, sub);
    }

    if (method === 'POST' && !param) {
      const { productId, quantity = 1 } = body ?? {};
      if (!productId) throw new ApiError(400, 'productId is required.');
      const product = findProduct(db, productId);

      const lines = db.carts[sub] ?? [];
      const existing = lines.find((l) => l.productId === productId);
      const requested = (existing?.quantity ?? 0) + Number(quantity);

      if (requested > product.stock) {
        throw new ApiError(
          409,
          `Only ${product.stock} cop${product.stock === 1 ? 'y' : 'ies'} of "${product.title}" in stock.`
        );
      }

      if (existing) existing.quantity = requested;
      else lines.push({ productId, quantity: Number(quantity) });

      db.carts[sub] = lines;
      saveDb(db);
      return expandCart(db, sub);
    }

    /* PUT sets an absolute quantity, where POST adds to it. Without this the
       only way to reduce a line is to delete and re-add, which loses the line
       and races with itself. Quantity 0 is treated as a removal. */
    if (method === 'PUT' && param) {
      const quantity = Number(body?.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new ApiError(400, 'quantity must be a whole number of 0 or more.');
      }

      const lines = db.carts[sub] ?? [];
      const existing = lines.find((l) => l.productId === param);
      if (!existing) throw new ApiError(404, 'That item is not in your cart.');

      if (quantity === 0) {
        db.carts[sub] = lines.filter((l) => l.productId !== param);
        saveDb(db);
        return expandCart(db, sub);
      }

      const product = findProduct(db, param);
      if (quantity > product.stock) {
        throw new ApiError(
          409,
          `Only ${product.stock} cop${product.stock === 1 ? 'y' : 'ies'} of "${product.title}" in stock.`
        );
      }

      existing.quantity = quantity;
      db.carts[sub] = lines;
      saveDb(db);
      return expandCart(db, sub);
    }

    if (method === 'DELETE' && param) {
      const lines = db.carts[sub] ?? [];
      if (!lines.some((l) => l.productId === param)) {
        throw new ApiError(404, 'That item is not in your cart.');
      }
      db.carts[sub] = lines.filter((l) => l.productId !== param);
      saveDb(db);
      return expandCart(db, sub);
    }
  }

  /* ---- /checkout --------------------------------------------------------- */
  if (resource === 'checkout' && method === 'POST') {
    const claims = requireUser(token);
    const { sub } = claims;
    const cart = expandCart(db, sub);

    if (!cart.items.length) throw new ApiError(400, 'Your cart is empty.');

    // Re-check stock at checkout time — the classic race a real backend must
    // handle too (ideally inside a DynamoDB transaction / SQL transaction).
    for (const item of cart.items) {
      const product = findProduct(db, item.productId);
      if (item.quantity > product.stock) {
        throw new ApiError(
          409,
          `"${product.title}" no longer has ${item.quantity} in stock.`
        );
      }
    }

    cart.items.forEach((item) => {
      findProduct(db, item.productId).stock -= item.quantity;
    });

    const order = {
      orderId: `ord-${Date.now().toString(36)}`,
      userId: sub,
      placedAt: new Date().toISOString(),
      status: 'CONFIRMED',
      shippingAddress: body?.shippingAddress ?? null,
      items: cart.items.map(({ productId, title, author, price, quantity, subtotal }) => ({
        productId,
        title,
        author,
        price,
        quantity,
        subtotal,
      })),
      total: cart.total,
    };

    db.orders[sub] = [order, ...(db.orders[sub] ?? [])];
    db.carts[sub] = [];
    saveDb(db);
    return order;
  }

  /* ---- /orders ----------------------------------------------------------- */
  if (resource === 'orders' && method === 'GET' && !param) {
    const { sub } = requireUser(token);
    const orders = db.orders[sub] ?? [];
    return { count: orders.length, orders };
  }

  /* ---- /upload_file ------------------------------------------------------ */
  if (resource === 'upload_file' && method === 'POST') {
    requireAdmin(token);
    const { filename, dataUrl } = body ?? {};
    if (!dataUrl) throw new ApiError(400, 'No file supplied.');

    // The real endpoint streams the file into an S3 bucket and returns the
    // object URL (or a pre-signed PUT URL for the client to upload to directly).
    // Here we just keep the data URL and hand back an S3-shaped path.
    const fileId = `img-${Date.now().toString(36)}`;
    db.uploads[fileId] = dataUrl;
    saveDb(db);

    return {
      fileId,
      filename: filename ?? `${fileId}.jpg`,
      // Shaped like a real S3 object URL so the report screenshots match.
      url: dataUrl,
      s3Key: `covers/${fileId}.jpg`,
    };
  }

  throw new ApiError(404, `No mock route for ${method} ${rawPath}.`);
}
