# AWS setup — database, storage, and the backend instance

Everything here is for the **database layer** and the EC2 instance the Express API
will run on. The client is deployed separately (see `DEPLOYMENT.md` at the repo root).

Region defaults to `ap-southeast-2` (Sydney). Override with `AWS_REGION`.

---

## Run these in order

```bash
cd tools/aws/scripts

./00-guardrails.sh you@example.com    # budget alert + free-tier check. DO THIS FIRST.
./01-create-tables.sh                 # three DynamoDB tables
./02-load-seed.sh                     # 100 books
./03-covers-bucket.sh paperbound-covers-yourname
./02-load-seed.sh                     # again — 03 rewrote coverUrl to the S3 URLs
./04-launch-ec2.sh                    # t3.micro for your teammate's Express API
./05-smoke-test.sh paperbound-key.pem paperbound-covers-yourname
```

### Just testing, then shutting down?

That is the cheapest way to run this. Launch, prove it works, terminate:

```bash
./04-launch-ec2.sh
./05-smoke-test.sh paperbound-key.pem paperbound-covers-yourname
aws ec2 terminate-instances --instance-ids <id> --region ap-southeast-2
```

Total runtime a few minutes, which costs under two cents even outside the free
tier. `05-smoke-test.sh` proves the backend tier reaches DynamoDB through its
IAM role with no keys on the box, writes to S3, is reachable from the public
internet on port 3000, and answers a CORS preflight — the three-tier evidence
the report needs, captured in one screenshot.

**Terminate, do not stop.** A terminated instance costs nothing and takes its
disk with it. A stopped instance still bills for the 8 GB volume.

And when the assignment has been marked, not before:

```bash
./99-teardown.sh paperbound-covers-yourname
```

You need the AWS CLI installed and `aws configure` done. Check with
`aws sts get-caller-identity`.

---

## Cost

You said you don't want to be charged, and your account is an existing one — which
means the legacy Free Tier model, where overages **do** bill to your card rather than
just stopping. So the numbers matter.

**Free regardless of account age** (these allowances never expire):

- DynamoDB — 25 read units, 25 write units, 25 GB. These scripts provision **20/20
  across all three tables and both indexes**, deliberately under the line. Provisioned
  rather than on-demand precisely because a fixed ceiling cannot spike into a bill.
- CloudFront — 1 TB out and 10 M requests per month
- The cover images in S3 are under 1 MB total; storage cost is a fraction of a cent

**The one exposed piece is EC2.** If your account is under 12 months old it's inside
the 750-hour allowance and free. If it's older, roughly:

| | per month |
| --- | --- |
| t3.micro on-demand | ~US$9.60 |
| public IPv4 | ~US$3.60 |
| 8 GB gp3 disk | ~US$0.77 |
| **total, running 24/7** | **~US$14** |

`00-guardrails.sh` tells you which case you're in. If you're out of free tier, stop
the instance when you're not demoing — a stopped instance bills only its disk, about
two cents a day:

```bash
aws ec2 stop-instances  --instance-ids <id> --region ap-southeast-2
aws ec2 start-instances --instance-ids <id> --region ap-southeast-2
```

Note the public IP changes on restart, so once the API URL is written into your
report, leave it running.

**Never create these** — they have no free tier and are how people get surprise bills:
an Application Load Balancer (~US$16/mo), a NAT Gateway (~US$32/mo), an RDS instance,
or an Elastic IP left unattached. `00-guardrails.sh` checks for all of them.

---

## The schema

Three tables, designed around the access patterns the 15 documented routes actually
need rather than around how the data looks on paper.

### `Paperbound-Products`

| | |
| --- | --- |
| Partition key | `id` (e.g. `bk-001`) |
| GSI `category-title-index` | `category` + `title` |
| GSI `author-title-index` | `author` + `title` |

- `GET /products/:id` → GetItem
- `GET /products?category=` → **Query** on the category index, already sorted by title.
  Not a Scan.
- `GET /products?search=` → Scan with `contains(searchText, :q)`. `searchText` is a
  denormalised lowercase `"title author isbn"` blob, because DynamoDB's `contains()`
  is case-sensitive and cannot index substrings. Honest limitation to note in the
  report: this is a Scan, which is fine over 100 items and would not be at 100,000 —
  the real answer at scale is OpenSearch.
- The author index powers the "More by this author" shelf on each book page.

### `Paperbound-Carts`

| | |
| --- | --- |
| Partition key | `userId` (the Cognito `sub`) |
| Sort key | `productId` |

One row per cart line. `GET /cart` is a Query on `userId`; removing an item is a
Delete on the composite key. A user can only ever read their own partition.

### `Paperbound-Orders`

| | |
| --- | --- |
| Partition key | `userId` |
| Sort key | `placedAtOrderId` — `"<ISO timestamp>#<orderId>"` |

The composite sort key means `GET /orders` is a Query with `ScanIndexForward: false`
and comes back newest-first **with no sorting in application code**. The `#orderId`
suffix keeps it unique if two orders land in the same millisecond.

### Checkout is one transaction

`POST /checkout` is a single `TransactWriteItems`:

1. For each line — `UpdateItem` on the product with
   `SET stock = stock - :q` and `ConditionExpression: stock >= :q`
2. `PutItem` the order
3. `DeleteItem` each cart line

All of it commits or none of it does. The condition is what makes stock impossible to
oversell under concurrent checkouts, and it's a Criterion 2 point worth spelling out.

---

## Verifying the schema

```bash
cd tools/aws && npm install && npm run verify
```

Spins up a local DynamoDB-compatible engine, creates the tables from the same JSON
the AWS CLI uses, loads all 100 books, and exercises every access pattern. Free, and
touches nothing in AWS. **24/24 currently pass.**

One thing it can't check locally: the local engine doesn't implement
`TransactWriteItems`. The conditional decrement — the part that could actually be
wrong — *is* verified, and the script reports the transaction as skipped rather than
quietly passing. Once the real tables exist:

```bash
node verify-schema.mjs --remote
```

That runs the full transaction including the cancellation path. It writes test data
and moves stock on `bk-001`, so run it before submission, not during marking.

---

## No credentials on the instance

`04-launch-ec2.sh` attaches an IAM role scoped to exactly these three tables and the
covers prefix. The Express app should use the AWS SDK with **no keys configured at
all** — it picks the role up from instance metadata automatically.

If your teammate asks you for an access key to put in their `.env`, the answer is no,
and the reason is worth a sentence in the report: keys on a box get committed, leak,
and never rotate; an instance role is temporary, automatically rotated, and scoped to
the four ARNs in the policy.

---

## What your teammate needs from you

- Public IP of the instance (from `04-launch-ec2.sh`)
- Table names: `Paperbound-Products`, `Paperbound-Carts`, `Paperbound-Orders`
- Region: `ap-southeast-2`
- The cover bucket name, for `POST /upload_file`
- `tools/reference-server.mjs` at the repo root — a working implementation of all 14
  routes to match
- Nothing else. No keys.
