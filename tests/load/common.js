import http from 'k6/http';
import { check, fail } from 'k6';

export const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';

export function login(email = __ENV.USER_EMAIL, password = __ENV.USER_PASSWORD) {
  if (!email || !password) fail('USER_EMAIL and USER_PASSWORD are required');
  const response = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { operation: 'login' },
  });
  check(response, { 'login succeeds': (r) => r.status === 200 });
  const body = response.json();
  const token = body?.data?.accessToken ?? body?.accessToken;
  if (!token) fail(`Login returned no access token: ${response.status}`);
  return token;
}

export function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export const standardThresholds = {
  http_req_failed: ['rate<0.01'],
  'http_req_duration{expected_response:true}': ['p(95)<500', 'p(99)<1000'],
};
