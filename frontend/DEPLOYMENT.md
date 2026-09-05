# Deploying to AWS

Your stack:

```
Client    React SPA        → S3 + CloudFront, or Amplify Hosting   (you)
Backend   Express on EC2   → t3.micro, port 3000                   (teammate)
Database  DynamoDB         → 3 tables, ap-southeast-2              (you)
Storage   S3               → cover images                          (you)
Auth      Cognito User Pool                                        (you)
```

Database, storage and the EC2 instance are scripted in `tools/aws/` — start there.
This file is the client deployment plus the two things that connect the layers.

---

## The blocker to solve first: HTTPS on the API

Your client will be served over HTTPS. Browsers **refuse** requests from an HTTPS page
to a plain-HTTP address — it's blocked as mixed content, silently, before the request
is even made. So `http://<ec2-ip>:3000` will not work from the deployed site no matter
how correct the API is. It works fine from `localhost` during development, which is
exactly why this gets discovered late.

The obvious fix is an Application Load Balancer with an ACM certificate. **Don't** —
an ALB is about US$16/month with no free tier, and you said no charges.

**Use CloudFront in front of the EC2 instance instead.** CloudFront terminates TLS
with its own `*.cloudfront.net` certificate, talks to your instance over plain HTTP,
and its free tier (1 TB out, 10 M requests/month) never expires.

1. CloudFront → Create distribution
2. **Origin domain**: your EC2 public IP or public DNS name
3. **Protocol**: HTTP only, **port 3000** (CloudFront → EC2 is inside AWS)
4. **Viewer protocol policy**: Redirect HTTP to HTTPS
5. **Allowed methods**: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE — the default is
   read-only and will break every write route
6. **Cache policy**: `CachingDisabled` — this is an API, not a static site. Caching
   `GET /cart` would serve one user's cart to another.
7. **Origin request policy**: `AllViewer`, so the `Authorization` header reaches Express

Your API base URL is then `https://<dist-id>.cloudfront.net`.

The alternative, if you'd rather not add CloudFront: run Caddy on the instance with a
real domain name and it gets a Let's Encrypt certificate automatically. That needs a
domain, which CloudFront does not.

---

## The second blocker: CORS on Express

Even over HTTPS, the browser blocks cross-origin calls unless Express says otherwise.
Your teammate needs this, and it must include `Authorization` or every authenticated
route dies at the preflight:

```js
import cors from 'cors';

app.use(cors({
  origin: ['https://<your-client-url>', 'http://localhost:5173'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
```

`tools/reference-server.mjs` shows the exact headers if they'd rather see it raw.

---

## Client build

`npm run build` produces three static files plus the fonts and 100 covers — no server,
no Node runtime. Two guards run automatically:

**The build refuses to run without a real API URL.** An empty `VITE_API_BASE_URL`
would make the client fall back to its in-memory mock API and still look perfectly
functional — a deployment that is broken and indistinguishable from a working one.
`npm run build:demo` builds the mock version on purpose.

**`VITE_*` values are baked in at build time.** They're substituted into the JavaScript
during the build; there is no runtime config. Change one and you must rebuild.

```bash
# .env  (or your host's build environment)
VITE_API_BASE_URL=https://<dist-id>.cloudfront.net
VITE_AUTH_MODE=cognito
VITE_COGNITO_USER_POOL_ID=ap-southeast-2_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_REGION=ap-southeast-2
```

---

## Option A — Amplify Hosting (recommended)

Fewest moving parts, HTTPS included, and it rebuilds on every `git push` — which is
**the CI/CD integration the brief lists as a bonus**, for free.

1. Amplify → Create new app → Deploy from Git → pick repo and branch
2. It reads `amplify.yml` (already in the repo)
3. **App settings → Environment variables** — set the five above *before* building
4. **Rewrites and redirects** → Source `/<*>`, Target `/index.html`, Type 404 (Rewrite)

Gives `https://<branch>.<app-id>.amplifyapp.com`. That's the client URL for page one
of your report.

## Option B — S3 + CloudFront

```bash
npm ci && npm run build

aws s3 mb s3://paperbound-client-<yourname> --region ap-southeast-2
aws s3 sync dist/ s3://paperbound-client-<yourname>/ --delete
aws s3 cp dist/assets s3://paperbound-client-<yourname>/assets --recursive \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://paperbound-client-<yourname>/index.html \
  --cache-control "no-cache"
```

Then a CloudFront distribution with that bucket as origin, Origin Access Control so
the bucket stays private, default root object `index.html`, and **two custom error
responses**:

| HTTP error | Response page | HTTP response code |
| ---------- | ------------- | ------------------ |
| 403 | `/index.html` | 200 |
| 404 | `/index.html` | 200 |

**403 matters more than 404 here.** With Origin Access Control on a private bucket a
missing key returns *403 Access Denied*, not 404, so mapping only 404 leaves deep
links broken. This catches people out constantly.

---

## Deep links

This is a single-page app: the browser asks the host for `/orders`, and there is no
object at that key. Verified both ways:

```
No rewrite:                       With rewrite:
GET /             -> 200          GET /             -> 200
GET /orders       -> 404  broken  GET /orders       -> 200
GET /books/bk-001 -> 404  broken  GET /books/bk-001 -> 200
```

The build ships two fixes so this can't be forgotten: `dist/404.html` (a copy of
`index.html`, which S3 website hosting and GitHub Pages serve automatically) and
`dist/_redirects` (read by Amplify and Netlify). CloudFront still needs its console
config, above.

---

## Suggested order for today

1. `tools/aws/scripts/00-guardrails.sh` — budget alert first, always
2. `01-create-tables.sh`, `02-load-seed.sh` — database live with 100 books
3. `03-covers-bucket.sh` — covers in S3, then `02-load-seed.sh` again to pick up the
   new URLs
4. Cognito User Pool: sign-in by email, required attributes `email` and `name`, an
   app client **with no client secret**, and a group called `admins`
5. `04-launch-ec2.sh` — hand the IP to your teammate
6. Connect Amplify to the repo and deploy — even with the API not ready. It proves the
   pipeline, the rewrite rule and HTTPS while there's still time to fix them.
7. When the API is live: CloudFront in front of it, set `VITE_API_BASE_URL`, rebuild.

Steps 1–5 need nothing from your teammate. Step 6 is worth doing today too — leaving
the first deployment until the end is how teams discover on submission eve that CORS
was never configured.

---

## Before you submit

- [ ] Built with real `VITE_*` values — orange mock-data banner **gone** from the site
- [ ] Refreshing on `/orders` loads the app, not a 404
- [ ] A deep link to `/books/bk-001` works pasted into a fresh tab
- [ ] Client loads over HTTPS, and the API is HTTPS too
- [ ] Sign in → add to cart → checkout → orders, all against the real API
- [ ] Admin can create a product and upload a cover; the image appears in the bucket
- [ ] Markers can hit the API directly — Postman collection or documented `curl`
- [ ] Client URL and Git repo URL on **page one** of the report
- [ ] `node tools/aws/verify-schema.mjs --remote` passes against the real tables
- [ ] Both URLs re-checked on submission morning
- [ ] Instance left **running** through marking (don't stop it to save the $9)
