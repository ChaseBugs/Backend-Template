# Offline k6 scenarios

Install the k6 binary in the offline tool bundle and point `BASE_URL` at an isolated
performance environment. Never run the flash-sale scenario against production.

```bash
BASE_URL=https://perf.internal MAX_VUS=100000 pnpm load:public
BASE_URL=https://perf.internal USER_EMAIL=user@example.test USER_PASSWORD=... \
  PRODUCT_ID=<uuid> ARRIVAL_RATE=1000 MAX_VUS=100000 pnpm load:flash-sale
BASE_URL=https://perf.internal USER_EMAIL=user@example.test USER_PASSWORD=... \
  pnpm test:rbac-integration
```

The public profile ramps to a configurable concurrency target. The flash-sale profile
uses unique idempotency keys, accepts explicit out-of-stock/conflict responses, fails
on dropped iterations, and verifies that inventory never becomes negative after Kafka
consumers settle. Start at a small target and increase only after monitoring CPU,
memory, connection pools, broker lag, database locks, and error rates.
