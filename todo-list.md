# eCommerce 백엔드 구축 Todo 리스트
## 동시 접속자 10만 명 | Node.js + TypeScript + Express.js + MSA + CQRS + Kafka + RabbitMQ + Redis + OpenSearch
## 오프라인(온프레미스) 전용 | Docker/Kubernetes 미사용 | PM2 + systemd + Nginx

---

## 핵심 제약 조건 (모든 Phase에 적용)

> **오프라인(Offline/On-Premise) 전용 서버**
> - Docker, Kubernetes, 클라우드 관리형 서비스(AWS/GCP/Azure) 사용 금지
> - 모든 인프라는 물리/가상 서버에 직접 설치 (베어메탈 또는 On-Prem VM)
> - 프로세스 관리: PM2 Cluster 모드 + systemd 서비스 등록
> - 의존성 관리: 오프라인 환경에서 node_modules 번들 전송 또는 Verdaccio Private NPM
> - 인터넷 연결 없는 환경에서 완전히 동작해야 함

---

## 4가지 사용자 역할 (Role) 정의

| 역할 | 설명 | 핵심 권한 |
|------|------|-----------|
| `super-admin` | 플랫폼 최고 관리자 | 전체 시스템 설정, 어드민 계정 생성/삭제, 전체 로그/분석 접근 |
| `admin` | 플랫폼 운영 관리자 | 에이전트 가입 승인, 상품 모더레이션, 전체 주문/사용자 관리, 대시보드 |
| `agent` | 판매자 (셀러) | 자신의 상품 등록/수정/삭제, 자신의 재고 관리, 자신의 판매 내역 조회 |
| `user` | 일반 소비자 | 상품 검색/조회, 장바구니, 주문, 결제, 자신의 주문 내역, 리뷰 작성 |

### 역할별 접근 권한 매트릭스

```
엔드포인트                  super-admin  admin  agent  user
─────────────────────────────────────────────────────────
시스템 설정 변경                  ✅        ❌      ❌     ❌
어드민 계정 생성/삭제             ✅        ❌      ❌     ❌
전체 로그/감사 이력 조회          ✅        ✅      ❌     ❌
에이전트 가입 신청 승인           ✅        ✅      ❌     ❌
전체 사용자 목록/관리             ✅        ✅      ❌     ❌
전체 주문 조회/관리               ✅        ✅      ❌     ❌
전체 상품 모더레이션              ✅        ✅      ❌     ❌
자신의 상품 등록/수정/삭제        ✅        ✅      ✅     ❌
자신의 재고 관리                  ✅        ✅      ✅     ❌
자신의 판매 내역 조회             ✅        ✅      ✅     ❌
상품 검색/조회                    ✅        ✅      ✅     ✅
장바구니 관리                     ✅        ✅      ✅     ✅
주문 생성/취소                    ✅        ✅      ✅     ✅
자신의 주문 내역 조회             ✅        ✅      ✅     ✅
리뷰 작성                         ✅        ✅      ✅     ✅
```

---

## Phase 0: 아키텍처 설계 & 사전 준비

- [ ] 전체 시스템 아키텍처 다이어그램 작성 (MSA 서비스 맵)
- [ ] 도메인 경계(Bounded Context) 정의 — 7개 핵심 도메인 확정
- [ ] 4가지 사용자 역할 기반 도메인 권한 설계 (`super-admin` / `admin` / `agent` / `user`)
- [ ] 데이터베이스 설계 (ERD) — Write DB(PostgreSQL) / Read DB(OpenSearch, MongoDB) 분리
- [ ] `users` 테이블에 `role` 컬럼 및 `agent_profile` 테이블 설계
- [ ] `agent_approval` 테이블 설계 (에이전트 가입 승인 워크플로우)
- [ ] Kafka 토픽 목록 및 RabbitMQ Exchange/Queue 설계
- [ ] API 계약서 작성 (OpenAPI 3.0 / Swagger) — 역할별 엔드포인트 분리
- [ ] **오프라인 인프라 설치 계획서** 작성 (서버 수, 포트, 방화벽 규칙)
- [ ] Verdaccio Private NPM 서버 구성 계획 또는 node_modules 번들 전략 수립

---

## Phase 1: 모노레포 & 프로젝트 기반 구조

- [ ] **모노레포 초기화** — pnpm workspace + Turborepo
  - [ ] `apps/` — 각 마이크로서비스
  - [ ] `packages/shared/` — 공통 타입/유틸/DTO
  - [ ] `packages/kafka-client/` — 공통 Kafka Producer/Consumer 래퍼
  - [ ] `packages/rabbitmq-client/` — 공통 RabbitMQ 클라이언트 래퍼
  - [ ] `packages/redis-client/` — 공통 Redis 클라이언트 + 분산 락
  - [ ] `packages/logger/` — 구조화 로깅 (Pino)
  - [ ] `packages/errors/` — 공통 에러 클래스 정의
  - [ ] `packages/rbac/` — **역할 기반 접근 제어 (RBAC) 엔진**
- [ ] TypeScript 공통 설정 (`tsconfig.base.json`)
- [ ] ESLint + Prettier 공통 설정
- [ ] `.env.example` 템플릿 작성 (서비스별)
- [ ] **PM2 `ecosystem.config.js`** — 전체 서비스 프로세스 관리 설정 (Docker 대체)
- [ ] **systemd 서비스 유닛 파일** 작성 — 서버 재부팅 시 자동 시작 (Docker 대체)
- [ ] **Nginx 설정 파일** 작성 — 내부 로드 밸런서 + 역방향 프록시 (Docker 대체)
- [ ] `scripts/setup-offline.sh` — 오프라인 서버 최초 설치 스크립트

---

## Phase 2: 공유 패키지 (packages/)

### 2-1. 공통 타입 & DTO (`packages/shared`)
- [ ] 공통 API 응답 래퍼 타입 정의 (`ApiResponse<T>`, `PaginatedResponse<T>`)
- [ ] 공통 에러 코드 enum 정의
- [ ] **사용자 역할 타입 정의**
  ```typescript
  enum UserRole {
    SUPER_ADMIN = 'super-admin',
    ADMIN       = 'admin',
    AGENT       = 'agent',
    USER        = 'user',
  }
  ```
- [ ] 도메인별 DTO 타입 정의 (User, Product, Order, Inventory, Cart, AgentProfile)
- [ ] Kafka 이벤트 페이로드 타입 정의 (이벤트 카탈로그)
  - `OrderCreatedEvent`, `OrderPaidEvent`, `OrderCancelledEvent`
  - `InventoryReservedEvent`, `InventoryReleasedEvent`
  - `PaymentCompletedEvent`, `PaymentFailedEvent`
  - `ProductCreatedEvent`, `ProductUpdatedEvent`
  - `UserRegisteredEvent`
  - `AgentApprovedEvent`, `AgentRejectedEvent`
  - `DeliveryGroupCreatedEvent`, `DeliveryShippedEvent`
  - `DeliveryCompletedEvent`, `AllDeliveriesCompletedEvent`
  - `ReturnRequestedEvent`

### 2-2. RBAC 엔진 (`packages/rbac`) ← **신규**
- [ ] **Permission 정의** — 리소스 × 액션 기반 권한 목록
  ```typescript
  enum Permission {
    // 시스템
    SYSTEM_CONFIG_WRITE    = 'system:config:write',
    // 사용자 관리
    USER_READ_ALL          = 'user:read:all',
    USER_WRITE_ALL         = 'user:write:all',
    ADMIN_CREATE           = 'admin:create',
    AGENT_APPROVE          = 'agent:approve',
    // 상품
    PRODUCT_CREATE         = 'product:create',
    PRODUCT_UPDATE_OWN     = 'product:update:own',
    PRODUCT_UPDATE_ALL     = 'product:update:all',
    PRODUCT_DELETE_OWN     = 'product:delete:own',
    PRODUCT_DELETE_ALL     = 'product:delete:all',
    PRODUCT_READ           = 'product:read',
    // 주문
    ORDER_READ_OWN         = 'order:read:own',
    ORDER_READ_ALL         = 'order:read:all',
    ORDER_CANCEL_OWN       = 'order:cancel:own',
    ORDER_CANCEL_ALL       = 'order:cancel:all',
    // 재고
    INVENTORY_MANAGE_OWN   = 'inventory:manage:own',
    INVENTORY_MANAGE_ALL   = 'inventory:manage:all',
    // 통계
    ANALYTICS_OWN          = 'analytics:own',
    ANALYTICS_ALL          = 'analytics:all',
  }
  ```
- [ ] **역할-권한 매핑 테이블** 구현
- [ ] **`requirePermission(permission)` Express 미들웨어** 구현
  - JWT에서 `role` 추출 → 권한 보유 여부 확인 → 없으면 403 반환
- [ ] **`requireOwnership(getOwnerId)` 미들웨어** 구현
  - `agent`가 자신의 상품만 수정/삭제 가능하도록 소유권 검증

### 2-3. Kafka 클라이언트 (`packages/kafka-client`)
- [ ] `kafkajs` 기반 Producer 클래스 구현 (재시도 + 에러 핸들링)
- [ ] Consumer 그룹 관리 클래스 구현 (Backpressure 제어)
- [ ] Dead Letter Queue(DLQ) 처리 로직 구현
- [ ] 메시지 직렬화/역직렬화 (JSON Schema 검증 포함)

### 2-4. RabbitMQ 클라이언트 (`packages/rabbitmq-client`)
- [ ] `amqplib` + `amqp-connection-manager` 기반 Connection Pool 구현
- [ ] Exchange/Queue 자동 선언 유틸리티
- [ ] 재연결(Reconnect) 및 채널 재생성 로직

### 2-5. Redis 클라이언트 (`packages/redis-client`)
- [ ] `ioredis` 기반 Redis Cluster 연결 클래스
- [ ] 분산 락 (Distributed Lock) 구현 — Lua Script 기반 원자적 처리
- [ ] Cache-Aside 패턴 유틸리티 함수 (`getOrSet`)
- [ ] Redis Hash 기반 장바구니 유틸리티

### 2-6. 구조화 로거 (`packages/logger`)
- [ ] `pino` 기반 JSON 로거 설정 (로그 → 파일 저장, 온라인 서비스 비사용)
- [ ] Request ID 추적 (correlation-id) 미들웨어
- [ ] 역할(role) 및 사용자 ID를 로그에 자동 포함 (감사 로그용)

---

## Phase 3: 인프라 서비스 구성 (오프라인 직접 설치)

> Docker/Kubernetes 미사용 — 모든 인프라를 OS에 직접 설치하고 systemd로 관리

### 3-1. 데이터베이스 (직접 설치)
- [ ] **PostgreSQL 16** — 물리 서버에 직접 설치 (`apt`/`yum`)
  - [ ] Primary 서버 설정 (`postgresql.conf`, `pg_hba.conf`)
  - [ ] Replica 서버 설정 (스트리밍 복제)
  - [ ] systemd 서비스 등록 (`postgresql.service`)
  - [ ] `users` 스키마 — `role` 컬럼 (`super-admin`/`admin`/`agent`/`user`)
  - [ ] `agent_profiles` 테이블 — 사업자 정보, 승인 상태, 수수료율
  - [ ] `agent_approval_requests` 테이블 — 에이전트 가입 승인 워크플로우
  - [ ] `products` 스키마 — `agent_id` FK (소유권 추적)
  - [ ] `orders` 스키마
  - [ ] `inventory` 스키마
  - [ ] `payments` 스키마 — 멱등성 키 유니크 인덱스
  - [ ] `audit_logs` 테이블 — super-admin/admin 액션 감사 이력
- [ ] **MongoDB 7** — 직접 설치
  - [ ] Replica Set 구성 (3 노드)
  - [ ] systemd 서비스 등록 (`mongod.service`)
- [ ] **Redis 7** — 직접 설치
  - [ ] Redis Cluster 구성 (3 Master + 3 Replica, 각각 별도 포트)
  - [ ] `redis-server` systemd 서비스 × 6개 등록
  - [ ] `redis-cli --cluster create` 클러스터 초기화 스크립트

### 3-2. 메시지 브로커 (직접 설치)
- [ ] **Apache Kafka 3.8+** — KRaft 모드, 직접 설치
  - [ ] JDK 17+ 설치 (오프라인 패키지)
  - [ ] Kafka 바이너리 다운로드 및 설치
  - [ ] KRaft 모드 설정 (Zookeeper 불필요)
  - [ ] systemd 서비스 등록 (`kafka.service`)
  - [ ] 토픽 초기화 스크립트 (`scripts/kafka-init-topics.sh`)
- [ ] **RabbitMQ 3.13+** — Erlang 포함 직접 설치
  - [ ] Management Plugin 활성화
  - [ ] systemd 서비스 등록 (`rabbitmq-server.service`)
  - [ ] Exchange/Queue 초기 선언 스크립트 (`scripts/rabbitmq-init.sh`)

### 3-3. 검색 엔진 (직접 설치)
- [ ] **OpenSearch 2.13+** — 직접 설치 (Apache 2.0, 오프라인 무료)
  - [ ] JDK 17+ (Kafka와 공유 또는 별도)
  - [ ] 3-Node 클러스터 설정 (Master 1 + Data 2)
  - [ ] systemd 서비스 등록 (`opensearch.service`)
  - [ ] `products` 인덱스 매핑 + 한국어 nori 형태소 분석기
  - [ ] `users` 인덱스 매핑 (어드민 검색용)
  - [ ] 인덱스 초기화 스크립트 (`scripts/opensearch-init.sh`)

### 3-4. 로드 밸런서 & 역방향 프록시
- [ ] **Nginx 1.25+** — 직접 설치
  - [ ] Rate Limiting (`limit_req_zone`)
  - [ ] Upstream Round Robin 설정 (PM2 멀티 인스턴스 대상)
  - [ ] HTTPS(TLS) 설정 — 내부망 자체 서명 인증서
  - [ ] systemd 서비스 (`nginx.service`)

---

## Phase 4: API Gateway 서비스 (`apps/api-gateway`)

- [ ] Express.js + TypeScript 프로젝트 초기화
- [ ] **JWT 검증 미들웨어** 구현 — 토큰에서 `userId`, `role` 추출
- [ ] **Rate Limiting 미들웨어** (`express-rate-limit` + Redis 스토어)
  - [ ] 역할별 Rate Limit 차등 적용 (admin은 더 높은 한도)
- [ ] **역할 기반 라우팅 가드** 구현
  - [ ] `/api/super-admin/*` — `super-admin` 전용 경로
  - [ ] `/api/admin/*` — `admin`, `super-admin` 접근 가능
  - [ ] `/api/agent/*` — `agent`, `admin`, `super-admin` 접근 가능
  - [ ] `/api/*` — 인증된 모든 사용자 접근 가능
  - [ ] `/api/public/*` — 인증 없이 접근 가능 (상품 조회, 검색)
- [ ] **서비스 라우팅** — 내부 마이크로서비스로 요청 프록시 (`http-proxy-middleware`)
- [ ] **Request ID 생성** 및 헤더 전파 (`x-request-id`, `x-trace-id`, `x-user-role`)
- [ ] **전역 에러 핸들러** 미들웨어 구현
- [ ] **Circuit Breaker** 구현 (`opossum`)
  - [ ] 결제 서비스 Circuit Breaker
  - [ ] 검색 서비스 Circuit Breaker
- [ ] CORS, Helmet.js 보안 헤더
- [ ] **HTTP 액세스 로그** — 역할(role) 포함, 파일 저장 (Pino)
- [ ] **헬스 체크** 엔드포인트 (`/health`, `/ready`)
- [ ] PM2 Cluster 모드 설정

---

## Phase 5: 회원/인증 서비스 (`apps/auth-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **도메인 레이어**
  - [ ] `User` 도메인 엔티티 — `role: UserRole` 포함
  - [ ] `AgentProfile` 값 객체 (사업자명, 사업자번호, 계좌 정보, 승인 상태)
  - [ ] `UserRepository` 인터페이스

- [ ] **인프라 레이어**
  - [ ] PostgreSQL `UserRepository` 구현 (`pg`)
  - [ ] Redis 세션 저장소 구현 (`ioredis`)

- [ ] **애플리케이션 레이어 (Commands) — 역할별 분기**
  - [ ] `RegisterUserCommand` — `role: 'user'`로 일반 회원가입
  - [ ] `RegisterAgentCommand` — 에이전트 가입 신청 (`role: 'agent'`, 승인 대기 상태)
  - [ ] `ApproveAgentCommand` — **`admin`/`super-admin` 전용** 에이전트 가입 승인
  - [ ] `RejectAgentCommand` — **`admin`/`super-admin` 전용** 에이전트 가입 거절
  - [ ] `CreateAdminCommand` — **`super-admin` 전용** 어드민 계정 생성
  - [ ] `LoginCommand` — 로그인 + JWT에 `role` 포함 + Redis 세션 저장
  - [ ] `LogoutCommand` — Redis 세션 삭제
  - [ ] `RefreshTokenCommand` — 액세스 토큰 갱신
  - [ ] `ChangeUserRoleCommand` — **`super-admin` 전용** 역할 변경

- [ ] **애플리케이션 레이어 (Queries)**
  - [ ] `GetUserProfileQuery` — 본인 프로필 조회
  - [ ] `GetAllUsersQuery` — **`admin`/`super-admin` 전용**
  - [ ] `GetPendingAgentsQuery` — **`admin`/`super-admin` 전용** 승인 대기 에이전트 목록
  - [ ] `GetAgentProfileQuery` — 에이전트 상세 프로필 (본인 또는 관리자)

- [ ] **비밀번호 암호화** (`bcrypt`, salt rounds 12)
- [ ] **JWT 발급** — 페이로드에 `{ sub, email, role, agentId? }` 포함
- [ ] **Kafka 이벤트 발행**
  - [ ] `UserRegisteredEvent` 발행
  - [ ] `AgentApprovedEvent` 발행 (에이전트 승인 시)
- [ ] **API 라우트**
  ```
  POST   /register              — 일반 사용자 가입
  POST   /register/agent        — 에이전트 가입 신청
  POST   /login
  POST   /logout
  POST   /refresh
  GET    /me                    — 본인 프로필
  GET    /users                 — admin+ 전용
  GET    /users/:id             — admin+ 또는 본인
  PATCH  /users/:id/role        — super-admin 전용
  GET    /agents/pending        — admin+ 전용
  POST   /agents/:id/approve    — admin+ 전용
  POST   /agents/:id/reject     — admin+ 전용
  POST   /admin/create          — super-admin 전용
  ```

---

## Phase 6: 상품 카탈로그 서비스 (`apps/product-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **도메인 레이어**
  - [ ] `Product` 엔티티 — `agentId: string` (소유자) 포함
  - [ ] `ProductRepository` 인터페이스

- [ ] **CQRS Write 레이어 (Command Side) — 역할별 권한**
  - [ ] `CreateProductCommand`
    - `agent`: 자신의 `agentId`로 상품 등록 (승인된 에이전트만 가능)
    - `admin`/`super-admin`: 어떤 에이전트의 상품도 등록 가능
    - Kafka `ProductCreatedEvent` 발행
  - [ ] `UpdateProductCommand`
    - `agent`: 자신의 상품만 수정 (`agentId` 소유권 검증)
    - `admin`/`super-admin`: 모든 상품 수정 가능
    - Kafka `ProductUpdatedEvent` 발행
  - [ ] `DeleteProductCommand` — 동일한 소유권 규칙 적용
  - [ ] `ApproveProductCommand` — **`admin`/`super-admin` 전용** 상품 게시 승인
  - [ ] `RejectProductCommand` — **`admin`/`super-admin` 전용** 상품 게시 거절

- [ ] **CQRS Read 레이어 (Query Side)**
  - [ ] `GetProductByIdQuery` — Redis 캐시 우선, MongoDB 폴백
  - [ ] `GetProductListQuery` — 카테고리, 페이지네이션 (공개)
  - [ ] `GetMyProductsQuery` — **`agent` 전용** 자신의 상품 목록
  - [ ] `GetAllProductsAdminQuery` — **`admin`/`super-admin` 전용** (미승인 포함)
  - [ ] `GetFeaturedProductsQuery` — Redis Sorted Set 기반

- [ ] **Kafka Consumer** — `ProductUpdatedEvent` 수신 후 Read DB 동기화
  - [ ] MongoDB 상품 문서 업데이트
  - [ ] OpenSearch 인덱스 업데이트
  - [ ] Redis 캐시 무효화

- [ ] **API 라우트**
  ```
  GET    /products               — 공개 (user, agent, admin, super-admin)
  GET    /products/:id           — 공개
  POST   /products               — agent+ (승인된 에이전트만)
  PATCH  /products/:id           — agent (본인 것) / admin+
  DELETE /products/:id           — agent (본인 것) / admin+
  POST   /products/:id/approve   — admin+ 전용
  POST   /products/:id/reject    — admin+ 전용
  GET    /my/products            — agent 전용
  GET    /admin/products         — admin+ 전용 (미승인 포함)
  ```

---

## Phase 7: 검색 서비스 (`apps/search-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **OpenSearch 연결** (`@opensearch-project/opensearch`) — 오프라인 로컬 클러스터
  - [ ] Connection Pool + `keepAlive: true`
- [ ] **검색 자동완성** — Redis Sorted Set 기반
- [ ] **풀텍스트 검색** — Cache-Aside, `multi_match`, Fuzzy, 한국어 nori 분석기
- [ ] **복합 필터링** (가격대, 카테고리, 브랜드, 재고 여부, 에이전트)
- [ ] **Cursor 기반 페이지네이션** (`search_after`)
- [ ] **응답 경량화** — `_source` 필터
- [ ] **에이전트별 상품 검색** — `agentId` 필터 (에이전트 스토어 페이지용)
- [ ] **Kafka Consumer** — `ProductUpdatedEvent` 수신 후 OpenSearch 인덱스 갱신 + Redis 캐시 무효화

---

## Phase 8: 재고 서비스 (`apps/inventory-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **도메인 레이어**
  - [ ] `Inventory` 엔티티 (`productId`, `agentId`, `quantity`, `reservedQuantity`)

- [ ] **소유권 기반 재고 관리**
  - [ ] `agent`: 자신의 상품 재고만 수정 가능
  - [ ] `admin`/`super-admin`: 모든 재고 조회/수정 가능

- [ ] **Redis Lua Script 기반 원자적 재고 차감** (초과 판매 방지)
- [ ] **CQRS Command 레이어**
  - [ ] `ReserveInventoryCommand` — Redis 선차감 → Kafka 이벤트 발행
  - [ ] `ConfirmInventoryCommand` — PostgreSQL DB 반영
  - [ ] `ReleaseInventoryCommand` — 주문 취소 시 복구
  - [ ] `RestockInventoryCommand` — **`agent`(본인)/`admin`+** 재고 추가
  - [ ] `AdjustInventoryCommand` — **`admin`/`super-admin` 전용** 강제 재고 조정

- [ ] **CQRS Query 레이어**
  - [ ] `GetInventoryQuery` — Redis 재고 조회 (agent: 본인 것, admin+: 전체)
  - [ ] `GetLowStockReportQuery` — **`admin`/`super-admin` 전용** 재고 부족 상품 리포트

- [ ] **Kafka Consumer** — `OrderCreatedEvent`, `PaymentFailedEvent` 처리
- [ ] **Kafka Producer** — `InventoryReservedEvent`, `InventoryInsufficientEvent` 발행

---

## Phase 9: 주문 서비스 (`apps/order-service`)

> 주문 상태와 배송 상태는 **분리**한다.
> 주문은 결제까지만 책임지고, 배송은 별도 `delivery-service`가 담당한다.

- [ ] Express.js + TypeScript 초기화
- [ ] **도메인 레이어**
  - [ ] `Order` 엔티티 — 주문 상태 머신:
    ```
    PENDING → CONFIRMED → PAID → FULFILLING → COMPLETED / CANCELLED
    ```
    - `PENDING`: 주문 접수, 재고 예약 대기
    - `CONFIRMED`: 재고 예약 완료, 결제 대기
    - `PAID`: 결제 완료, 배송 준비 중
    - `FULFILLING`: 에이전트별 배송 그룹 중 일부가 배송 중
    - `COMPLETED`: 모든 배송 그룹 배송 완료
    - `CANCELLED`: 취소 (결제 전 취소 또는 환불 완료)
  - [ ] `OrderItem` 값 객체 (`productId`, `agentId`, `quantity`, `unitPrice`, `shippingFee`)
  - [ ] 주문 항목에 `agentId` 포함 — 에이전트별 **배송 그룹** 및 정산 분리 지원
  - [ ] `OrderRepository` 인터페이스

- [ ] **SAGA 패턴** — 분산 트랜잭션 조정
  - [ ] `CreateOrderSaga`: 주문(PENDING) → 재고 예약 → 결제 → 주문(PAID) → 배송 그룹 생성 요청
  - [ ] 실패 시 보상 트랜잭션: 재고 복구 + 주문 CANCELLED

- [ ] **CQRS Command 레이어 — 역할별 권한**
  - [ ] `CreateOrderCommand` — `user`/`agent`/`admin`+ (구매자 역할)
    - 주문 생성 시 items를 `agentId` 기준으로 그룹화하여 배송비 계산
  - [ ] `CancelOrderCommand`
    - `user`/`agent`: 자신의 주문, `PAID` 이전만 취소 가능
    - `admin`/`super-admin`: 모든 주문, 모든 상태 취소 가능
  - [ ] `UpdateOrderStatusCommand` — **`admin`/`super-admin` 전용** (전체 주문 상태 강제 변경)
  - [ ] `CompleteOrderCommand` — 배송 서비스에서 모든 배송 그룹 완료 시 자동 호출

- [ ] **CQRS Query 레이어**
  - [ ] `GetOrderByIdQuery` — 본인 주문 또는 admin+ (배송 그룹 상태 포함)
  - [ ] `GetMyOrdersQuery` — 본인 주문 목록 (`user`/`agent`)
  - [ ] `GetAllOrdersQuery` — **`admin`/`super-admin` 전용**
  - [ ] `GetAgentOrdersQuery` — **`agent` 전용** 자신의 상품이 포함된 주문 (배송 그룹 단위)
  - [ ] `GetOrderAnalyticsQuery` — **`admin`/`super-admin` 전용** 주문 통계

- [ ] **Kafka Consumer** — 인벤토리/결제/배송 이벤트 처리
  - [ ] `InventoryReservedEvent` → 주문 CONFIRMED 업데이트
  - [ ] `PaymentCompletedEvent` → 주문 PAID 업데이트 + `OrderPaidEvent` 발행
  - [ ] `AllDeliveriesCompletedEvent` → 주문 COMPLETED 업데이트
- [ ] **Kafka Producer**
  - [ ] `OrderCreatedEvent` 발행 (재고 서비스 트리거)
  - [ ] `OrderPaidEvent` 발행 (배송 서비스 트리거 — 에이전트별 배송 그룹 생성)
  - [ ] `OrderCancelledEvent` 발행

---

## Phase 10: 결제 서비스 (`apps/payment-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **도메인 레이어**
  - [ ] `Payment` 엔티티 — 상태: `PENDING` → `PROCESSING` → `COMPLETED` / `FAILED` / `REFUNDED`
  - [ ] `Refund` 엔티티

- [ ] **CQRS Command 레이어**
  - [ ] `ProcessPaymentCommand` — 멱등성 키 포함, PG사 연동 (Circuit Breaker)
  - [ ] `RefundPaymentCommand`
    - `user`: 자신의 결제만 환불 요청 가능
    - `admin`/`super-admin`: 모든 결제 환불 가능

- [ ] **에이전트 정산 처리**
  - [ ] 결제 완료 시 주문 항목별 에이전트에게 정산 금액 계산
  - [ ] `AgentSettlementCreatedEvent` — Kafka 발행 → 정산 서비스 처리

- [ ] **CQRS Query 레이어**
  - [ ] `GetPaymentQuery` — 본인 결제 또는 admin+
  - [ ] `GetAllPaymentsQuery` — **`admin`/`super-admin` 전용**
  - [ ] `GetAgentSettlementQuery` — **`agent` 전용** 자신의 정산 내역

- [ ] **멱등성 보장** — `idempotency_key` 유니크 인덱스
- [ ] **Circuit Breaker** — PG사 API 장애 대응 (`opossum`)
- [ ] **Kafka Consumer** — `OrderCreatedEvent` 수신 → 결제 처리
- [ ] **Kafka Producer** — `PaymentCompletedEvent`, `PaymentFailedEvent` 발행
- [ ] **RabbitMQ Producer** — 영수증 발송, 정산 요청 메시지 라우팅

---

## Phase 11: 배송 서비스 (`apps/delivery-service`) ← **신규**

> 하나의 주문에 여러 에이전트 상품이 포함될 경우 **에이전트별로 독립된 배송 그룹(DeliveryGroup)** 을 생성한다.
> 각 에이전트가 자신의 배송 그룹에 운송장 번호를 입력하고 상태를 관리한다.

- [ ] Express.js + TypeScript 초기화
- [ ] **도메인 레이어**
  - [ ] `DeliveryGroup` 엔티티 — 에이전트별 배송 단위
    ```
    agentId, orderId, items[], shippingFee, courierName, trackingNumber
    ```
  - [ ] 배송 그룹 상태 머신:
    ```
    PREPARING → SHIPPED → IN_TRANSIT → DELIVERED
                                    ↘ FAILED → RETURN_REQUESTED → RETURNED
    ```
    - `PREPARING`: 에이전트가 상품 준비 중
    - `SHIPPED`: 에이전트가 운송장 번호 입력, 발송 완료
    - `IN_TRANSIT`: 택배사 수령, 배송 중
    - `DELIVERED`: 고객 수령 완료
    - `FAILED`: 배송 실패 (주소 오류, 수취 거부 등)
    - `RETURN_REQUESTED`: 고객 반품 요청
    - `RETURNED`: 반품 완료 → 환불 트리거
  - [ ] `AgentShippingPolicy` 엔티티 — 에이전트별 배송 정책
    ```
    agentId, baseShippingFee, freeShippingThreshold, remoteAreaFee,
    supportedCouriers[], defaultCourier
    ```
  - [ ] `DeliveryGroupRepository` 인터페이스
  - [ ] `AgentShippingPolicyRepository` 인터페이스

- [ ] **에이전트별 배송 그룹 생성 로직**
  - [ ] `Kafka Consumer`: `OrderPaidEvent` 수신
    - 주문 항목을 `agentId` 기준으로 그룹화
    - 에이전트마다 `DeliveryGroup` 1개 생성 (상태: `PREPARING`)
    - `DeliveryGroupCreatedEvent` 발행 → 알림 서비스 (에이전트에게 새 주문 알림)

- [ ] **배송비 계산 서비스**
  - [ ] `CalculateShippingFeeQuery` — 에이전트 배송 정책 기준 배송비 계산
    - 기본 배송비 (`baseShippingFee`)
    - 무료 배송 기준 금액 초과 시 0원 (`freeShippingThreshold`)
    - 도서산간 지역 추가비 (`remoteAreaFee`)
  - [ ] 주문 생성 시 배송비를 미리 계산하여 `OrderItem.shippingFee`에 반영

- [ ] **CQRS Command 레이어 — 역할별 권한**
  - [ ] `RegisterTrackingNumberCommand` — **`agent` (본인 그룹)/`admin`+**
    - 운송장 번호 + 택배사 입력 → 배송 그룹 상태 `SHIPPED`로 변경
    - `DeliveryShippedEvent` 발행 → 구매자에게 발송 알림
  - [ ] `UpdateDeliveryStatusCommand` — **`admin`/`super-admin` 전용**
    - 배송 상태 강제 변경 (고객 문의 처리용)
  - [ ] `ConfirmDeliveryCommand` — 구매자가 수령 확인 (`user`)
    - 상태 `IN_TRANSIT` → `DELIVERED` 변경
    - 모든 배송 그룹 완료 시 `AllDeliveriesCompletedEvent` 발행
  - [ ] `RequestReturnCommand` — 구매자 반품 요청 (`user`)
    - 상태 `DELIVERED` → `RETURN_REQUESTED`
    - `ReturnRequestedEvent` 발행 → 환불 서비스 트리거
  - [ ] `UpdateAgentShippingPolicyCommand` — **`agent` (본인)/`admin`+**
    - 배송비 정책, 무료배송 기준, 도서산간 추가비, 사용 택배사 설정

- [ ] **CQRS Query 레이어**
  - [ ] `GetDeliveryGroupByOrderQuery` — 주문별 전체 배송 그룹 조회 (구매자 배송 추적 화면)
  - [ ] `GetMyDeliveryGroupsQuery` — **`agent` 전용** 자신의 배송 그룹 목록 (발송 관리 화면)
  - [ ] `GetAllDeliveryGroupsQuery` — **`admin`/`super-admin` 전용** 전체 배송 현황
  - [ ] `GetPendingShipmentQuery` — **`agent` 전용** 발송 대기(`PREPARING`) 배송 그룹 목록
  - [ ] `GetAgentShippingPolicyQuery` — 에이전트 배송 정책 조회 (주문 시 배송비 계산용)
  - [ ] `GetDeliveryAnalyticsQuery` — **`admin`/`super-admin` 전용** 배송 통계 (평균 배송 시간, 반품율)

- [ ] **Kafka Consumer**
  - [ ] `OrderPaidEvent` → 에이전트별 배송 그룹 자동 생성
  - [ ] `OrderCancelledEvent` → 배송 그룹 취소 처리 (PREPARING 상태인 경우)
- [ ] **Kafka Producer**
  - [ ] `DeliveryGroupCreatedEvent` (에이전트 새 주문 알림)
  - [ ] `DeliveryShippedEvent` (구매자 발송 알림)
  - [ ] `DeliveryCompletedEvent` (구매자 배송 완료 알림)
  - [ ] `AllDeliveriesCompletedEvent` (주문 서비스 → 주문 COMPLETED 처리)
  - [ ] `ReturnRequestedEvent` (결제 서비스 → 환불 트리거)

- [ ] **API 라우트**
  ```
  GET    /delivery/orders/:orderId          — 주문별 배송 그룹 조회 (본인 또는 admin+)
  GET    /delivery/my/pending               — agent 전용: 발송 대기 목록
  GET    /delivery/my/groups                — agent 전용: 전체 배송 그룹 목록
  PATCH  /delivery/groups/:id/tracking      — agent(본인)/admin+: 운송장 번호 등록
  PATCH  /delivery/groups/:id/status        — admin+ 전용: 배송 상태 강제 변경
  POST   /delivery/groups/:id/confirm       — user: 수령 확인
  POST   /delivery/groups/:id/return        — user: 반품 요청
  GET    /delivery/policy/:agentId          — 에이전트 배송 정책 조회 (공개)
  PUT    /delivery/policy                   — agent(본인)/admin+: 배송 정책 설정
  GET    /admin/delivery/all                — admin+ 전용: 전체 배송 현황
  GET    /admin/delivery/analytics          — admin+ 전용: 배송 통계
  ```

- [ ] **PostgreSQL 스키마**
  - [ ] `delivery_groups` 테이블
  - [ ] `agent_shipping_policies` 테이블
  - [ ] `return_requests` 테이블

---

## Phase 13: 장바구니 서비스 (`apps/cart-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **Redis Hash 기반 장바구니** (`cart:{userId}`)
  - [ ] `AddToCartCommand`, `RemoveFromCartCommand`
  - [ ] `UpdateCartItemCommand`, `ClearCartCommand`
  - [ ] `GetCartQuery`
- [ ] 장바구니 항목에 `agentId` 포함 (에이전트별 그룹핑, 배송비 계산용)
- [ ] TTL 관리 — 비로그인 24시간, 로그인 30일
- [ ] 주문 전환 시 장바구니 → 주문 서비스 전달 후 초기화

---

## Phase 14: 알림 서비스 (`apps/notification-service`)

- [ ] Express.js + TypeScript 초기화
- [ ] **RabbitMQ Consumer** — 알림 유형별 큐 구독
  - [ ] `notification.email` — 이메일 알림
  - [ ] `notification.push` — 푸시/SMS
  - [ ] `notification.settlement` — 에이전트 정산 알림
  - [ ] `notification.agent-approval` — 에이전트 가입 승인/거절 알림
  - [ ] `notification.delivery` — 배송 관련 알림 (신규)
- [ ] **Kafka Consumer** — 배송 이벤트를 직접 구독하여 알림 발송
  - [ ] `DeliveryGroupCreatedEvent` → **agent**에게 "새 주문이 접수되었습니다. 발송 준비해주세요" 알림
  - [ ] `DeliveryShippedEvent` → **user**에게 "상품이 발송되었습니다 (운송장: {trackingNumber})" 알림
  - [ ] `DeliveryCompletedEvent` → **user**에게 "배송이 완료되었습니다. 구매 확정해주세요" 알림
  - [ ] `ReturnRequestedEvent` → **agent**에게 "반품 요청이 들어왔습니다" 알림
- [ ] **알림 전송 어댑터**
  - [ ] 이메일 — `nodemailer` + 내부 SMTP 서버 (오프라인)
  - [ ] 푸시 알림 인터페이스 (내부망 푸시 서버 연동)
- [ ] **역할별 알림 내용 분기**
  - [ ] `user`: 주문 확인, 결제 영수증, 발송 알림(운송장 번호 포함), 배송 완료, 반품 처리 결과
  - [ ] `agent`: 새 주문 접수(발송 요청), 반품 요청, 정산 완료, 상품 승인/거절, 재고 부족 경고
  - [ ] `admin`/`super-admin`: 에이전트 가입 신청, 배송 지연 경고, 시스템 경고
- [ ] **알림 이력** PostgreSQL 저장
- [ ] **DLQ 패턴** — 실패 메시지 재처리

---

## Phase 15: 어드민 대시보드 서비스 (`apps/admin-service`)

> `admin` 및 `super-admin` 전용 백엔드 서비스. 운영에 필요한 통계, 감사, 관리 API를 제공한다.

- [ ] Express.js + TypeScript 초기화
- [ ] **모든 라우트에 `admin+` RBAC 미들웨어 적용**

- [ ] **사용자 관리 API**
  - [ ] 전체 사용자 목록/검색/필터 (역할별)
  - [ ] 사용자 상태 변경 (활성/정지)
  - [ ] 에이전트 가입 신청 목록 및 승인/거절

- [ ] **상품 모더레이션 API**
  - [ ] 미승인 상품 목록
  - [ ] 상품 승인/거절/강제 삭제

- [ ] **주문/배송 관리 API**
  - [ ] 전체 주문 조회/필터 (날짜, 상태, 에이전트별)
  - [ ] 주문 상태 강제 변경
  - [ ] 환불 처리
  - [ ] 전체 배송 그룹 현황 조회 (PREPARING/SHIPPED/IN_TRANSIT 지연 건 집계)
  - [ ] 배송 지연 리포트 (PREPARING 상태 N일 초과 건)
  - [ ] 반품/환불 현황 조회

- [ ] **통계/분석 API**
  - [ ] 일별/월별 매출 통계
  - [ ] 에이전트별 판매 순위
  - [ ] 재고 부족 상품 리포트
  - [ ] 회원 가입 통계

- [ ] **감사 로그 API** — **`super-admin` 전용**
  - [ ] 어드민 액션 이력 조회
  - [ ] 시스템 이벤트 로그 조회

- [ ] **에이전트 정산 관리 API** — **`super-admin` 전용**
  - [ ] 정산 내역 조회/처리
  - [ ] 수수료율 설정

---

## Phase 16: CQRS Read DB 동기화 워커 (`apps/sync-worker`)

- [ ] Node.js + TypeScript 워커 프로세스
- [ ] **Kafka Consumer 그룹**
  - [ ] `ProductCreatedEvent`/`ProductUpdatedEvent` → MongoDB + OpenSearch 업데이트
  - [ ] `OrderCreatedEvent`/`OrderPaidEvent` → MongoDB 주문 히스토리 upsert
  - [ ] `UserRegisteredEvent` → MongoDB 사용자 문서 동기화
  - [ ] `AgentApprovedEvent` → OpenSearch에 에이전트 정보 인덱싱
  - [ ] `DeliveryGroupCreatedEvent`/`DeliveryShippedEvent`/`DeliveryCompletedEvent` → MongoDB 배송 상태 동기화 (구매자 배송 추적 화면용)
- [ ] **Backpressure 제어** — `p-limit` 기반
- [ ] **Bulk Insert 최적화** — 배치 처리 후 Bulk API 호출

---

## Phase 17: 모니터링 & 가관측성 (오프라인 스택)

> 온라인 SaaS 모니터링 툴(Datadog, New Relic 등) 미사용 — 로컬 설치 오픈소스만 사용

- [ ] **Prometheus** — 직접 설치, 메트릭 수집
  - [ ] 각 서비스 `/metrics` 엔드포인트 (`prom-client`)
  - [ ] 역할별 API 호출 통계 메트릭 추가
  - [ ] 에이전트별 주문 처리량 메트릭
  - [ ] 재고 차감 실패율, 캐시 히트율
- [ ] **Grafana** — 직접 설치, 대시보드 구성
  - [ ] 서비스별 API 레이턴시 (P50, P95, P99)
  - [ ] Kafka Consumer Lag
  - [ ] Redis 메모리 & 히트율
  - [ ] 역할별 API 호출 분포 대시보드
- [ ] **OpenTelemetry** 분산 트레이싱 — Jaeger 직접 설치
  - [ ] `@opentelemetry/sdk-node` 각 서비스 설치
  - [ ] `x-trace-id`, `x-user-role` 헤더 전파
- [ ] **구조화 로그** — Pino → 로컬 파일 저장
  - [ ] 로그 로테이션 설정 (`logrotate`)
  - [ ] 감사 로그 파일 별도 저장 (어드민/슈퍼어드민 액션)

---

## Phase 18: 테스트

- [ ] **단위 테스트** (Jest)
  - [ ] RBAC 미들웨어 — 각 역할별 접근 허용/거부 테스트
  - [ ] 소유권 검증 미들웨어 테스트 (agent가 타인 상품 수정 시 403)
  - [ ] Command/Query 핸들러 단위 테스트
  - [ ] Redis 분산 락, SAGA 상태 머신 단위 테스트
- [ ] **통합 테스트** (Jest + 실제 DB 연결)
  - [ ] PostgreSQL 실제 연동 (오프라인 로컬 설치 대상)
  - [ ] Redis 실제 연동 — 분산 락 동시성 테스트
  - [ ] Kafka 실제 메시지 발행/수신 테스트
  - [ ] **에이전트 가입 → 승인 → 상품 등록 → 구매 → 배송 그룹 생성 → 운송장 등록 → 수령 확인 → 정산** 전체 E2E 시나리오
- [ ] **역할 기반 접근 제어 통합 테스트**
  - [ ] `user` 토큰으로 `/admin/*` 접근 시 403 확인
  - [ ] `agent` 토큰으로 타 에이전트 상품 수정 시 403 확인
  - [ ] 미승인 에이전트가 상품 등록 시 403 확인
- [ ] **부하 테스트** (k6 — 오프라인 실행 가능)
  - [ ] 10만 동시 접속 시뮬레이션
  - [ ] 타임세일 시나리오 (초과 판매 검증)

---

## Phase 19: 오프라인 배포 준비

- [ ] **PM2 `ecosystem.config.js`** — 전체 서비스 Cluster 모드 설정
  ```
  api-gateway:          instances: max (CPU 코어 수)
  auth-service:         instances: 4
  product-service:      instances: 4
  order-service:        instances: 2
  payment-service:      instances: 2
  inventory-service:    instances: 2
  delivery-service:     instances: 2
  cart-service:         instances: 4
  search-service:       instances: 2
  admin-service:        instances: 2
  notification-service: instances: 1
  sync-worker:          instances: 2 (fork 모드)
  ```
- [ ] **systemd 유닛 파일** — `pm2-ecommerce.service` 서버 재부팅 자동 시작
- [ ] **Nginx 프로덕션 설정** — TLS 자체 서명 인증서, Upstream, Rate Limiting
- [ ] **데이터베이스 마이그레이션** 스크립트 (`node-pg-migrate`)
- [ ] **그레이스풀 셧다운** — 각 서비스 `SIGTERM` 처리
- [ ] **오프라인 의존성 패키징**
  - [ ] `pnpm pack` + Verdaccio Private NPM 구성, 또는
  - [ ] `node_modules` 타르볼 번들 → 타겟 서버 전송
- [ ] **초기화 스크립트 통합** (`scripts/init-all.sh`)
  - [ ] PostgreSQL 스키마 초기화
  - [ ] Redis Cluster 초기화
  - [ ] Kafka 토픽 생성
  - [ ] RabbitMQ Exchange/Queue 선언
  - [ ] OpenSearch 인덱스 매핑 생성
  - [ ] **슈퍼어드민 계정 시드** (`scripts/seed-super-admin.sh`)
- [ ] **환경 변수 관리** — `.env.production` 파일 보안 관리 (파일 권한 600)

---

## 서비스별 우선순위 구현 순서

```
1단계 (기반):   공유 패키지(shared, rbac, errors) → RBAC 미들웨어 검증
2단계 (인증):   Auth Service (4 역할 + 에이전트 승인 플로우) → API Gateway
3단계 (상품):   Product Service (에이전트 소유권 + 관리자 승인) → Sync Worker
4단계 (구매):   Cart → Inventory (분산 락) → Order (SAGA) → Payment
5단계 (배송):   Delivery Service (에이전트별 배송 그룹 + 운송장 + 반품)
6단계 (운영):   Admin Service → Search → Notification (배송 알림 포함)
7단계 (모니터): Prometheus + Grafana + OpenTelemetry (Jaeger)
8단계 (배포):   테스트 → PM2 설정 → systemd → Nginx → 오프라인 패키징
```

---

## 기술 스택 최종 매핑 (오프라인 전용)

| 레이어 | 기술 | 라이브러리/도구 | 설치 방식 |
|--------|------|----------------|----------|
| 프레임워크 | Node.js 22 + TypeScript + Express.js | `express`, `tsx` | 오프라인 번들 |
| RBAC | 자체 구현 | `packages/rbac` | 내부 패키지 |
| 대용량 이벤트 스트리밍 | Apache Kafka 3.8 (KRaft) | `kafkajs` | 서버 직접 설치 |
| 복잡한 메시지 라우팅 | RabbitMQ 3.13 | `amqplib`, `amqp-connection-manager` | 서버 직접 설치 |
| 캐시 + 세션 + 분산 락 | Redis 7 Cluster | `ioredis` | 서버 직접 설치 |
| Write DB | PostgreSQL 16 | `pg`, `node-pg-migrate` | 서버 직접 설치 |
| Read DB | MongoDB 7 | `mongoose` | 서버 직접 설치 |
| 풀텍스트 검색 | OpenSearch 2 (Apache 2.0) | `@opensearch-project/opensearch` | 서버 직접 설치 |
| 로드 밸런서 | Nginx 1.25 | — | 서버 직접 설치 |
| 프로세스 매니저 | PM2 Cluster | `pm2` | 오프라인 번들 |
| 서비스 자동시작 | systemd | — | OS 기본 |
| Circuit Breaker | — | `opossum` | 오프라인 번들 |
| 로깅 | — | `pino` | 오프라인 번들 |
| 메트릭 | Prometheus + Grafana | `prom-client` | 서버 직접 설치 |
| 분산 트레이싱 | OpenTelemetry + Jaeger | `@opentelemetry/sdk-node` | 서버 직접 설치 |
| 테스트 | Jest + k6 | — | 오프라인 번들 |
| ~~Docker~~ | ~~미사용~~ | — | — |
| ~~Kubernetes~~ | ~~미사용~~ | — | — |

---

## 서비스 포트 맵 (오프라인 전용)

| 서비스 | 포트 | 비고 |
|--------|------|------|
| Nginx | 80, 443 | 외부 진입점 |
| api-gateway | 3000 | |
| auth-service | 3001 | |
| product-service | 3002 | |
| order-service | 3003 | |
| payment-service | 3004 | |
| cart-service | 3005 | |
| search-service | 3006 | |
| inventory-service | 3007 | |
| admin-service | 3008 | admin/super-admin 전용 |
| notification-service | 3009 | |
| delivery-service | 3010 | **신규** |
| PostgreSQL | 5432 | |
| MongoDB | 27017 | |
| Redis Cluster | 7001~7006 | 3 Master + 3 Replica |
| Kafka | 9092 | KRaft 모드 |
| RabbitMQ | 5672, 15672 | 15672: Management UI |
| OpenSearch | 9200 | |
| Prometheus | 9090 | |
| Grafana | 3030 | |
| Jaeger | 16686 | |
