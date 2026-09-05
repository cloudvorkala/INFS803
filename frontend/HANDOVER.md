# Handover — backend layer

**For:** whoever is building the Express API
**From:** the frontend + database side
**Status:** client layer done and deployed-ready, database layer live in AWS

You are building the **middle tier**. The two tiers either side of you already exist and
are not going to move, which means you have a fixed contract on both sides — no guessing.

```
CLIENT      React SPA, 100-book bookstore          DONE
   │        calls 15 REST routes over HTTPS
   ▼
BACKEND     Express on EC2                          ← YOU
   │        3 DynamoDB tables, 1 S3 bucket
   ▼
DATABASE    DynamoDB, ap-southeast-2                DONE, seeded
```

---

## What already exists

| | Where |
| --- | --- |
| React client, 100 books, all 15 routes wired | this repo, `src/` |
| **Working implementation of all 15 routes** | `tools/reference-server.mjs` |
| API contract — every request and response shape | below, and `tools/reference-server.mjs` |
| DynamoDB tables, created and seeded with 100 books | AWS, `ap-southeast-2` |
| S3 bucket with 100 cover images | AWS |
| EC2 launch script with an IAM role already scoped | `tools/aws/scripts/04-launch-ec2.sh` |
| Schema verification suite | `tools/aws/verify-schema.mjs` |

**Read `tools/reference-server.mjs` first.** It is a complete, runnable implementation of
every route with the exact JSON the client expects. It holds state in memory instead of
DynamoDB — that swap is essentially your whole job.

```bash
node tools/reference-server.mjs      # http://localhost:4000, all 15 routes live
```

---

## What you need to build

An Express app serving these 15 routes, backed by DynamoDB.

| # | Method | Endpoint | Auth |
| - | ------ | -------- | ---- |
| 1 | POST | `/register` | No |
| 2 | POST | `/login` | No |
| 3 | POST | `/logout` | Yes |
| 4 | GET | `/products` | No — supports `?category=` and `?search=` |
| 5 | GET | `/products/:id` | No |
| 6 | POST | `/products` | Admin |
| 7 | PUT | `/products/:id` | Admin |
| 8 | DELETE | `/products/:id` | Admin |
| 9 | GET | `/cart` | Yes |
| 10 | POST | `/cart` | Yes |
| 11 | PUT | `/cart/:productId` | Yes — sets quantity outright; 0 removes |
| 12 | DELETE | `/cart/:productId` | Yes |
| 13 | POST | `/checkout` | Yes |
| 14 | GET | `/orders` | Yes |
| 15 | POST | `/upload_file` | Admin |

Status codes the client already handles: `400` bad input, `401` missing/expired token,
`403` not admin, `404` not found, `409` conflict (out of stock, duplicate email).
Errors are `{ "message": "human readable reason" }`.

### Auth — pick one, tell the frontend which

The client supports both, switched by one environment variable, so this is your call:

- **`cognito`** — the browser talks to the Cognito User Pool directly. You only verify
  the JWT on incoming requests. Routes 1–3 are Cognito's, not yours: **12 routes.**
- **`api`** — you implement `/register`, `/login`, `/logout`, calling Cognito
  server-side, and return `{ token, user }` from login: **15 routes.**

Either clears the brief's 10-route minimum. The report must match whichever ships.

Either way the client sends the token **raw in the `Authorization` header, no `Bearer`
prefix**. If you'd rather have `Bearer`, say so and the client changes one line.

For verifying Cognito JWTs in Express, `aws-jwt-verify` is the official library — you're
on EC2, so there's no API Gateway authorizer doing it for you.

---

## The database

Region `ap-southeast-2`. Tables are live and `Paperbound-Products` already has 100 books.

| Table | Partition key | Sort key |
| --- | --- | --- |
| `Paperbound-Products` | `id` | — |
| `Paperbound-Carts` | `userId` | `productId` |
| `Paperbound-Orders` | `userId` | `placedAtOrderId` |

Plus two indexes on Products: `category-title-index` and `author-title-index`.

**No credentials needed, and none are available.** The EC2 instance has an IAM role
scoped to exactly these tables and the bucket's `covers/*` prefix. Use the SDK with no
keys configured — it picks the role up from instance metadata:

```js
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'ap-southeast-2' })   // no credentials block
);
```

If you get `AccessDeniedException`, the role needs another ARN added — ask, don't
work around it with an access key.

### Every access pattern, already verified

These exact calls pass against a real DynamoDB engine (`tools/aws/verify-schema.mjs`).

```js
// GET /products/:id
new GetCommand({ TableName: 'Paperbound-Products', Key: { id } })

// GET /products?category=Poetry   — a Query, not a Scan
new QueryCommand({
  TableName: 'Paperbound-Products',
  IndexName: 'category-title-index',
  KeyConditionExpression: 'category = :c',
  ExpressionAttributeValues: { ':c': category },
})   // returns sorted by title already

// GET /products?search=raghavan
// Every item carries `searchText` = lowercase "title author isbn", because
// DynamoDB's contains() is case-sensitive. Lowercase the query first.
new ScanCommand({
  TableName: 'Paperbound-Products',
  FilterExpression: 'contains(searchText, :q)',
  ExpressionAttributeValues: { ':q': search.toLowerCase() },
})

// POST /products  — guard stops duplicate ids
new PutCommand({
  TableName: 'Paperbound-Products',
  Item: product,
  ConditionExpression: 'attribute_not_exists(id)',
})   // throws ConditionalCheckFailedException -> return 409

// GET /cart
new QueryCommand({
  TableName: 'Paperbound-Carts',
  KeyConditionExpression: 'userId = :u',
  ExpressionAttributeValues: { ':u': userId },
})

// PUT /cart/:productId  — set an absolute quantity (POST adds to it).
// Without this the only way to reduce a line is delete-then-re-add, which
// loses the line and races with itself. quantity 0 means remove.
//   validate: integer >= 0, and <= that product's stock, else 409

// GET /orders  — newest first, no sorting needed in code
new QueryCommand({
  TableName: 'Paperbound-Orders',
  KeyConditionExpression: 'userId = :u',
  ExpressionAttributeValues: { ':u': userId },
  ScanIndexForward: false,
})
```

### Checkout — do this as one transaction

This is the piece worth getting right; it's a marked point in the rubric.

```js
new TransactWriteCommand({
  TransactItems: [
    // one Update per cart line
    ...lines.map(l => ({
      Update: {
        TableName: 'Paperbound-Products',
        Key: { id: l.productId },
        UpdateExpression: 'SET stock = stock - :q',
        ConditionExpression: 'stock >= :q',        // <- cannot oversell
        ExpressionAttributeValues: { ':q': l.quantity },
      },
    })),
    { Put: { TableName: 'Paperbound-Orders', Item: {
        userId,
        placedAtOrderId: `${placedAt}#${orderId}`,  // sort key format matters
        orderId, placedAt, status: 'CONFIRMED', items, total,
    }}},
    ...lines.map(l => ({
      Delete: { TableName: 'Paperbound-Carts', Key: { userId, productId: l.productId } },
    })),
  ],
})
```

Stock decrement, order write and cart clear all commit together or not at all. The
`ConditionExpression` is what makes overselling impossible when two people check out the
last copy at once — catch `TransactionCanceledException` and return **409**.

Re-check stock here, not just at add-to-cart: a cart can sit for hours.

### `POST /upload_file`

Accepts `{ filename, dataUrl }`, puts the object into the bucket under `covers/`, and
returns `{ fileId, filename, url, s3Key }` where `url` is the public object URL. The
client stores that string and renders it. If files get large, switch to returning a
pre-signed PUT URL — API Gateway and most proxies cap bodies around 10 MB.

---

## Deploying

```bash
cd tools/aws/scripts
./04-launch-ec2.sh
```

t3.micro, Amazon Linux 2023, Node 20 and pm2 preinstalled, `/opt/paperbound` ready,
IAM role attached, security group open on 22 (your IP), 80, 443 and **3000**.

Use port 3000 or add a security group rule — otherwise it works on the box and is
unreachable from outside, which is a confusing hour to lose.

### Three things that will waste your time if nobody warns you

**1. HTTPS.** The client is served over HTTPS and browsers silently refuse calls from an
HTTPS page to a plain-HTTP address. `http://<ip>:3000` works from your laptop and will
not work from the deployed site. Fix: put **CloudFront** in front of the instance —
origin = your IP on port 3000, protocol HTTP, viewer policy redirect-to-HTTPS, allowed
methods **all** (the default is read-only and breaks every write), cache policy
`CachingDisabled`, origin request policy `AllViewer` so `Authorization` reaches you.
Don't use an ALB — ~US$16/month, and this account is meant to stay free.

**2. CORS.** Must include `Authorization` or every signed-in route dies at the preflight:

```js
app.use(cors({
  origin: ['https://<client-url>', 'http://localhost:5173'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
```

**3. Keep it running.** `pm2 start server.js && pm2 save && pm2 startup` so it survives a
reboot. The brief requires the API reachable from submission until marking is done.

---

## Send back to the frontend

Once your API is live, one thing:

```
VITE_API_BASE_URL=https://<your-cloudfront-domain>
```

Plus which auth mode you went with (`cognito` or `api`). The client rebuilds and points
at you — no other change needed.

---

## Definition of done

- [ ] All 15 (or 12) routes respond with the documented JSON
- [ ] Markers can hit the API **without the client** — Postman collection or documented
      `curl`, including how to get a token. This is explicitly required by the brief.
- [ ] Reachable over **HTTPS** from the public internet
- [ ] CORS allows the client origin and the `Authorization` header
- [ ] Checkout is a real transaction — verify stock can't go negative
- [ ] No AWS access keys anywhere in the code, the repo, or on the instance
- [ ] pm2 configured to restart on reboot
- [ ] `node tools/aws/verify-schema.mjs --remote` passes against the live tables

## Questions

The contract is in `claude/frontend-api-contract.md` and `tools/aws/README.md` has the
full schema rationale. If something in the contract doesn't suit the backend, say so
early — it's changeable, it just has to change on both sides at once.
