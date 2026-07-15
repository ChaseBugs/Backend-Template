# 구현 로드맵 (Implementation Roadmap)

> eCommerce Backend — 동시접속 10만 명(100k Concurrent) 오프라인 마켓플레이스
> DB 아키텍처 관점에서 **의존성 순서**대로 정렬한 실전 빌드 순서.
> 관련 문서: [architecture.md](./architecture.md) · [marketplace-db-architecture.pdf](./marketplace-db-architecture.pdf)

---

## 원칙 (Guiding Principles)

1. **쓰기 경로 먼저, 읽기 경로 나중** — Phase 1~6은 PostgreSQL 쓰기 경로만으로 정합성을
   완성한다. Phase 7에서 읽기 DB(MongoDB/OpenSearch)를 얹는다. 처음부터 CQRS 양쪽을 동시에
   만들면 일관성 버그 추적이 지옥이 된다.
2. **각 Phase는 "완료 게이트"로 닫는다** — 게이트를 통과해야 다음 Phase로 넘어간다.
3. **RBAC는 처음부터** — 모든 보호 라우트에 `requirePermission()`, 에이전트 소유권은
   `requireOwnership()`. 나중에 덧붙이지 않는다.
4. **멱등성은 설계 시점에** — 주문/결제/재고 이벤트는 재시도 안전(idempotent)해야 한다.
5. **오프라인 제약 준수** — Docker/K8s/클라우드 관리형 서비스 금지. OS 레벨 직접 설치 + PM2/systemd.

---

## 전체 의존성 그래프

```
Phase 0 (기반)
   │
   ▼
Phase 1 (Auth/RBAC) ──┬──► Phase 2 (Catalog/Product)
                      │         │
                      │         ▼
                      │    Phase 3 (Inventory)
                      │         │
                      ▼         ▼
                 Phase 4 (Cart/Order · SAGA)
                      │
                      ▼
                 Phase 5 (Payment/Settlement)
                      │
                      ▼
                 Phase 6 (Delivery)
                      │
   ┌──────────────────┴───────────────────┐
   ▼                                       ▼
Phase 7 (CQRS 읽기 · sync-worker)     Phase 8 (Admin/Notification)
   │
   ▼
Phase 9 (Scale-out · 샤딩/복제/관측성)
```

---

## Phase 0 — 기반 (Foundation)

**목표:** 인프라와 공통 패키지가 준비되어 서비스가 부팅될 수 있는 상태.

### 인프라 기동 (설치 순서 준수)
| 순서 | 컴포넌트 | 포트 | 비고 |
|------|----------|------|------|
| 1 | PostgreSQL 16 | 5432 | Write DB. `01_init.sql`로 스키마/롤 생성 |
| 2 | Redis 7 Cluster | 7001~7006 | 캐시/세션/분산 락 |
| 3 | Kafka (KRaft) | 9092 | 이벤트 백본 |
| 4 | MongoDB 7 | 27017 | Read DB (Phase 7에서 실사용) |
| 5 | OpenSearch 2 | 9200 | 검색 (Phase 7에서 실사용) |
| 6 | RabbitMQ | 5672 / 15672 | 알림 라우팅 |

### 공통 패키지
- `packages/shared` — `UserRole` enum, DTO, `KafkaTopic`, 이벤트 타입
- `packages/rbac` — `Permission` 정의, `requirePermission`, `requireOwnership`
- `packages/errors` — `AppError`, `NotFoundError` 등 + 전역 에러 핸들러
- `packages/logger` — Pino (userId/role/requestId 자동 포함)
- `packages/kafka-client` · `packages/redis-client` · `packages/rabbitmq-client`

### ✅ 완료 게이트
- [ ] `scripts/init-all.sh` 실행 후 6개 인프라 헬스체크 통과
- [ ] **`packages/shared`의 `KafkaTopic` enum ↔ `infra/kafka/topics.sh` 완전 일치**
      (producer가 `allowAutoTopicCreation: false`라 토픽 미선생성 시 발행 실패)
- [ ] `pnpm turbo build` 전체 성공

---

## Phase 1 — Auth & RBAC (모든 것의 뿌리)

**목표:** 4역할 인증 + 에이전트 승인 워크플로우 + RBAC 미들웨어.

### 스키마 — `02_auth_schema.sql`
- `users` (role CHECK: super-admin/admin/agent/user)
- `agent_profiles` (approval_status: PENDING/APPROVED/REJECTED, commission_rate)
- `agent_shipping_policies`, `refresh_tokens`

### 핵심 구현
- 등록/로그인 (JWT + refresh token 회전)
- super-admin 시드 (`seed-super-admin.sh`로 최초 1명만)
- 에이전트 가입신청 → **admin만** 승인/거절 (`agent.approved`/`agent.rejected` 발행)
- admin 계정 생성은 **super-admin 전용** (`Permission.ADMIN_CREATE`)

### ✅ 완료 게이트
- [ ] super-admin → admin 생성 → agent 가입신청 → admin 승인 전 흐름 동작
- [ ] agent가 admin 계정 생성 시도 → 403
- [ ] pending 상태 agent가 보호 리소스 접근 → 403
- [ ] `user.registered`, `agent.approved` 이벤트 정상 발행

---

## Phase 2 — Catalog & Product (Offer 모델의 핵심)

**목표:** "여러 판매자가 같은 상품을 판다"를 Amazon ASIN↔Offer 모델로 구현.

### 스키마 — `03_product_schema.sql` + `14_marketplace_catalog.sql`
```
catalog_products (표준 상품·GTIN 유니크)
   └─< catalog_variants (색상/용량 등 변형)
          └─< products (= 판매자 오퍼: agent_id, price, condition, status)
```

### 구현 순서 (중요)
1. **카탈로그 먼저** — `catalog_products` → `catalog_variants`
2. **오퍼 나중** — `products`는 항상 `catalog_variant_id`를 참조
3. 에이전트 소유권: `requireOwnership(getProductOwnerId)` — 타 에이전트 상품 수정 시 403
4. admin 상품 승인/거절 워크플로우 (`product.approved` 등 발행)

### 핵심 제약
- `catalog_products.gtin` 전역 유니크 (실물 중복 등록 방지)
- SKU는 `(agent_id, sku)` 단위 유니크 — 카탈로그가 아니라 판매자 오퍼 소유
- `uq_products_active_offer (agent_id, catalog_variant_id, condition)` — 판매자당 활성 오퍼 1개

### ✅ 완료 게이트
- [ ] 두 판매자가 같은 variant에 각자 오퍼 등록 성공
- [ ] 같은 판매자가 같은 variant+condition으로 활성 오퍼 2개 시도 → 차단
- [ ] pending 에이전트의 상품 등록 시도 → 403

---

## Phase 3 — Inventory (분산 락)

**목표:** 초과 판매(overselling) 절대 방지.

### 스키마 — `04_inventory_schema.sql`
- `inventories` (quantity_available / quantity_reserved 분리, CHECK ≥ 0)
- `stock_movements` (IN/OUT/RESERVE/RELEASE/ADJUST, `uq_stock_movement_event`로 멱등)

### 핵심 구현
- Redis Lua 스크립트 기반 원자적 예약 락 (available→reserved 이동)
- `order.created` 소비 → 예약 시도 → `inventory.reserved` 또는 `inventory.reservation.failed` 발행

### ✅ 완료 게이트
- [ ] **동시 100요청이 재고 10개를 정확히 10개까지만 예약** (경쟁 조건 테스트)
- [ ] 같은 주문의 재고 이벤트 재수신 시 중복 차감 없음 (멱등)

---

## Phase 4 — Cart & Order (SAGA 오케스트레이션)

**목표:** 분산 트랜잭션으로 주문 생성 + 실패 시 보상.

### 스키마 — `05_order_schema.sql`
- `orders` (status 상태기계, `uq_orders_user_idempotency`)
- `order_items` (상품명/가격 **스냅샷** — 사후 가격 변경 무관)
- `saga_states` (STARTED→INVENTORY_RESERVED→PAYMENT_INITIATED→COMPLETED / COMPENSATED)
- `coupons`, `coupon_redemptions`

### 핵심 구현
- Cart: Redis Hash 기반 장바구니
- 주문 생성 SAGA: 재고 예약 대기 → 결제 대기 → 완료
- 실패 경로: `inventory.reservation.failed` 또는 `payment.failed` → 보상 트랜잭션

### ✅ 완료 게이트
- [ ] 정상 주문: PENDING → PAYMENT_PENDING → PAID 전이
- [ ] 재고 예약 실패 시 SAGA 보상 → 주문 CANCELLED 롤백
- [ ] 동일 idempotency_key 재요청 → 중복 주문 생성 안 됨

---

## Phase 5 — Payment & Settlement (마켓플레이스 정산)

**목표:** 멱등 결제 + 판매자별 정산 분해.

### 스키마 — `06_payment_schema.sql`
- `payments` (idempotency_key UNIQUE, pg_response JSONB)
- `agent_settlements` (판매자별 gross/commission/net, `uq_settlement_order_agent`)
- `refunds`, `settlement_adjustments` (환불 시 정산 역산)

### 핵심 구현
- `order.confirmed` 소비 → PG 연동(내부망) → `payment.completed`/`payment.failed`
- Circuit Breaker (PG 장애 격리)
- 결제 완료 시 판매자별 정산 레코드 자동 생성 (수수료율 적용)

### ✅ 완료 게이트
- [ ] 3개 판매자 상품 1주문 결제 → 정산 3건 분해 + 수수료 정확
- [ ] 동일 idempotency_key 재요청 → 이중 결제 방지
- [ ] 부분 환불 시 `settlement_adjustments`로 정산 역산 정확

---

## Phase 6 — Delivery (배송 그룹)

**목표:** 판매자별 배송 그룹 + 부분 배송 + 반품.

### 스키마 — `07_delivery_schema.sql` (+ `12_delivery_delay_alert.sql`)
- 판매자별 배송 그룹, 운송장, 반품 처리

### 핵심 구현
- `order.paid` 소비 → 판매자별 배송 그룹 생성 (`delivery.group.created`)
- 배송 진행: `delivery.shipped` → `delivery.delivered`
- 전체 완료 시 `delivery.all.completed` → order-service가 주문 COMPLETED
- 반품: `delivery.return.requested` → payment-service 환불 연동

### ✅ 완료 게이트
- [ ] 다판매자 주문 → 판매자 수만큼 배송 그룹 생성
- [ ] 일부만 배송 → 주문 PARTIALLY_SHIPPED
- [ ] 전체 배송 완료 → 주문 COMPLETED 자동 전이

---

## Phase 7 — CQRS 읽기 측 (Read Path) ★ 여기서 처음 읽기 DB 등장

**목표:** 쓰기(PostgreSQL)와 읽기(MongoDB/OpenSearch)를 물리적으로 분리.

### 핵심 구현
- `sync-worker`: Kafka 이벤트 소비 → 3개 대상 갱신
  - **MongoDB** — 비정규화 조회 뷰 (상품 상세, 주문 내역)
  - **OpenSearch** — 검색 인덱스 (nori 한글 형태소)
  - **Redis** — 관련 캐시 무효화
- search-service: Cache-Aside (Redis → miss → OpenSearch)
- 상품/주문 조회 API를 읽기 모델로 전환

### 데이터 흐름
```
Command → PostgreSQL → Kafka → sync-worker → { MongoDB, OpenSearch, Redis 무효화 }
Query   → Redis (hit) → miss → MongoDB or OpenSearch
```

### ✅ 완료 게이트
- [ ] 상품 등록 후 검색 결과 반영까지 지연(eventual consistency) 측정 및 허용치 확인
- [ ] Read DB 장애 시에도 쓰기 경로(결제) 정상 (장애 격리)
- [ ] 캐시 히트율 측정 가능

---

## Phase 8 — Admin & Notification

**목표:** 운영 도구와 알림.

### 스키마 — `09_admin_schema.sql`, `10_admin_grants.sql`, `08_notification_schema.sql`, `13_review_schema.sql`
### 핵심 구현
- admin-service: 통계, 감사 로그, 정산 관리, 배송 현황
- notification-service: RabbitMQ + Kafka Consumer, 내부 SMTP, 다중 수신자
- 리뷰: 구매 확정 후 작성 (카탈로그 귀속)

### ✅ 완료 게이트
- [ ] admin 대시보드 통계/감사로그 조회
- [ ] `agent.approved`/`delivery.shipped` 등 이벤트 → 알림 발송

---

## Phase 9 — 확장 (Scale-out)

**목표:** 단일 노드 한계 돌파 및 운영 성숙도.

### 작업
- **읽기 복제본(Read Replica)** 추가 → 마스터는 쓰기 전용
- **샤딩** — 단일 노드 한계 도달 후 도입 (키는 이미 UUID라 준비됨)
  - 주문/장바구니: `user_id`
  - 상품/재고: `agent_id` 또는 `catalog_id`
  - 결제/정산: `order_id`
- **관측성**: Prometheus + Grafana (메트릭), OpenTelemetry + Jaeger (트레이싱)
- **프로세스 관리**: PM2 Cluster + systemd, Nginx Rate Limiting/Upstream
- **부하 테스트**: 10만 동시접속 목표로 병목 식별

### ✅ 완료 게이트
- [ ] 읽기 트래픽이 복제본으로 분산됨
- [ ] 목표 동시접속에서 SLA 충족
- [ ] 대시보드에서 서비스별 지연/에러율 관측

---

## 부록 — Phase별 스키마 파일 매핑

| Phase | 스키마 파일 |
|-------|-------------|
| 0 | `01_init.sql` |
| 1 | `02_auth_schema.sql` |
| 2 | `03_product_schema.sql`, `14_marketplace_catalog.sql` |
| 3 | `04_inventory_schema.sql` |
| 4 | `05_order_schema.sql` |
| 5 | `06_payment_schema.sql` |
| 6 | `07_delivery_schema.sql`, `12_delivery_delay_alert.sql` |
| 8 | `08_notification_schema.sql`, `09_admin_schema.sql`, `10_admin_grants.sql`, `11_notification_multi_recipient.sql`, `13_review_schema.sql` |
