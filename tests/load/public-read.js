import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl, standardThresholds } from './common.js';

const maxVus = Number(__ENV.MAX_VUS || 1000);
export const options = {
  stages: [
    { duration: __ENV.RAMP_UP || '2m', target: maxVus },
    { duration: __ENV.HOLD || '5m', target: maxVus },
    { duration: __ENV.RAMP_DOWN || '1m', target: 0 },
  ],
  thresholds: standardThresholds,
  noConnectionReuse: false,
};

export default function () {
  const query = encodeURIComponent(__ENV.SEARCH_QUERY || 'test');
  const responses = http.batch([
    ['GET', `${baseUrl}/api/v1/products?page=1&limit=20`, null, { tags: { operation: 'products' } }],
    ['GET', `${baseUrl}/api/v1/search?q=${query}&limit=20`, null, { tags: { operation: 'search' } }],
    ['GET', `${baseUrl}/api/v1/search/popular`, null, { tags: { operation: 'popular' } }],
  ]);
  check(responses[0], { 'product list succeeds': (r) => r.status === 200 });
  check(responses[1], { 'search succeeds': (r) => r.status === 200 });
  check(responses[2], { 'popular search succeeds': (r) => r.status === 200 });
  sleep(Number(__ENV.THINK_TIME || 1));
}
