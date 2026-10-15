// Load and latency test for the public catalogue route, GET /products.
// Measures (1) the first request, which is a cold start after the function has been idle,
// and (2) steady traffic ramping to 20 requests per second. Read-only: it creates no data.
//
// Run from backend/:   k6 run perf-products.js
// Other stage:         k6 run -e BASE_URL=https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/dev perf-products.js
// See perf-products.md for when to run it and what to put in the report.

import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const BASE_URL = __ENV.BASE_URL || 'https://8lvgv7w3l0.execute-api.ap-southeast-2.amazonaws.com/dev';

export const options = {
  scenarios: {
    // One request before any other traffic. Run the test after >= 15 minutes of no traffic
    // so that this request lands on a new Lambda execution environment (a cold start).
    first_request: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '0s',
      tags: { phase: 'first' },
    },
    // Steady traffic: 2 -> 20 requests per second over 2 minutes 40 seconds (about 2,200 requests).
    steady: {
      executor: 'ramping-arrival-rate',
      startTime: '3s',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 60,
      stages: [
        { target: 5, duration: '20s' },
        { target: 10, duration: '40s' },
        { target: 20, duration: '30s' },
        { target: 20, duration: '40s' },
        { target: 0, duration: '5s' },
      ],
      tags: { phase: 'steady' },
    },
  },
  thresholds: {
    // Pass/fail targets for the report's non-functional requirements.
    'http_req_failed': ['rate<0.01'],                                   // under 1% errors
    'checks': ['rate>0.99'],
    'http_req_duration{phase:steady}': ['p(95)<1500', 'p(99)<3000'],     // milliseconds
    // Always-true thresholds so k6 prints these sub-metrics separately in the summary.
    'http_req_duration{phase:first}': ['max>=0'],
    'http_reqs{phase:steady}': ['count>=0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.get(`${BASE_URL}/products`, { tags: { route: 'GET /products' } });
  check(res, {
    'status is 200': (r) => r.status === 200,
    'catalogue is not empty': (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.products) && body.products.length > 0 && body.count === body.products.length;
      } catch (error) {
        return false;
      }
    },
  });
}

// Prints the usual summary and also saves it, so the numbers in the report can be traced.
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'perf-products-summary.json': JSON.stringify(data, null, 2),
  };
}
