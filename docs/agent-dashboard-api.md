# Agent (Seller) Dashboard API

판매자 대시보드가 호출하는 4개 요약 엔드포인트. 모두 인증된 **agent** 토큰이 필요하며,
응답은 호출한 에이전트 본인(`agentId`)으로 스코프된다. UI는 이 4개를 병렬 호출해 랜딩 타일을 구성한다.

- Base URL: API Gateway (`/api/v1` prefix). 예) `GET /api/v1/orders/agent/summary`
- 인증: `Authorization: Bearer <agent JWT>` (게이트웨이가 검증 후 `x-agent-id` 주입)
- 공통 응답 래퍼: `{ "success": true, "data": <payload> }` (에러는 `{ "success": false, "error": {...} }`)
- 금액 단위: 원(KRW) 정수

---

## 1. 매출 요약 — 「돈」 타일

```
GET /api/v1/orders/agent/summary?from=<ISO8601>&to=<ISO8601>
```
권한: `READ_AGENT_ORDERS` · 기간 미지정 시 최근 30일 (`to`=now, `from`=to-30d).
매출은 `PAID/PROCESSING/PARTIALLY_SHIPPED/SHIPPED/COMPLETED` 상태만 집계.

| 쿼리 | 설명 |
|------|------|
| `from` | 기간 시작 (ISO8601). 생략 시 `to`−30일 |
| `to` | 기간 끝 (ISO8601). 생략 시 현재 |

**응답 `data`:**
```json
{
  "period": { "from": "2026-06-15T00:00:00.000Z", "to": "2026-07-15T00:00:00.000Z" },
  "totals": { "orderCount": 8, "unitsSold": 16, "grossSales": 160000 },
  "byStatus": {
    "PAID":       { "orderCount": 3, "unitsSold": 5, "grossSales": 50000 },
    "PROCESSING": { "orderCount": 1, "unitsSold": 2, "grossSales": 20000 },
    "COMPLETED":  { "orderCount": 4, "unitsSold": 9, "grossSales": 90000 }
  },
  "pendingFulfillment": 4
}
```
- `totals` — 기간 내 합계(주문 수 / 판매 수량 / 매출)
- `byStatus` — 매출 상태별 분해
- `pendingFulfillment` — 아직 배송 의무가 남은 주문 수 (`PAID`+`PROCESSING`+`PARTIALLY_SHIPPED`)

---

## 2. 정산·지급 요약 — 「정산」 타일

```
GET /api/v1/payments/settlements/summary
```
권한: `READ_AGENT_PAYMENTS`.

**응답 `data`:**
```json
{
  "byStatus": {
    "PENDING":    { "count": 2, "netAmount": 6300, "grossAmount": 7000, "commissionAmount": 700 },
    "PROCESSING": { "count": 1, "netAmount": 2400, "grossAmount": 3000, "commissionAmount": 600 },
    "COMPLETED":  { "count": 3, "netAmount": 9000, "grossAmount": 10000, "commissionAmount": 1000 },
    "HELD":       { "count": 1, "netAmount": 1500, "grossAmount": 1700, "commissionAmount": 200 }
  },
  "payoutPending": 8700,
  "paidOut": 9000,
  "held": 1500,
  "lifetimeCommission": 2500
}
```
- `payoutPending` — 아직 지급되지 않은 net 합계 (`PENDING`+`PROCESSING`) → "지급 예정액"
- `paidOut` — 지급 완료(`COMPLETED`) net 합계
- `held` — 보류(`HELD`) net 합계
- `lifetimeCommission` — 취소분 제외 누적 수수료
- `byStatus` — 상태별 건수/금액 (net=판매자 수령액, gross=총액, commission=플랫폼 수수료)

---

## 3. 재고 건강도 요약 — 「재고」 타일

```
GET /api/v1/inventory/agent/summary
```
권한: `READ_OWN_INVENTORY`. 품절/임박이 곧 매출 손실이므로 즉시 액션 대상.

**응답 `data`:**
```json
{
  "totalSkus": 42,
  "outOfStock": 1,
  "lowStock": 2,
  "healthy": 39,
  "lowStockItems": [
    { "productId": "…uuid…", "quantity": 0, "lowStockThreshold": 5 },
    { "productId": "…uuid…", "quantity": 3, "lowStockThreshold": 5 },
    { "productId": "…uuid…", "quantity": 5, "lowStockThreshold": 5 }
  ]
}
```
- `outOfStock` — 가용 수량 0
- `lowStock` — `0 < 가용수량 ≤ lowStockThreshold`
- `healthy` — 임계값 초과
- `lowStockItems` — 품절+임박 SKU, **가용 수량 오름차순(가장 급한 것 먼저)**. 재입고 액션용

---

## 4. 배송 처리 요약 — 「할 일」 타일

```
GET /api/v1/deliveries/my/summary
```
권한: agent 역할 (배송 서비스 자체 가드).

**응답 `data`:**
```json
{
  "byStatus": { "PREPARING": 4, "SHIPPED": 2, "IN_TRANSIT": 1, "DELIVERED": 10, "RETURN_REQUESTED": 1, "FAILED": 1 },
  "toShip": 4,
  "inTransit": 3,
  "delivered": 10,
  "returnRequested": 1,
  "actionNeeded": 6
}
```
- `toShip` — 발송 대기(`PREPARING`). 빠른 발송이 별점·재구매로 직결
- `inTransit` — 배송 중(`SHIPPED`+`IN_TRANSIT`)
- `delivered` — 배송 완료
- `returnRequested` — 반품 요청 대기
- `actionNeeded` — 지금 판매자 조치 필요 합계 (`toShip`+`returnRequested`+`FAILED`)

---

## 5. Buy Box 위치 — 「경쟁」 타일

```
GET /api/v1/products/catalog/variants/{variantId}/buybox
```
권한: `requireApprovedAgent`. 같은 카탈로그 변형(variant)을 파는 오퍼들 중 내 위치를 계산.
오퍼는 가격 오름차순(동가일 때 먼저 등록한 순)으로 정렬되며 1위가 Buy Box 승자.

**응답 `data`:**
```json
{
  "variantId": "…uuid…",
  "offerCount": 3,
  "lowestPrice": 8000,
  "winnerAgentId": "…uuid-agent-a…",
  "myOffer": { "productId": "…uuid…", "price": 9000, "condition": "NEW", "rank": 3 },
  "iAmWinning": false,
  "priceToWin": 1001
}
```
- `lowestPrice` / `winnerAgentId` — 현재 Buy Box 가격과 승자
- `myOffer` — 내 오퍼(없으면 `null`), `rank`는 1부터
- `iAmWinning` — 내가 1위인지
- `priceToWin` — Buy Box를 가져오려면 낮춰야 할 금액(이미 1위면 `0`, 내 오퍼 없으면 `null`).
  현재 최저가를 1원 밑돌게 하는 값 = `내가격 − 최저가 + 1`

---

## 참고
- 전체 계약은 [openapi.json](./openapi.json) 참조 (`GET /orders/agent/summary` 외 3건 포함).
- 상세 목록(페이지네이션)은 별도 엔드포인트: `GET /orders`(에이전트), `GET /payments/settlements`,
  `GET /inventory/agent`(추후), `GET /deliveries/my`.
