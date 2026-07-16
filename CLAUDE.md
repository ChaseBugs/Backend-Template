# CLAUDE.md — eCommerce Backend Project

## 프로젝트 개요

동시 접속자 10만 명(100k Concurrent Users)을 지원하는 오프라인(On-Premise) eCommerce 백엔드.
Amazon/Alibaba/Taobao 수준의 대규모 전자상거래 플랫폼 아키텍처를 Node.js 기반으로 구현한다.

---

## 핵심 제약 조건 (절대 위반 금지)

1. **오프라인(Offline) 전용** — Docker, Kubernetes, 클라우드 관리형 서비스 사용 금지
   - 모든 인프라는 물리/가상 서버에 OS 수준에서 직접 설치
   - 프로세스 관리: PM2 Cluster 모드 + systemd
   - 의존성 배포: node_modules 번들 전송 또는 Verdaccio Private NPM
   - npm/pnpm 패키지는 오프라인에서도 동작하는 순수 JS 라이브러리 우선 선택

2. **4가지 사용자 역할 (Role)** — 모든 API에 RBAC 적용 필수
   - `super-admin` → 전체 시스템 권한 (어드민 생성 포함)
   - `admin` → 플랫폼 운영 (에이전트 승인, 상품 모더레이션, 모든 주문 관리)
   - `agent` → 판매자 (자신의 상품/재고만 관리, 자신의 판매 내역 조회)
   - `user` → 일반 소비자 (구매, 조회, 장바구니, 자신의 주문)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 언어/프레임워크 | Node.js 22, TypeScript, Express.js |
| 아키텍처 패턴 | MSA, CQRS, EDA, SAGA, Clean Architecture |
| 이벤트 스트리밍 | Apache Kafka (KRaft 모드, `kafkajs`) |
| 메시지 라우팅 | RabbitMQ (`amqplib`, `amqp-connection-manager`) |
| 캐시/세션/분산 락 | Redis 7 Cluster (`ioredis`) |
| Write DB | PostgreSQL 16 (`pg`, `node-pg-migrate`) |
| Read DB | MongoDB 7 (`mongoose`) |
| 검색 엔진 | OpenSearch 2 (`@opensearch-project/opensearch`) |
| 로드 밸런서 | Nginx (직접 설치) |
| 프로세스 관리 | PM2 Cluster + systemd |
| 로깅 | Pino (JSON 구조화, 파일 저장) |
| 메트릭 | Prometheus + Grafana (직접 설치) |
| 분산 트레이싱 | OpenTelemetry + Jaeger (직접 설치) |
| 모노레포 | pnpm workspace + Turborepo |

---

## 프로젝트 디렉토리 구조

```
ecommerce-backend/
├── apps/
│   ├── api-gateway/          # 진입점: JWT 검증, Rate Limiting, 라우팅, Circuit Breaker
│   ├── auth-service/         # 인증: 4역할 등록/로그인, 에이전트 승인 워크플로우
│   ├── product-service/      # 상품: CQRS, 에이전트 소유권, 관리자 승인
│   ├── order-service/        # 주문: SAGA 패턴, 분산 트랜잭션
│   ├── payment-service/      # 결제: 멱등성, Circuit Breaker, 에이전트 정산
│   ├── inventory-service/    # 재고: Redis 분산 락, 초과 판매 방지
│   ├── cart-service/         # 장바구니: Redis Hash
│   ├── search-service/       # 검색: OpenSearch, Cache-Aside
│   ├── admin-service/        # 어드민 전용: 통계, 감사 로그, 정산 관리, 배송 현황
│   ├── notification-service/ # 알림: RabbitMQ + Kafka Consumer, 내부 SMTP
│   ├── delivery-service/     # 배송: 에이전트별 배송 그룹, 운송장, 반품 처리
│   ├── ads-service/          # 광고: 스폰서 상품(CPC) 캠페인, 승인 워크플로우, 노출·클릭 집계
│   └── sync-worker/          # CQRS Read DB 동기화: Kafka Consumer
│
├── packages/
│   ├── shared/               # 공통 타입, DTO, UserRole enum, 이벤트 타입
│   ├── rbac/                 # RBAC 엔진: Permission 정의, requirePermission 미들웨어
│   ├── kafka-client/         # Kafka Producer/Consumer 래퍼 (kafkajs)
│   ├── rabbitmq-client/      # RabbitMQ 래퍼 (amqplib)
│   ├── redis-client/         # Redis 클라이언트 + 분산 락 Lua Script
│   ├── logger/               # Pino 구조화 로거 (role, userId 자동 포함)
│   └── errors/               # 공통 에러 클래스 (AppError, NotFoundError 등)
│
├── infra/
│   ├── nginx/                # Nginx 설정 (Rate Limiting, Upstream, TLS)
│   ├── postgres/             # DB 초기화 SQL + 마이그레이션
│   ├── kafka/                # 토픽 초기화 스크립트
│   ├── rabbitmq/             # Exchange/Queue 선언 스크립트
│   └── opensearch/           # 인덱스 매핑 (nori 분석기 포함)
│
├── scripts/
│   ├── init-all.sh           # 전체 인프라 초기화 (최초 1회)
│   ├── seed-super-admin.sh   # 슈퍼어드민 계정 시드
│   └── setup-offline.sh      # 오프라인 서버 최초 설치 가이드
│
├── ecosystem.config.js       # PM2 전체 서비스 설정
├── turbo.json
├── pnpm-workspace.yaml
└── CLAUDE.md                 # 이 파일
```

---

## 사용자 역할 (UserRole) 상세

```typescript
enum UserRole {
  SUPER_ADMIN = 'super-admin',
  ADMIN       = 'admin',
  AGENT       = 'agent',
  USER        = 'user',
}
```

### 역할별 핵심 비즈니스 규칙

**super-admin**
- 시스템 내 유일하게 다른 `admin` 계정을 생성/삭제할 수 있음
- 전체 감사 로그(audit log) 조회 가능
- 에이전트 수수료율 설정 권한
- 초기 시드(`seed-super-admin.sh`)를 통해서만 최초 1명 생성

**admin**
- 에이전트 가입 신청을 승인/거절하는 유일한 역할 (super-admin 포함)
- 모든 상품의 게시 승인/거절 권한
- 모든 주문/결제 조회 및 상태 변경 권한
- 다른 admin 계정은 생성 불가 (super-admin 전용)

**agent (판매자)**
- 반드시 `RegisterAgentCommand`로 가입 신청 → admin 승인 후 활성화
- **자신의 `agentId`에 속하는 상품/재고만** 수정 가능 (소유권 검증 필수)
- 타 에이전트의 상품 수정 시도 → 403 Forbidden
- 미승인 상태(pending)의 에이전트가 상품 등록 시도 → 403 Forbidden

**user (소비자)**
- **자신의 주문/결제만** 조회/취소 가능
- 장바구니 및 구매 전용 역할
- 상품 리뷰 작성 가능 (구매 확정 후)

---

## RBAC 미들웨어 사용법

모든 서비스에서 `packages/rbac`의 미들웨어를 사용한다.

```typescript
import { requirePermission, requireOwnership } from '@ecommerce/rbac';
import { Permission } from '@ecommerce/shared';

// 권한 체크
router.patch('/products/:id',
  requirePermission(Permission.PRODUCT_UPDATE_OWN),   // agent 이상
  requireOwnership(getProductOwnerId),                 // agent는 본인 것만
  updateProductController,
);

// 역할 체크 (단순)
router.get('/admin/users',
  requirePermission(Permission.USER_READ_ALL),         // admin 이상
  getAllUsersController,
);

// super-admin 전용
router.post('/admin/create',
  requirePermission(Permission.ADMIN_CREATE),          // super-admin만
  createAdminController,
);
```

---

## CQRS 데이터 흐름

```
[Command (쓰기)] → PostgreSQL Primary ──→ Kafka 이벤트 발행
                                               │
                                        [Sync Worker]
                                               │
                                    ┌──────────┼──────────┐
                                    ▼          ▼          ▼
                                 MongoDB  OpenSearch   Redis 캐시 무효화

[Query (읽기)] → Redis 캐시 확인 → (miss) → MongoDB or OpenSearch
```

---

## 이벤트 카탈로그 (Kafka Topics)

Kafka 토픽은 이벤트 타입별로 세분화되어 있다 (`packages/shared/src/events/kafka-events.ts`의
`KafkaTopic` 값이 실제 Kafka 토픽 이름이며, `infra/kafka/topics.sh`가 이 목록과 반드시 일치해야
한다 — producer가 `allowAutoTopicCreation: false`로 설정되어 있어 토픽이 미리 생성되어 있지
않으면 발행이 실패한다).

| 토픽 | 발행 서비스 | 구독 서비스 |
|------|-----------|-----------|
| `user.registered` | auth-service | sync-worker |
| `agent.approved` | auth-service | notification-service, sync-worker |
| `agent.rejected` | auth-service | notification-service |
| `product.created` | product-service | search-service, sync-worker |
| `product.updated` | product-service | search-service, sync-worker |
| `product.deleted` | product-service | search-service, sync-worker |
| `product.approved` | product-service | search-service, sync-worker |
| `product.rejected` | product-service | (미사용 — 구독자 없음) |
| `inventory.reserved` | inventory-service | order-service |
| `inventory.reservation.failed` | inventory-service | order-service |
| `inventory.released` | inventory-service | (미사용 — 구독자 없음) |
| `inventory.deducted` | inventory-service | sync-worker |
| `stock.low` | (미발행 — 예약됨) | — |
| `order.created` | order-service | inventory-service, notification-service, sync-worker |
| `order.confirmed` | order-service | payment-service |
| `order.paid` | order-service | delivery-service |
| `order.cancelled` | order-service | inventory-service, sync-worker |
| `order.completed` | order-service | sync-worker |
| `payment.completed` | payment-service | order-service, inventory-service, notification-service, sync-worker |
| `payment.failed` | payment-service | order-service, inventory-service, notification-service |
| `payment.refunded` | payment-service | (미사용 — 구독자 없음) |
| `delivery.group.created` | delivery-service | (미사용 — 구독자 없음) |
| `delivery.shipped` | delivery-service | notification-service, sync-worker |
| `delivery.delivered` | delivery-service | notification-service, sync-worker |
| `delivery.all.completed` | delivery-service | order-service |
| `delivery.return.requested` | delivery-service | payment-service |
| `delivery.return.completed` | (미발행 — 예약됨) | — |

새 이벤트 타입을 추가할 때는 `kafka-events.ts`의 `KafkaTopic`과 `infra/kafka/topics.sh`를
함께 갱신할 것.

---

## 오프라인 인프라 포트 맵

| 서비스 | 포트 |
|--------|------|
| Nginx (외부) | 80, 443 |
| API Gateway | 3000 |
| Auth Service | 3001 |
| Product Service | 3002 |
| Order Service | 3003 |
| Payment Service | 3004 |
| Cart Service | 3005 |
| Search Service | 3006 |
| Inventory Service | 3007 |
| Admin Service | 3008 |
| Notification Service | 3009 |
| Delivery Service | 3010 |
| Review Service | 3011 |
| Sync Worker | 3012 |
| Ads Service | 3013 |
| PostgreSQL | 5432 |
| MongoDB | 27017 |
| Redis (Cluster) | 7001~7006 |
| Kafka | 9092 |
| RabbitMQ | 5672, 15672 (UI) |
| OpenSearch | 9200 |
| Prometheus | 9090 |
| Grafana | 3030 |
| Jaeger | 16686 |

---

## 코드 작성 규칙

- **Clean Architecture**: domain → application → infrastructure → presentation 순으로 의존
- **역할 검증**: 모든 보호된 라우트에 `requirePermission()` 미들웨어 적용 필수
- **소유권 검증**: `agent`가 리소스를 수정할 때 반드시 `requireOwnership()` 적용
- **오프라인 우선**: 외부 CDN, 외부 API 호출 금지 (PG사 내부망 연동 제외)
- **주석 최소화**: WHY가 비명백한 경우만 짧게 작성
- **에러 처리**: `packages/errors`의 공통 에러 클래스 사용, 전역 에러 핸들러로 위임
- **로깅**: 모든 요청에 `userId`, `role`, `requestId` 포함

---

## 개발 시작 방법

```bash
# 의존성 설치 (오프라인 환경: Verdaccio 또는 번들 node_modules 사용)
pnpm install

# 전체 빌드
pnpm turbo build

# 로컬 개발 (개발 환경에서는 인프라 직접 설치 필요)
pnpm turbo dev

# 특정 서비스만 실행
pnpm --filter auth-service dev

# 프로덕션 (PM2)
pm2 start ecosystem.config.js

# 전체 인프라 초기화 (최초 1회)
bash scripts/init-all.sh
```
