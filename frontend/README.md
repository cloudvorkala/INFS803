# Paperbound — React client layer

Frontend for the INFS803 Assignment 2 (Option B) three-tier cloud application: an online
bookstore of 100 titles. This is the **client layer only** — it talks to the team's
RESTful API over HTTP and holds no business logic of its own.

It runs standalone. Until the backend is deployed, an in-memory mock API serves the same
routes with the same JSON, so the UI is fully demonstrable today and switches to the real
stack by editing two lines in `.env`.

```
Client layer   ← this repo (React + Vite)
Backend layer  ← teammate: API Gateway + Lambda, or EC2 + Express
Database layer ← teammate: DynamoDB / RDS / Firebase  + S3 for assets
```

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173, mock data, no backend needed
```

Other scripts:

| Command | What it does |
| ------- | ------------ |
| `npm run build` | Production build. **Refuses to run** without a real API URL — see below. |
| `npm run build:demo` | Explicit mock-data build, for previews and design review. |
| `npm run preview` | Serve the built output locally. |
| `npm run api` | Start the reference backend on :4000 (all 15 routes, real HTTP). |
| `npm run catalogue` | Regenerate the 100 books, their cover images, and the seed-data exports. |

### Demo accounts (mock auth only)

| Role | Email | Password |
| ---- | ----- | -------- |
| Reader | `reader@paperbound.test` | `Reader123!` |
| Admin | `admin@paperbound.test` | `Admin123!` |

---

## Two failure modes this build refuses to ship

Both of these produce a deployment that **looks fine and is broken**, which is the worst
kind. They are now handled in code rather than in a checklist somebody has to remember.

### 1. Silent mock-API fallback

`VITE_*` variables are substituted into the bundle at build time. If `VITE_API_BASE_URL`
is empty, the client falls back to its in-memory mock API and still works perfectly —
so a broken deployment is indistinguishable from a working one until you open the
network tab. A marker seeing that is looking at a one-tier app.

`scripts/check-env.mjs` runs before every build and **fails the build** rather than
producing that artefact. It also blocks any `VITE_` variable whose name looks like a
credential, since everything `VITE_`-prefixed is compiled into public JavaScript.

```
  BUILD BLOCKED — this would deploy as a fake three-tier app
    · VITE_API_BASE_URL is empty — the build would ship the in-memory mock API.
    · VITE_AUTH_MODE is "mock" — nobody can actually sign in.
```

Building the demo on purpose is still one command: `npm run build:demo`.

### 2. Deep links 404 on static hosting

This is a single-page app. The browser asks S3 for `/orders`, no object exists at that
key, and a plain static host returns 404. `scripts/post-build.mjs` ships two fixes with
the build so they cannot be forgotten:

- **`dist/404.html`** — a byte copy of `index.html`. S3 static website hosting and
  GitHub Pages serve it automatically for unmatched paths.
- **`dist/_redirects`** — `/*  /index.html  200`, read by Amplify and Netlify.

CloudFront still needs its own config — see `DEPLOYMENT.md`, and note the trap: with
Origin Access Control a missing key returns **403, not 404**, so both must be mapped.

---

## The catalogue

100 books across 8 categories, every one with a price, stock level, valid ISBN-13,
description, and a **cover image**.

Covers are generated (`tools/build-catalogue.mjs`) as SVG files in `public/covers/`,
designed as dyed bookbinding cloth with foil-stamped type — six layouts across ten cloth
colours, chosen deterministically per title. They ship to S3 with the client, so the grid
is never full of placeholder gaps, and they are meant to be replaced: upload a real cover
through `/admin` and the API returns that S3 URL instead.

`npm run catalogue` regenerates the books, the covers, and the backend seed exports
together, so the three cannot drift apart.

### Seed data for the database layer

`tools/seed-data/` holds the same 100 books as `products.json`, `products.sql`
(verified: loads 100 rows), and four DynamoDB `BatchWriteItem` payloads. See the README
in that folder for load commands.

---

## Testing against a real HTTP backend

`tools/reference-server.mjs` implements **all 15 documented routes** over real HTTP with
in-memory state — no dependencies, Node's `http` module only. Use it to develop against
genuine network calls (CORS, status codes, `Authorization` headers) before the cloud
backend exists, and hand it to your backend teammate as an executable spec.

```bash
npm run api            # http://localhost:4000
```

```bash
# .env
VITE_API_BASE_URL=http://localhost:4000
VITE_AUTH_MODE=api
```

---

## Auth: three modes, one env var

The original plan listed 14 routes including `/register`, `/login`, `/logout` *and* used
Cognito. Those overlap — if Cognito owns sign-in, those three are not your API's routes.
Both answers are implemented; flip `VITE_AUTH_MODE`, no code changes:

| Mode | Who owns register/login/logout | Your route count |
| ---- | ------------------------------ | ---------------- |
| `mock` | local demo accounts | development only |
| `cognito` | Cognito User Pool, via Amplify in the browser | 12 (4 POSTs) |
| `api` | your backend, calling Cognito server-side | 15 (6 POSTs) |

Both clear the brief's 10-route / 3-POST minimum. **Decide which one is deployed and
make the report match it.**

To use real Cognito: `npm install aws-amplify`, then set `VITE_AUTH_MODE=cognito` plus
the pool values below. `src/services/cognitoAuth.js` is already written against the
Amplify v6 API.

```bash
VITE_COGNITO_USER_POOL_ID=ap-southeast-2_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_REGION=ap-southeast-2
```

In the AWS Console: create a User Pool (sign-in by email; required attributes `email`
and `name`), create an **app client with no client secret** — a browser app cannot keep
one — and create a group named `admins` for whoever should reach `/admin`.

**What you must never accept from the AWS account owner:** an access key pair, an
app-client secret, or a DB connection string. The three Cognito values above are public
identifiers designed to ship in a browser bundle; secrets belong in Lambda environment
variables or Secrets Manager. The build blocks the obvious mistakes, but the rule is
worth a sentence in the report.

---

## Routes this client calls

Every call lives in `src/services/apiClient.js` — one function per endpoint.

| # | Method | Endpoint | Auth | Mode |
| - | ------ | -------- | ---- | ---- |
| 1 | POST | `/register` | No | `api` only |
| 2 | POST | `/login` | No | `api` only |
| 3 | POST | `/logout` | Yes | `api` only |
| 4 | GET | `/products` | No | always |
| 5 | GET | `/products/:id` | No | always |
| 6 | POST | `/products` | Admin | always |
| 7 | PUT | `/products/:id` | Admin | always |
| 8 | DELETE | `/products/:id` | Admin | always |
| 9 | GET | `/cart` | Yes | always |
| 10 | POST | `/cart` | Yes | always |
| 11 | PUT | `/cart/:productId` | Yes | always |
| 12 | DELETE | `/cart/:productId` | Yes | always |
| 13 | POST | `/checkout` | Yes | always |
| 14 | GET | `/orders` | Yes | always |
| 15 | POST | `/upload_file` | Admin | always |

`GET /products` supports `?category=` and `?search=` (title, author, or ISBN).

Sorting and paging are done client-side over the response — with 100 titles that is one
round trip and instant re-sorts. Past a few hundred, add `?page=` and `?sort=` to
`GET /products` rather than doing more work in the client.

Full request/response shapes: `tools/reference-server.mjs`, or `src/services/mockApi.js`.

---

## Project structure

```
src/
  main.jsx                 entry; imports the self-hosted typefaces
  App.jsx                  route table + providers
  services/
    config.js              reads .env once
    authService.js         ← the ONLY auth import for components
    mockAuth.js            local provider
    cognitoAuth.js         real Cognito (Amplify v6)
    apiAuth.js             your API's own /register /login /logout
    apiClient.js           ← the ONLY API import for components
    mockApi.js             in-memory backend, 11 resource routes
    storage.js             guarded localStorage wrapper
  context/                 AuthContext, CartContext
  components/              Header, ProductCard, BookCover, ProtectedRoute, …
  pages/                   Catalogue, ProductDetail, Cart, Checkout, Orders,
                           Login, Register, Admin, NotFound
  data/books.json          100 books (generated)
  styles/global.css        design tokens, light + dark
public/covers/             100 cover images (generated)
scripts/                   build guard + post-build SPA fix
tools/                     catalogue generator, reference backend, seed data
```

Two seams do all the work: **`authService.js`** hides which auth provider is live, and
**`apiClient.js`** hides whether the API is real. Components import from those two files
and never from `mockApi`, `mockAuth`, `cognitoAuth`, or `apiAuth` directly.

---

## Design

The identity is bookbinding: dyed cloth green, gold foil, laid paper. Fraunces for
display, Karla for everything operational — both **self-hosted** via `@fontsource`
rather than loaded from Google Fonts, so there is no third-party request on the critical
path and the typography survives a CDN being unreachable.

Light and dark are both designed, driven by `prefers-color-scheme`. Every colour is a
token in `src/styles/global.css`; components never hard-code one, which is what keeps
the two themes consistent.

---

## Notes for the report

Each of these maps onto a rubric criterion and the reasoning is already in the code
comments:

- **`ProtectedRoute` is not security.** It hides UI. Anyone can edit the JS in their
  browser and render `/admin`. The real control is the Cognito Authorizer plus the
  `cognito:groups` check in Lambda. Saying so reads as understanding, not oversight.
  *(Criterion 4)*
- **No card details are collected.** Checkout takes a shipping address only; a real
  deployment redirects to a hosted payment page so card data never touches your
  infrastructure and PCI scope stays with the provider. *(Criterion 4)*
- **Stock is re-checked at checkout**, not just at add-to-cart, because a cart can sit
  for hours. In a real backend that check and the decrement belong in one transaction —
  DynamoDB `TransactWriteItems` with a condition expression, or a SQL transaction.
  *(Criterion 2)*
- **The cart lives on the server**, keyed by the user's `sub`, so it survives a device
  change. That is what makes this genuinely three-tier. *(Criterion 1/2)*
- **The build refuses to ship a mock deployment**, and the SPA fallback ships with the
  artefact. Both are deployment failure modes that fail silently; engineering them out
  is worth describing. *(Criterion 3/4)*
- **Assets belong in cloud storage.** Covers ship with the client today; upload several
  through `/admin` and screenshot the S3 bucket, because the brief wants evidence of
  cloud storage in use. *(Criterion 3)*
