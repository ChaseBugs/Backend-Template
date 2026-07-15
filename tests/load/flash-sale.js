import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { authHeaders, baseUrl, login } from './common.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 400, 409, 422, 503));

const accepted = new Counter('flash_sale_orders_accepted');
const rejected = new Counter('flash_sale_orders_rejected');
const rate = Number(__ENV.ARRIVAL_RATE || 1000);

export const options = {
  scenarios: {
    flash_sale: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || Math.min(rate, 5000)),
      maxVUs: Number(__ENV.MAX_VUS || 100000),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{operation:create-order}': ['p(95)<1000', 'p(99)<2000'],
    dropped_iterations: ['count==0'],
  },
};

export function setup() {
  if (!__ENV.PRODUCT_ID) throw new Error('PRODUCT_ID is required');
  return { token: login() };
}

export default function (data) {
  const idempotencyKey = `k6:${exec.scenario.name}:${exec.vu.idInTest}:${exec.scenario.iterationInTest}`;
  const response = http.post(`${baseUrl}/api/v1/orders`, JSON.stringify({
    items: [{ productId: __ENV.PRODUCT_ID, quantity: 1 }],
    shippingAddress: {
      recipientName: 'k6 load test', phone: '01000000000', addressLine1: 'Load Test',
      city: 'Seoul', postalCode: '00000',
    },
    idempotencyKey,
  }), { headers: authHeaders(data.token), tags: { operation: 'create-order' } });

  const wasAccepted = response.status === 201 || response.status === 200;
  const wasRejected = [400, 409, 422, 503].includes(response.status);
  if (wasAccepted) accepted.add(1); else if (wasRejected) rejected.add(1);
  check(response, { 'order accepted or safely rejected': () => wasAccepted || wasRejected });
}

export function teardown(data) {
  sleep(Number(__ENV.SETTLE_SECONDS || 10));
  const stock = http.get(`${baseUrl}/api/v1/inventory/${__ENV.PRODUCT_ID}`, { headers: authHeaders(data.token) });
  check(stock, {
    'inventory remains non-negative': (response) => {
      if (response.status !== 200) return false;
      const value = response.json()?.data ?? response.json();
      return Number(value.quantityAvailable ?? value.quantity_available ?? 0) >= 0
        && Number(value.quantityReserved ?? value.quantity_reserved ?? 0) >= 0;
    },
  });
}
