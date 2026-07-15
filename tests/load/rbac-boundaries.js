import http from 'k6/http';
import { check } from 'k6';
import { authHeaders, baseUrl, login } from './common.js';

export const options = { vus: 1, iterations: 1, thresholds: { checks: ['rate==1'] } };

export function setup() {
  return { userToken: login() };
}

export default function ({ userToken }) {
  const anonymousAdmin = http.get(`${baseUrl}/api/v1/admin/dashboard`);
  const userAdmin = http.get(`${baseUrl}/api/v1/admin/dashboard`, { headers: authHeaders(userToken) });
  const userSettlement = http.get(`${baseUrl}/api/v1/admin/settlements`, { headers: authHeaders(userToken) });
  check(anonymousAdmin, { 'anonymous admin access is 401': (r) => r.status === 401 });
  check(userAdmin, { 'customer admin access is 403': (r) => r.status === 403 });
  check(userSettlement, { 'customer settlement access is 403': (r) => r.status === 403 });
}
