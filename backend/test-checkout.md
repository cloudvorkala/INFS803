# Checkout k6 correctness checks

`test-checkout.js` follows the HTTP/check style of `load-products.js`, but runs
one correctness case, not a sustained load test. It creates real test data when
you run it. No application behavior or Lambda permissions need changing.

## Prerequisites

- k6, an explicitly selected dev API URL, and fresh raw Cognito **ID tokens**:
  `ADMIN_ID_TOKEN` (admins group), `USER_A_ID_TOKEN`, `USER_B_ID_TOKEN`.
  The race needs two distinct users; rollback only needs A.
- Use dedicated, idle test accounts with **empty carts**. Never run two copies
  against the same users. Nonempty carts stop setup rather than being cleared.
- The runner needs AWS credentials for **read-only verification**, because
  GET /orders is not implemented. Give the runner `dynamodb:Query` on only the
  configured Carts/Orders tables and `dynamodb:GetItem` on only Products.
  This is separate from Lambda IAM. No Scan or direct DynamoDB writes are used.
- Export `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`
  when using temporary credentials. k6 does not automatically load `.env` or
  resolve an AWS CLI SSO/profile credential chain. Never commit credentials.
- Defaults: `AWS_REGION=ap-southeast-2`, `PRODUCTS_TABLE=Paperbound-Products`,
  `CARTS_TABLE=Paperbound-Carts`, `ORDERS_TABLE=Paperbound-Orders`. Override through
  environment variables if needed; they must match the selected deployed API.
- First use requires access to the pinned Grafana signing module at
  `https://jslib.k6.io/aws/0.14.0/signature.js`.

## PowerShell usage (from backend)

Populate the environment using your normal secure credential/token workflow;
the placeholders below are not working credentials. Tokens need at least five
minutes of remaining lifetime. Do not put `Bearer ` in the token variables.

```powershell
$env:BASE_URL = 'https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/dev'
$env:ADMIN_ID_TOKEN = '<admin ID token>'
$env:USER_A_ID_TOKEN = '<user A ID token>'
$env:USER_B_ID_TOKEN = '<user B ID token>'
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / optional AWS_SESSION_TOKEN
# must already be exported for the read-only verification identity.

k6 run -e CASE=race .\test-checkout.js

# Use a fresh empty-cart test user A, or manually remove only the earlier
# fixture cart lines after preserving evidence, before this separate run.
k6 run -e CASE=rollback .\test-checkout.js
```

Do not override VUs/iterations: fixtures are for a single execution. Checks and
completion thresholds make failed assertions produce a nonzero k6 exit code.
Expected 409s do not count as HTTP failures. No tokens or address payloads are
logged; fixture Product IDs and the successful Order ID are printed.

## Assertions

**race** creates one Product with stock=1 and adds quantity=1 to both users'
carts. `http.batch` dispatches the two checkouts concurrently with different
tokens. It requires exactly one 201 and one 409, then verifies with strongly
consistent DynamoDB reads: stock=0, exactly one new Order across both user
partitions matching the successful response, an empty winner cart, and the
loser's unchanged one-line cart. Queries follow all pages and compare against
existing Order keys, so historical test orders do not count as new orders.

**rollback** creates A with stock=5 and B with stock=1, adds both to A's cart,
then uses the admin API to reduce B stock to 0. This preparation is necessary
because Cart POST rejects insufficient stock. Checkout must return 409; no new
Order may exist, A must remain at 5, B at 0, and both cart lines must remain.

The second case exercises **pre-transaction validation**, not an injected
transaction cancellation. The concurrent case exercises competing requests, but
client-side concurrent dispatch cannot guarantee both Lambdas reach the write
transaction simultaneously. A single passing run is evidence for that run, not
proof of every possible interleaving or cancellation rollback path.

## Retained evidence and cleanup

The script deliberately does not auto-delete anything after execution. The race
leaves one test Product, one successful Order, and the losing user's cart line;
rollback leaves two Products and two cart lines. Failed setup can leave partial
fixtures too; created Product IDs are printed as soon as returned.

Inspect/save the results, then remove only those fixture cart lines and Products
through their existing DELETE APIs if desired. Successful Orders remain because
there is no Order deletion API. Do not delete unrelated cart or database data.
Use fresh dedicated accounts or clear the known fixture lines before another run.

Creating this file and checking its syntax does not mark either scenario as
cloud-verified; record actual execution results separately.

References: [k6 concurrent batch](https://grafana.com/docs/k6/latest/javascript-api/k6-http/batch/),
[AWS request signing](https://grafana.com/docs/k6/latest/javascript-api/jslib/aws/signaturev4/sign/).
