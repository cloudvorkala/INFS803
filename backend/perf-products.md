# GET /products load and latency test

`perf-products.js` sends read-only traffic to the public catalogue route and reports
cold-start latency, steady-state latency percentiles, throughput and error rate.
It creates, changes and deletes nothing.

## Before you run it

- Install k6: `winget install k6 --source winget` (or `choco install k6`).
- Wait at least 15 minutes with no traffic to the API, so the first request is a cold start.
  Do not run it while markers are likely to be using the system.
- Cost: about 2,200 requests. Lambda and API Gateway stay inside the free allowances;
  each request scans the 100-item Products table, so DynamoDB read cost is well under USD 0.01.

## Run

```powershell
cd backend
k6 run perf-products.js
```

The run takes about 2½ minutes. It prints the summary and writes `perf-products-summary.json`
(do not commit it if you prefer a clean repository).

## What to capture for the report

1. A screenshot of the k6 summary, showing the thresholds block (green ticks) and
   `http_req_duration{phase:first}` and `http_req_duration{phase:steady}`.
2. CloudWatch -> Lambda -> paperbound-backend-dev-api -> Monitoring, for the test window:
   **Duration**, **Concurrent executions** and **Errors**. Concurrent executions shows Lambda
   adding execution environments as the rate rises, which is the evidence for elasticity.
3. API Gateway -> Dashboard for the same window: request count, latency and 4XX/5XX.

## Sentences to adapt in Section 7.8 (fill in the measured values)

> We load-tested GET /products with k6 on <date>: <N> requests ramping from 2 to 20 requests
> per second over 2 min 15 s, holding 20 per second for the last 40 s. The error rate was <x>% (target < 1%). Steady-state latency was
> p50 <a> ms, p95 <b> ms and p99 <c> ms against a p95 target of 1,500 ms. The first request after
> 15 idle minutes took <d> ms, which is the Lambda cold start; warm requests averaged <e> ms.
> CloudWatch shows concurrent executions rising to <k> as the rate increased and falling back
> afterwards, with no throttles and no errors (Figure <n>).

If a threshold fails, report it as measured and explain the cause (for example, cold starts
during the ramp, or the full-table Scan); that is a better engineering discussion than a hidden failure.
