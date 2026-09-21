import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    products_load: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 15,
      maxVUs: 30,
      stages: [
        { target: 5, duration: '20s' },
        { target: 8, duration: '30s' },
        { target: 10, duration: '20s' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL =
  'https://8lvgv7w3l0.execute-api.ap-southeast-2.amazonaws.com/dev';

export default function () {
  const res = http.get(`${BASE_URL}/products`);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}