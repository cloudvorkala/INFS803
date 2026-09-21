/* ---------------------------------------------------------------------------
   Reference backend — a development aid, NOT the submission backend.

   Implements all 15 documented routes over real HTTP with in-memory state, so
   the client can be developed and tested against genuine network calls (CORS,
   status codes, Authorization headers) before the cloud backend is deployed.

   Two uses:
     1. Frontend dev: run this, set VITE_API_BASE_URL=http://localhost:4000 and
        VITE_AUTH_MODE=api, and you are exercising the real code path.
     2. Backend teammate: read it as an executable spec. Every route's request
        and response shape is what the client expects.

   Run:  node tools/reference-server.mjs
   No dependencies — Node's built-in http module only.
   --------------------------------------------------------------------------- */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4000);
const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'books.json'), 'utf8'));

/* --- State ---------------------------------------------------------------- */

const db = {
  products: seed.map((b) => ({ ...b })),
  users: [
    { sub: 'usr-admin', email: 'admin@paperbound.test', password: 'Admin123!', name: 'Store Admin', groups: ['admins'] },
    { sub: 'usr-demo', email: 'reader@paperbound.test', password: 'Reader123!', name: 'Demo Reader', groups: [] },
  ],
  tokens: new Map(), // token -> sub
  carts: {},
  orders: {},
};

/* --- Helpers -------------------------------------------------------------- */

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Unsigned JWT with Cognito's claim shape. A real backend returns a signed one. */
function mintToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const token = [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({
      sub: user.sub,
      email: user.email,
      name: user.name,
      'cognito:groups': user.groups,
      iat: now,
      exp: now + 3600,
    }),
    'reference-signature',
  ].join('.');
  db.tokens.set(token, user.sub);
  return token;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function userFor(token) {
  const sub = token && db.tokens.get(token);
  if (!sub) throw new HttpError(401, 'Unauthorized — please sign in.');
  return db.users.find((u) => u.sub === sub);
}

function adminFor(token) {
  const user = userFor(token);
  if (!user.groups.includes('admins')) {
    throw new HttpError(403, 'Forbidden — this action requires an admin account.');
  }
  return user;
}

function product(id) {
  const found = db.products.find((p) => p.id === id);
  if (!found) throw new HttpError(404, `No product with id "${id}".`);
  return found;
}

function cartFor(sub) {
  const lines = db.carts[sub] ?? [];
  const items = lines
    .map((line) => {
      const p = db.products.find((x) => x.id === line.productId);
      if (!p) return null;
      return {
        productId: p.id,
        title: p.title,
        author: p.author,
        price: p.price,
        stock: p.stock,
        quantity: line.quantity,
        subtotal: Number((p.price * line.quantity).toFixed(2)),
      };
    })
    .filter(Boolean);
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    total: Number(items.reduce((s, i) => s + i.subtotal, 0).toFixed(2)),
  };
}

/* --- Routing -------------------------------------------------------------- */

function route(method, segments, query, body, token) {
  const [resource, param] = segments;

  // 1-3: auth routes owned by this API
  if (resource === 'register' && method === 'POST') {
    const { name, email, password } = body ?? {};
    if (!email || !password) throw new HttpError(400, 'email and password are required.');
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new HttpError(409, 'An account with that email already exists.');
    }
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    const user = { sub: `usr-${randomUUID().slice(0, 8)}`, email, password, name: name ?? email, groups: [] };
    db.users.push(user);
    return { status: 201, payload: { userId: user.sub, email: user.email } };
  }

  if (resource === 'login' && method === 'POST') {
    const { email, password } = body ?? {};
    const user = db.users.find(
      (u) => u.email.toLowerCase() === (email ?? '').toLowerCase() && u.password === password
    );
    if (!user) throw new HttpError(401, 'Incorrect email or password.');
    return {
      status: 200,
      payload: {
        token: mintToken(user),
        user: { id: user.sub, email: user.email, name: user.name, groups: user.groups },
      },
    };
  }

  if (resource === 'logout' && method === 'POST') {
    userFor(token);
    db.tokens.delete(token);
    return { status: 200, payload: { message: 'Signed out.' } };
  }

  // 4-8: products
  if (resource === 'products') {
    if (method === 'GET' && !param) {
      let results = [...db.products];
      const category = query.get('category');
      if (category && category !== 'All') {
        results = results.filter((p) => p.category.toLowerCase() === category.toLowerCase());
      }
      const search = (query.get('search') ?? '').trim().toLowerCase();
      if (search) {
        results = results.filter(
          (p) =>
            p.title.toLowerCase().includes(search) ||
            p.author.toLowerCase().includes(search) ||
            p.isbn.includes(search)
        );
      }
      return { status: 200, payload: { count: results.length, products: results } };
    }

    if (method === 'GET' && param) return { status: 200, payload: product(param) };

    if (method === 'POST' && !param) {
      adminFor(token);
      const missing = ['title', 'author', 'category', 'price'].filter((f) => !body?.[f]);
      if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}.`);
      const created = {
        id: `bk-${randomUUID().slice(0, 8)}`,
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
      db.products.unshift(created);
      return { status: 201, payload: created };
    }

    if (method === 'PUT' && param) {
      adminFor(token);
      const existing = product(param);
      Object.assign(existing, {
        ...body,
        id: existing.id,
        price: body?.price != null ? Number(body.price) : existing.price,
        stock: body?.stock != null ? Number(body.stock) : existing.stock,
      });
      return { status: 200, payload: existing };
    }

    if (method === 'DELETE' && param) {
      adminFor(token);
      product(param);
      db.products = db.products.filter((p) => p.id !== param);
      Object.keys(db.carts).forEach((sub) => {
        db.carts[sub] = db.carts[sub].filter((l) => l.productId !== param);
      });
      return { status: 200, payload: { deleted: param } };
    }
  }

  // 9-11: cart
  if (resource === 'cart') {
    const { sub } = userFor(token);

    if (method === 'GET' && !param) return { status: 200, payload: cartFor(sub) };

    if (method === 'POST' && !param) {
      const { productId, quantity = 1 } = body ?? {};
      if (!productId) throw new HttpError(400, 'productId is required.');
      const p = product(productId);
      const lines = db.carts[sub] ?? [];
      const existing = lines.find((l) => l.productId === productId);
      const wanted = (existing?.quantity ?? 0) + Number(quantity);
      if (wanted > p.stock) {
        throw new HttpError(409, `Only ${p.stock} cop${p.stock === 1 ? 'y' : 'ies'} of "${p.title}" in stock.`);
      }
      if (existing) existing.quantity = wanted;
      else lines.push({ productId, quantity: Number(quantity) });
      db.carts[sub] = lines;
      return { status: 200, payload: cartFor(sub) };
    }

    // PUT sets an absolute quantity; POST adds to it. 0 removes the line.
    if (method === 'PUT' && param) {
      const quantity = Number(body?.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new HttpError(400, 'quantity must be a whole number of 0 or more.');
      }

      const lines = db.carts[sub] ?? [];
      const existing = lines.find((l) => l.productId === param);
      if (!existing) throw new HttpError(404, 'That item is not in your cart.');

      if (quantity === 0) {
        db.carts[sub] = lines.filter((l) => l.productId !== param);
        return { status: 200, payload: cartFor(sub) };
      }

      const p = product(param);
      if (quantity > p.stock) {
        throw new HttpError(409, `Only ${p.stock} cop${p.stock === 1 ? 'y' : 'ies'} of "${p.title}" in stock.`);
      }

      existing.quantity = quantity;
      return { status: 200, payload: cartFor(sub) };
    }

    if (method === 'DELETE' && param) {
      const lines = db.carts[sub] ?? [];
      if (!lines.some((l) => l.productId === param)) {
        throw new HttpError(404, 'That item is not in your cart.');
      }
      db.carts[sub] = lines.filter((l) => l.productId !== param);
      return { status: 200, payload: cartFor(sub) };
    }
  }

  // 12: checkout
  if (resource === 'checkout' && method === 'POST') {
    const { sub } = userFor(token);
    const cart = cartFor(sub);
    if (!cart.items.length) throw new HttpError(400, 'Your cart is empty.');

    for (const item of cart.items) {
      const p = product(item.productId);
      if (item.quantity > p.stock) {
        throw new HttpError(409, `"${p.title}" no longer has ${item.quantity} in stock.`);
      }
    }
    cart.items.forEach((item) => {
      product(item.productId).stock -= item.quantity;
    });

    const order = {
      orderId: `ord-${randomUUID().slice(0, 8)}`,
      userId: sub,
      placedAt: new Date().toISOString(),
      status: 'CONFIRMED',
      shippingAddress: body?.shippingAddress ?? null,
      items: cart.items.map(({ productId, title, author, price, quantity, subtotal }) => ({
        productId, title, author, price, quantity, subtotal,
      })),
      total: cart.total,
    };
    db.orders[sub] = [order, ...(db.orders[sub] ?? [])];
    db.carts[sub] = [];
    return { status: 201, payload: order };
  }

  // 13: orders
  if (resource === 'orders' && method === 'GET' && !param) {
    const { sub } = userFor(token);
    const orders = db.orders[sub] ?? [];
    return { status: 200, payload: { count: orders.length, orders } };
  }

  // 14: upload_file
  if (resource === 'upload_file' && method === 'POST') {
    adminFor(token);
    const { filename, dataUrl } = body ?? {};
    if (!dataUrl) throw new HttpError(400, 'No file supplied.');
    const fileId = `img-${randomUUID().slice(0, 8)}`;
    return {
      status: 201,
      payload: {
        fileId,
        filename: filename ?? `${fileId}.jpg`,
        url: dataUrl, // the real endpoint returns the S3 object URL
        s3Key: `covers/${fileId}.jpg`,
      },
    };
  }

  throw new HttpError(404, `No route for ${method} /${segments.join('/')}.`);
}

/* --- Server --------------------------------------------------------------- */

const server = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const segments = url.pathname.split('/').filter(Boolean);
    let body = null;
    if (chunks.length) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
    }

    const send = (status, payload) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      console.log(`${req.method} ${url.pathname} -> ${status}`);
    };

    try {
      const { status, payload } = route(
        req.method,
        segments,
        url.searchParams,
        body,
        req.headers.authorization?.replace(/^Bearer /, '') ?? null
      );
      send(status, payload);
    } catch (err) {
      send(err.status ?? 500, { message: err.message });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Reference backend on http://localhost:${PORT}`);
  console.log('Point the client at it:');
  console.log(`  VITE_API_BASE_URL=http://localhost:${PORT}`);
  console.log('  VITE_AUTH_MODE=api');
});
