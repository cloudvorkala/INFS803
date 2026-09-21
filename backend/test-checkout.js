// Correctness checks, not a load test. See test-checkout.md before running.
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { Endpoint, SignatureV4 } from 'https://jslib.k6.io/aws/0.14.0/signature.js';

export const options = {
  scenarios: { checkout: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '3m' } },
  setupTimeout: '3m',
  batch: 2,
  batchPerHost: 2,
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    checkout_cases_completed: ['count==1'],
  },
};

const completed = new Counter('checkout_cases_completed');
const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const CASE = __ENV.CASE || 'race';
const REGION = __ENV.AWS_REGION || 'ap-southeast-2';
const PRODUCTS = __ENV.PRODUCTS_TABLE || 'Paperbound-Products';
const CARTS = __ENV.CARTS_TABLE || 'Paperbound-Carts';
const ORDERS = __ENV.ORDERS_TABLE || 'Paperbound-Orders';
const address = { fullName: 'K6 Test Only', line1: '1 Test Street', city: 'Auckland', postcode: '1010', country: 'New Zealand' };
const checkoutBody = JSON.stringify({ shippingAddress: address });

function requireCheck(ok, label) {
  if (!check(ok, { [label]: value => value === true })) fail(label);
}

function params(token, name, statuses = [200]) {
  return {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    tags: { name }, timeout: '45s', redirects: 0,
    responseCallback: http.expectedStatuses(...statuses),
  };
}

function api(method, path, token, body, status = 200) {
  const response = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), params(token, `${method} ${path.split('/').slice(0, 2).join('/')}`, [status]));
  requireCheck(response.status === status, `${method} ${path.split('/')[1]} status ${status}`);
  return response.json();
}

// Only Query/GetItem are available here. Fixture writes always use the real API.
function dynamo(operation, payload) {
  const signer = new SignatureV4({
    service: 'dynamodb', region: REGION,
    credentials: { accessKeyId: __ENV.AWS_ACCESS_KEY_ID, secretAccessKey: __ENV.AWS_SECRET_ACCESS_KEY, sessionToken: __ENV.AWS_SESSION_TOKEN },
    uriEscapePath: true, applyChecksum: true,
  });
  const body = JSON.stringify(payload);
  const signed = signer.sign({
    method: 'POST', endpoint: new Endpoint(`https://dynamodb.${REGION}.amazonaws.com`), path: '/', body,
    headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': `DynamoDB_20120810.${operation}` },
  });
  const response = http.post(signed.url, body, {
    headers: signed.headers, tags: { name: `DynamoDB ${operation}` }, timeout: '45s',
    responseCallback: http.expectedStatuses(200), redirects: 0,
  });
  // Do not print AWS errors, request headers, tokens, or response bodies.
  requireCheck(response.status === 200, `DynamoDB ${operation} authorized and successful`);
  return response.json();
}

function rows(table, sub) {
  const items = [];
  let key;
  do {
    const query = {
      TableName: table, ConsistentRead: true,
      KeyConditionExpression: '#user = :user',
      ExpressionAttributeNames: { '#user': 'userId' },
      ExpressionAttributeValues: { ':user': { S: sub } },
    };
    if (key) query.ExclusiveStartKey = key;
    const page = dynamo('Query', query);
    items.push(...(page.Items || []));
    key = page.LastEvaluatedKey;
  } while (key && Object.keys(key).length);
  return items;
}

function stock(id) {
  const result = dynamo('GetItem', { TableName: PRODUCTS, Key: { id: { S: id } }, ConsistentRead: true });
  requireCheck(Boolean(result.Item && result.Item.stock && result.Item.stock.N), 'fixture Product exists with numeric stock');
  return Number(result.Item.stock.N);
}

function orderKeys(items) {
  return items.map(item => item.placedAtOrderId.S).sort();
}

function sameKeys(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cartMatches(items, expected) {
  return items.length === expected.length && expected.every(([id, quantity]) =>
    items.some(item => item.productId.S === id && Number(item.quantity.N) === quantity));
}

function user(token, label) {
  requireCheck(Boolean(token), `${label} token configured`);
  // Decoding is only for test-side read-only row selection. The API verifies JWTs.
  let claims;
  try { claims = JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's')); }
  catch (_) { fail(`${label} must be a raw Cognito ID token without Bearer prefix`); }
  requireCheck(claims.token_use === 'id' && typeof claims.sub === 'string' && claims.sub.length > 0 && claims.exp * 1000 > Date.now() + 300000, `${label} ID token valid for at least five more minutes`);
  return { token, sub: claims.sub };
}

function product(label, quantity) {
  const created = api('POST', '/products', __ENV.ADMIN_ID_TOKEN, {
    title: `K6 checkout ${label} ${Date.now()}`, author: 'K6 Fixture', category: 'K6 Test', price: 19.99, stock: quantity,
  }, 201);
  requireCheck(typeof created.id === 'string', 'fixture product ID returned');
  console.log(`Fixture ${label}: ${created.id} (retained for inspection)`);
  requireCheck(stock(created.id) === quantity, 'API and DynamoDB point to the same fixture table');
  return created.id;
}

export function setup() {
  requireCheck(/^https?:\/\//.test(BASE_URL), 'explicit BASE_URL configured');
  requireCheck(['race', 'rollback'].includes(CASE), 'CASE is race or rollback');
  for (const name of ['ADMIN_ID_TOKEN', 'USER_A_ID_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
    requireCheck(Boolean(__ENV[name]), `${name} configured`);
  }
  const users = [user(__ENV.USER_A_ID_TOKEN, 'User A')];
  if (CASE === 'race') {
    users.push(user(__ENV.USER_B_ID_TOKEN, 'User B'));
    requireCheck(users[0].sub !== users[1].sub, 'race uses two distinct Cognito users');
  }
  // Dedicated, idle users are mandatory. Never clear a pre-existing cart.
  const before = users.map(u => {
    requireCheck(rows(CARTS, u.sub).length === 0, 'dedicated test user cart is empty');
    // Authenticate only after the read-only empty-cart guard: GET /cart may
    // otherwise lazily delete pre-existing stale references.
    const cart = api('GET', '/cart', u.token);
    requireCheck(cart.items.length === 0, 'authenticated API cart is empty');
    return orderKeys(rows(ORDERS, u.sub));
  });
  if (CASE === 'race') {
    const id = product('race', 1);
    users.forEach(u => api('POST', '/cart', u.token, { productId: id, quantity: 1 }));
    users.forEach(u => requireCheck(cartMatches(rows(CARTS, u.sub), [[id, 1]]), 'race cart prepared'));
    return { users, before, ids: [id] };
  }
  const a = product('rollback-A', 5);
  const b = product('rollback-B', 1);
  [a, b].forEach(id => api('POST', '/cart', users[0].token, { productId: id, quantity: 1 }));
  // Add while in stock, then exhaust B; POST /cart correctly rejects unavailable stock.
  api('PUT', `/products/${b}`, __ENV.ADMIN_ID_TOKEN, { stock: 0 });
  requireCheck(stock(a) === 5 && stock(b) === 0, 'rollback stock prepared: A=5 B=0');
  requireCheck(cartMatches(rows(CARTS, users[0].sub), [[a, 1], [b, 1]]), 'rollback two-line cart prepared');
  return { users, before, ids: [a, b] };
}

export default function (data) {
  completed.add(0); // Interrupted/failed cases cannot silently satisfy completion.
  // Reject interference during setup; these accounts must not be used elsewhere.
  data.users.forEach((u, i) => requireCheck(sameKeys(orderKeys(rows(ORDERS, u.sub)), data.before[i]), 'orders unchanged since baseline'));
  if (CASE === 'race') {
    // One batch starts both requests in parallel, each with a different user token.
    const responses = http.batch(data.users.map(u => [
      'POST', `${BASE_URL}/checkout`, checkoutBody, params(u.token, 'POST /checkout race', [201, 409]),
    ]));
    const statuses = responses.map(r => r.status).sort();
    requireCheck(statuses[0] === 201 && statuses[1] === 409, 'race: exactly one 201 and one 409');
    const winner = responses.findIndex(r => r.status === 201);
    const loser = 1 - winner;
    const order = responses[winner].json();
    requireCheck(order.userId === data.users[winner].sub && order.status === 'CONFIRMED' && order.items.length === 1 && order.items[0].productId === data.ids[0] && order.items[0].quantity === 1, 'race: correct successful Order');
    requireCheck(stock(data.ids[0]) === 0, 'race: final stock exactly zero');
    const persisted = data.users.map(u => rows(ORDERS, u.sub));
    const added = persisted.map((items, i) => items.filter(item => !data.before[i].includes(item.placedAtOrderId.S)));
    requireCheck(added[winner].length === 1 && added[loser].length === 0, 'race: exactly one new persisted Order across both users');
    requireCheck(added[winner][0].orderId.S === order.orderId && added[winner][0].status.S === 'CONFIRMED', 'race: stored Order matches 201 response');
    requireCheck(rows(CARTS, data.users[winner].sub).length === 0, 'race: winner cart cleared');
    requireCheck(cartMatches(rows(CARTS, data.users[loser].sub), [[data.ids[0], 1]]), 'race: loser cart retained');
    console.log(`Race passed: winner user ${winner === 0 ? 'A' : 'B'}, Order ${order.orderId}`);
  } else {
    const response = http.post(`${BASE_URL}/checkout`, checkoutBody, params(data.users[0].token, 'POST /checkout rollback', [409]));
    requireCheck(response.status === 409, 'rollback: checkout rejected with 409');
    requireCheck(sameKeys(orderKeys(rows(ORDERS, data.users[0].sub)), data.before[0]), 'rollback: no Order created');
    requireCheck(stock(data.ids[0]) === 5, 'rollback: A stock unchanged');
    requireCheck(stock(data.ids[1]) === 0, 'rollback: B stock unchanged');
    requireCheck(cartMatches(rows(CARTS, data.users[0].sub), [[data.ids[0], 1], [data.ids[1], 1]]), 'rollback: both cart lines retained');
    console.log('Rollback prevalidation case passed: no order/stock/cart side effects');
  }
  completed.add(1);
}

// No teardown writes: preserve failed carts, products and orders as evidence.
