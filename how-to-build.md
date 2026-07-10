# eCommerce 백엔드 서버 구축 가이드
## 동시 접속자 10만 명 | Node.js + TypeScript + MSA + CQRS + Kafka + RabbitMQ + Redis + OpenSearch

---

## 목차
1. [전체 아키텍처 개요](#1-전체-아키텍처-개요)
2. [프로젝트 구조 (모노레포)](#2-프로젝트-구조-모노레포)
3. [인프라 구성 (Docker Compose)](#3-인프라-구성-docker-compose)
4. [공유 패키지 구축](#4-공유-패키지-구축)
5. [API Gateway 구축](#5-api-gateway-구축)
6. [회원/인증 서비스 구축](#6-회원인증-서비스-구축)
7. [상품 카탈로그 서비스 구축 (CQRS)](#7-상품-카탈로그-서비스-구축-cqrs)
8. [재고 서비스 구축 (분산 락)](#8-재고-서비스-구축-분산-락)
9. [주문 서비스 구축 (SAGA 패턴)](#9-주문-서비스-구축-saga-패턴)
10. [검색 서비스 구축 (OpenSearch)](#10-검색-서비스-구축-opensearch)
11. [장바구니 서비스 구축 (Redis)](#11-장바구니-서비스-구축-redis)
12. [Kafka 이벤트 아키텍처 설계](#12-kafka-이벤트-아키텍처-설계)
13. [모니터링 & 가관측성](#13-모니터링--가관측성)
14. [오프라인 환경 배포 전략](#14-오프라인-환경-배포-전략)

---

## 1. 전체 아키텍처 개요

```
[클라이언트 (앱/웹)]
        │
        ▼
[Nginx 로드 밸런서]  ← Rate Limiting, TLS 종료
        │
        ▼
[API Gateway Service]  ← JWT 검증, 라우팅, Circuit Breaker
        │
   ┌────┼────────────────────────────────┐
   ▼    ▼                                ▼
[Auth] [Product]  [Cart] [Order] [Payment] [Search] [Inventory]
   │      │         │       │        │        │           │
   └──────┴─────────┴───────┴────────┴────────┴───────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
          [Kafka]      [RabbitMQ]      [Redis Cluster]
              │             │              │
        ┌─────┘             │              └──── 세션/캐시/분산락/장바구니
        ▼                   ▼
  [Sync Worker]     [Notification Service]
        │
   ┌────┼────────────┐
   ▼    ▼            ▼
[MongoDB] [OpenSearch] [PostgreSQL (Replica)]
                              ▲
                       [PostgreSQL (Primary)] ← Write만 담당
```

### 핵심 설계 원칙

**① CQRS (명령/조회 책임 분리)**
- **Command (쓰기)**: PostgreSQL Primary — 모든 데이터 변경은 이 DB에만 기록
- **Query (읽기)**: MongoDB + OpenSearch + Redis — 10만 동시 조회는 이 경로로만 처리
- 두 DB는 Kafka 이벤트를 통해 비동기로 동기화됨

**② 이벤트 기반 아키텍처 (EDA)**
- 서비스 간 직접 HTTP 호출 최소화
- 모든 상태 변경은 Kafka 이벤트를 통해 전파
- 서비스가 독립적으로 장애나도 전체 시스템은 유지됨

**③ 무상태(Stateless) 서버**
- Express 서버 인스턴스는 일체의 상태를 메모리에 저장하지 않음
- 세션, 장바구니, 분산 락 — 모두 Redis에 저장
- 어느 인스턴스로 요청이 가도 동일하게 처리 가능 → PM2 Cluster, 수평 확장 가능

---

## 2. 프로젝트 구조 (모노레포)

### 모노레포를 쓰는 이유
10만 명 규모의 MSA는 서비스가 6~10개 이상으로 나뉜다. 각 서비스가 공통 타입, 에러 클래스, Kafka 클라이언트 코드를 따로 복사해서 관리하면 유지보수 지옥이 된다. 모노레포는 공유 코드를 한 곳에서 관리하면서도 각 서비스를 독립 배포 가능하게 만든다.

```bash
# pnpm + Turborepo 기반 모노레포 초기화
npm install -g pnpm
pnpm init
pnpm add -D turbo -w
```

```
ecommerce-backend/
├── apps/
│   ├── api-gateway/          # 진입점, JWT/라우팅/Circuit Breaker
│   ├── auth-service/         # 회원가입/로그인/JWT 발급
│   ├── product-service/      # 상품 등록/수정/조회 (CQRS)
│   ├── order-service/        # 주문 생성/취소 (SAGA 패턴)
│   ├── payment-service/      # 결제 처리 (멱등성 보장)
│   ├── inventory-service/    # 재고 관리 (분산 락)
│   ├── cart-service/         # 장바구니 (Redis Hash)
│   ├── search-service/       # 상품 검색 (OpenSearch)
│   ├── notification-service/ # 이메일/푸시 알림 (RabbitMQ)
│   └── sync-worker/          # CQRS Read DB 동기화 워커 (Kafka Consumer)
│
├── packages/
│   ├── shared/               # 공통 타입, DTO, 이벤트 페이로드 타입
│   ├── kafka-client/         # kafkajs 래퍼 (Producer/Consumer)
│   ├── rabbitmq-client/      # amqplib 래퍼
│   ├── redis-client/         # ioredis 래퍼 + 분산 락 유틸
│   ├── logger/               # Pino 구조화 로거
│   └── errors/               # 공통 에러 클래스 (AppError, NotFoundError 등)
│
├── infra/
│   ├── docker-compose.yml    # 전체 인프라 로컬 실행
│   ├── nginx/                # Nginx 설정
│   ├── postgres/             # DB 초기화 SQL
│   ├── kafka/                # 토픽 설정
│   └── opensearch/           # 인덱스 매핑
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev":   { "cache": false, "persistent": true },
    "test":  { "dependsOn": ["^build"] }
  }
}
```

### 각 서비스의 Clean Architecture 구조
서비스 하나를 예시로 보면:

```
apps/order-service/
├── src/
│   ├── domain/               # 순수 비즈니스 로직 (프레임워크 무관)
│   │   ├── entities/
│   │   │   └── Order.ts      # Order 엔티티 + 상태 머신
│   │   ├── value-objects/
│   │   │   └── OrderId.ts
│   │   └── repositories/
│   │       └── IOrderRepository.ts  # 인터페이스만 정의
│   │
│   ├── application/          # 유즈케이스 (Command/Query 핸들러)
│   │   ├── commands/
│   │   │   ├── CreateOrderCommand.ts
│   │   │   └── CreateOrderHandler.ts
│   │   └── queries/
│   │       ├── GetOrderQuery.ts
│   │       └── GetOrderHandler.ts
│   │
│   ├── infrastructure/       # 외부 의존성 구현체
│   │   ├── repositories/
│   │   │   └── PgOrderRepository.ts  # PostgreSQL 구현
│   │   ├── kafka/
│   │   │   ├── producers/
│   │   │   └── consumers/
│   │   └── redis/
│   │
│   └── presentation/         # Express 라우터/컨트롤러/미들웨어
│       ├── routes/
│       ├── controllers/
│       └── middlewares/
│
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 3. 인프라 구성 (Docker Compose)

로컬 개발 환경에서 전체 인프라를 한 번에 띄우는 설정이다. 실제 운영 시에는 각 컴포넌트를 별도 서버에 배포한다.

```yaml
# infra/docker-compose.yml
version: '3.9'

services:
  # ── PostgreSQL (Write DB) ──────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ecommerce
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: ecommerce
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecommerce"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ── MongoDB (Read DB - 상품 카탈로그/주문 히스토리) ────────────
  mongodb:
    image: mongo:7
    environment:
      MONGO_INITDB_ROOT_USERNAME: ecommerce
      MONGO_INITDB_ROOT_PASSWORD: secret
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  # ── Redis Cluster (캐시 + 세션 + 분산 락 + 장바구니) ──────────
  redis-1:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-config-file nodes.conf --cluster-node-timeout 5000 --appendonly yes
    ports:
      - "7001:6379"
    volumes:
      - redis1_data:/data

  redis-2:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-config-file nodes.conf --cluster-node-timeout 5000 --appendonly yes
    ports:
      - "7002:6379"
    volumes:
      - redis2_data:/data

  redis-3:
    image: redis:7-alpine
    command: redis-server --cluster-enabled yes --cluster-config-file nodes.conf --cluster-node-timeout 5000 --appendonly yes
    ports:
      - "7003:6379"
    volumes:
      - redis3_data:/data

  # ── Kafka (KRaft 모드, Zookeeper 불필요) ──────────────────────
  kafka:
    image: apache/kafka:3.8.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_NUM_PARTITIONS: 6
      KAFKA_DEFAULT_REPLICATION_FACTOR: 1
    ports:
      - "9092:9092"
    volumes:
      - kafka_data:/var/lib/kafka/data

  # ── RabbitMQ (복잡한 라우팅 메시지 - 알림/정산) ───────────────
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ecommerce
      RABBITMQ_DEFAULT_PASS: secret
    ports:
      - "5672:5672"
      - "15672:15672"   # Management UI
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

  # ── OpenSearch (검색 + CQRS Read DB) ──────────────────────────
  opensearch:
    image: opensearchproject/opensearch:2.13.0
    environment:
      - discovery.type=single-node
      - OPENSEARCH_INITIAL_ADMIN_PASSWORD=Admin@1234!
      - plugins.security.disabled=true   # 로컬 개발용, 운영에선 활성화
    ports:
      - "9200:9200"
    volumes:
      - opensearch_data:/usr/share/opensearch/data

  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:2.13.0
    environment:
      OPENSEARCH_HOSTS: '["http://opensearch:9200"]'
    ports:
      - "5601:5601"

  # ── Nginx (내부 로드 밸런서) ────────────────────────────────────
  nginx:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - kafka
      - postgres

volumes:
  postgres_data:
  mongo_data:
  redis1_data:
  redis2_data:
  redis3_data:
  kafka_data:
  rabbitmq_data:
  opensearch_data:
```

---

## 4. 공유 패키지 구축

### 4-1. 공통 에러 클래스 (`packages/errors`)

```typescript
// packages/errors/src/AppError.ts
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly isOperational = true,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource}을(를) 찾을 수 없습니다`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('인증이 필요합니다', 401, 'UNAUTHORIZED');
  }
}

export class InsufficientInventoryError extends AppError {
  constructor() {
    super('재고가 부족합니다', 400, 'INSUFFICIENT_INVENTORY');
  }
}
```

### 4-2. Kafka 클라이언트 (`packages/kafka-client`)

```typescript
// packages/kafka-client/src/producer.ts
import { Kafka, Producer, ProducerRecord } from 'kafkajs';

export class KafkaProducer {
  private producer: Producer;

  constructor(private readonly kafka: Kafka) {
    this.producer = kafka.producer({
      // 메시지 유실 방지: 모든 브로커에 쓰기 확인
      acks: -1,
      // 압축으로 네트워크 부하 절감
      compression: 1, // GZIP
    });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async publish(topic: string, key: string, payload: object): Promise<void> {
    const record: ProducerRecord = {
      topic,
      messages: [{
        key,
        value: JSON.stringify(payload),
        timestamp: Date.now().toString(),
      }],
    };
    await this.producer.send(record);
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }
}
```

```typescript
// packages/kafka-client/src/consumer.ts
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';

type MessageHandler = (payload: EachMessagePayload) => Promise<void>;

export class KafkaConsumer {
  private consumer: Consumer;

  constructor(kafka: Kafka, groupId: string) {
    this.consumer = kafka.consumer({
      groupId,
      // 하트비트 간격 — Node.js 이벤트 루프 지연으로 인한 그룹 제외 방지
      heartbeatInterval: 3000,
      sessionTimeout: 30000,
    });
  }

  async subscribe(topics: string[], handler: MessageHandler): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics, fromBeginning: false });

    await this.consumer.run({
      // 한 번에 가져오는 메시지 수 제한 — Backpressure 제어
      partitionsConsumedConcurrently: 3,
      eachMessage: async (payload) => {
        try {
          await handler(payload);
        } catch (err) {
          // DLQ로 보내는 로직 추가 가능
          console.error('메시지 처리 실패:', err);
        }
      },
    });
  }
}
```

### 4-3. Redis 클라이언트 & 분산 락 (`packages/redis-client`)

```typescript
// packages/redis-client/src/distributed-lock.ts
import { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';

/**
 * Redis Lua Script 기반 분산 락
 * 원자적 실행을 보장하여 초과 판매(Overselling)를 방지한다.
 * 재고 차감 시 이 락을 통해 10만 명이 동시에 요청해도
 * 단 하나의 프로세스만 재고를 차감할 수 있음을 보장한다.
 */
export class DistributedLock {
  // 락 획득: 키가 없을 때만 SET (원자적 연산)
  private static readonly ACQUIRE_SCRIPT = `
    if redis.call('exists', KEYS[1]) == 0 then
      redis.call('set', KEYS[1], ARGV[1], 'px', ARGV[2])
      return 1
    end
    return 0
  `;

  // 락 해제: 내 락인지 확인 후 삭제 (원자적 연산)
  private static readonly RELEASE_SCRIPT = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    end
    return 0
  `;

  constructor(private readonly redis: Redis) {}

  async acquire(
    resource: string,
    ttlMs = 5000,
    retries = 3,
  ): Promise<string | null> {
    const lockKey = `lock:${resource}`;
    const lockValue = uuid();

    for (let i = 0; i < retries; i++) {
      const result = await this.redis.eval(
        DistributedLock.ACQUIRE_SCRIPT,
        1,
        lockKey,
        lockValue,
        ttlMs.toString(),
      );
      if (result === 1) return lockValue;

      // 락 획득 실패 시 짧게 대기 후 재시도
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
    return null;
  }

  async release(resource: string, lockValue: string): Promise<void> {
    const lockKey = `lock:${resource}`;
    await this.redis.eval(
      DistributedLock.RELEASE_SCRIPT,
      1,
      lockKey,
      lockValue,
    );
  }

  async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    ttlMs = 5000,
  ): Promise<T> {
    const lockValue = await this.acquire(resource, ttlMs);
    if (!lockValue) {
      throw new Error(`분산 락 획득 실패: ${resource}`);
    }
    try {
      return await fn();
    } finally {
      await this.release(resource, lockValue);
    }
  }
}
```

---

## 5. API Gateway 구축

API Gateway는 모든 외부 요청의 단일 진입점이다. JWT 검증, Rate Limiting, 내부 서비스 라우팅, Circuit Breaker만 담당하고 그 외 비즈니스 로직은 절대 넣지 않는다.

```typescript
// apps/api-gateway/src/app.ts
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { jwtMiddleware } from './middlewares/jwt.middleware';
import { errorHandler } from './middlewares/error.middleware';
import { requestIdMiddleware } from './middlewares/request-id.middleware';
import { circuitBreakerMiddleware } from './middlewares/circuit-breaker.middleware';

const app = express();

// 보안 헤더
app.use(helmet());

// 요청 추적 ID 생성 (분산 트레이싱용)
app.use(requestIdMiddleware);

// Rate Limiting — Redis 스토어 사용으로 멀티 인스턴스 간 공유
const limiter = rateLimit({
  windowMs: 60 * 1000,      // 1분
  max: 100,                  // IP당 분당 100 요청
  standardHeaders: true,
  legacyHeaders: false,
  // 실제로는 RedisStore를 써야 멀티 인스턴스 간 카운터가 공유됨
  // store: new RedisStore({ client: redisClient }),
});
app.use(limiter);

// 공개 엔드포인트 — JWT 검증 없이 통과
app.use('/api/auth', createProxyMiddleware({
  target: 'http://auth-service:3001',
  changeOrigin: true,
}));

app.use('/api/products', createProxyMiddleware({
  target: 'http://product-service:3002',
  changeOrigin: true,
}));

app.use('/api/search', createProxyMiddleware({
  target: 'http://search-service:3006',
  changeOrigin: true,
}));

// JWT 인증이 필요한 엔드포인트
app.use('/api/orders', jwtMiddleware, circuitBreakerMiddleware('order-service'), createProxyMiddleware({
  target: 'http://order-service:3003',
  changeOrigin: true,
}));

app.use('/api/payments', jwtMiddleware, circuitBreakerMiddleware('payment-service'), createProxyMiddleware({
  target: 'http://payment-service:3004',
  changeOrigin: true,
}));

app.use('/api/cart', jwtMiddleware, createProxyMiddleware({
  target: 'http://cart-service:3005',
  changeOrigin: true,
}));

app.use('/api/inventory', jwtMiddleware, createProxyMiddleware({
  target: 'http://inventory-service:3007',
  changeOrigin: true,
}));

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// 전역 에러 핸들러
app.use(errorHandler);

export default app;
```

### Circuit Breaker 미들웨어

결제 대행사(PG사) 서버가 죽었을 때 결제 서비스만 빠르게 차단하고, 상품 조회나 장바구니 기능은 정상 동작을 유지한다. `opossum` 라이브러리가 이를 담당한다.

```typescript
// apps/api-gateway/src/middlewares/circuit-breaker.middleware.ts
import CircuitBreaker from 'opossum';
import { Request, Response, NextFunction } from 'express';

const breakers = new Map<string, CircuitBreaker>();

function getBreaker(serviceName: string): CircuitBreaker {
  if (!breakers.has(serviceName)) {
    const breaker = new CircuitBreaker(async () => {}, {
      timeout: 3000,           // 3초 초과 시 실패 처리
      errorThresholdPercentage: 50,  // 실패율 50% 초과 시 차단
      resetTimeout: 30000,     // 30초 후 반개방(half-open) 상태로 전환
    });

    breaker.on('open', () => {
      console.warn(`Circuit Breaker OPEN: ${serviceName} 서비스 차단됨`);
    });
    breaker.on('halfOpen', () => {
      console.info(`Circuit Breaker HALF-OPEN: ${serviceName} 재시도 중`);
    });
    breaker.on('close', () => {
      console.info(`Circuit Breaker CLOSED: ${serviceName} 서비스 복구됨`);
    });

    breakers.set(serviceName, breaker);
  }
  return breakers.get(serviceName)!;
}

export function circuitBreakerMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const breaker = getBreaker(serviceName);
    if (breaker.opened) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: `${serviceName} 서비스가 일시적으로 이용 불가합니다. 잠시 후 다시 시도해주세요.`,
      });
    }
    next();
  };
}
```

---

## 6. 회원/인증 서비스 구축

### JWT + Redis 세션 아키텍처

10만 명의 세션을 서버 메모리에 저장하면 서버를 늘릴 수 없다. 모든 세션 정보는 Redis에 저장하여 어느 인스턴스가 요청을 받아도 동일하게 처리한다.

```typescript
// apps/auth-service/src/application/commands/LoginHandler.ts
import { Redis } from 'ioredis';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { IUserRepository } from '../../domain/repositories/IUserRepository';
import { UnauthorizedError } from '@ecommerce/errors';

interface LoginCommand {
  email: string;
  password: string;
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

export class LoginHandler {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly redis: Redis,
    private readonly jwtSecret: string,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    // 1. 사용자 조회 (이메일로)
    const user = await this.userRepository.findByEmail(command.email);
    if (!user) throw new UnauthorizedError();

    // 2. 비밀번호 검증
    const isValid = await bcrypt.compare(command.password, user.passwordHash);
    if (!isValid) throw new UnauthorizedError();

    // 3. JWT 발급
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      this.jwtSecret,
      { expiresIn: '15m' },
    );
    const refreshToken = jwt.sign(
      { sub: user.id },
      this.jwtSecret,
      { expiresIn: '7d' },
    );

    // 4. 리프레시 토큰을 Redis에 저장 (7일 TTL)
    // Key: refresh:{userId} — 로그아웃 시 이 키를 삭제하면 토큰 무효화
    await this.redis.set(
      `refresh:${user.id}`,
      refreshToken,
      'EX',
      7 * 24 * 60 * 60,
    );

    // 5. 사용자 세션 정보를 Redis에 캐싱 (JWT 검증 시 DB 조회 없이 사용)
    await this.redis.set(
      `session:${user.id}`,
      JSON.stringify({ id: user.id, email: user.email, role: user.role }),
      'EX',
      15 * 60, // 액세스 토큰과 동일한 TTL
    );

    return { accessToken, refreshToken };
  }
}
```

---

## 7. 상품 카탈로그 서비스 구축 (CQRS)

CQRS의 핵심: **쓰기(Command)와 읽기(Query)를 완전히 다른 경로로 처리한다.**

### Command 처리 (상품 등록/수정)
```typescript
// apps/product-service/src/application/commands/CreateProductHandler.ts
import { IProductRepository } from '../../domain/repositories/IProductRepository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { Product } from '../../domain/entities/Product';

interface CreateProductCommand {
  name: string;
  description: string;
  price: number;
  categoryId: string;
  stock: number;
  sellerId: string;
}

export class CreateProductHandler {
  constructor(
    private readonly productRepository: IProductRepository, // PostgreSQL
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(command: CreateProductCommand): Promise<string> {
    // 1. 도메인 엔티티 생성
    const product = Product.create(command);

    // 2. Write DB (PostgreSQL)에 저장
    await this.productRepository.save(product);

    // 3. Kafka에 이벤트 발행
    // Read DB(MongoDB, OpenSearch)의 동기화는 Sync Worker가 담당
    await this.kafkaProducer.publish(
      'product.events',
      product.id,
      {
        type: 'ProductCreated',
        payload: {
          productId: product.id,
          name: product.name,
          description: product.description,
          price: product.price,
          categoryId: product.categoryId,
          timestamp: new Date().toISOString(),
        },
      },
    );

    // 4. API Gateway에는 즉시 응답 — Read DB 동기화는 비동기로 처리됨
    return product.id;
  }
}
```

### Query 처리 (상품 조회) — Cache-Aside 패턴

```typescript
// apps/product-service/src/application/queries/GetProductHandler.ts
import { Redis } from 'ioredis';
import { IProductReadRepository } from '../../domain/repositories/IProductReadRepository';
import { NotFoundError } from '@ecommerce/errors';

interface GetProductQuery {
  productId: string;
}

export class GetProductHandler {
  private readonly CACHE_TTL = 3600; // 1시간

  constructor(
    private readonly productReadRepo: IProductReadRepository, // MongoDB
    private readonly redis: Redis,
  ) {}

  async execute(query: GetProductQuery): Promise<object> {
    const cacheKey = `product:${query.productId}`;

    // 1단계: Redis 캐시 확인 — 히트 시 즉시 반환 (1~2ms)
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2단계: Read DB (MongoDB) 조회
    const product = await this.productReadRepo.findById(query.productId);
    if (!product) throw new NotFoundError('상품');

    // 3단계: 조회 결과를 Redis에 캐싱
    await this.redis.set(cacheKey, JSON.stringify(product), 'EX', this.CACHE_TTL);

    return product;
  }
}
```

---

## 8. 재고 서비스 구축 (분산 락)

타임세일 시 100개 남은 재고를 10만 명이 동시에 주문하는 상황이다. DB Lock으로는 10만 명을 감당할 수 없다. Redis 메모리 단에서 원자적으로 재고를 선차감하고, 실제 DB 반영은 Kafka를 통해 비동기로 처리한다.

```typescript
// apps/inventory-service/src/application/commands/ReserveInventoryHandler.ts
import { Redis } from 'ioredis';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { InsufficientInventoryError } from '@ecommerce/errors';

// Lua Script: 원자적 재고 차감
// 재고가 충분할 때만 차감하고 결과를 반환한다.
// Lua Script는 Redis에서 단일 명령으로 실행되어 경쟁 조건(Race Condition)이 없다.
const RESERVE_STOCK_SCRIPT = `
  local current = tonumber(redis.call('get', KEYS[1]))
  if current == nil then
    return -1
  end
  if current < tonumber(ARGV[1]) then
    return -2
  end
  redis.call('decrby', KEYS[1], ARGV[1])
  return redis.call('get', KEYS[1])
`;

interface ReserveInventoryCommand {
  orderId: string;
  productId: string;
  quantity: number;
}

export class ReserveInventoryHandler {
  constructor(
    private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(command: ReserveInventoryCommand): Promise<void> {
    const stockKey = `stock:${command.productId}`;

    // Redis Lua Script로 원자적 재고 차감 시도
    const result = await this.redis.eval(
      RESERVE_STOCK_SCRIPT,
      1,
      stockKey,
      command.quantity.toString(),
    ) as number;

    if (result === -1) {
      throw new Error('재고 정보가 없습니다. 캐시 워밍이 필요합니다.');
    }

    if (result === -2) {
      // 재고 부족 이벤트 발행 → 주문 서비스가 주문을 실패 처리
      await this.kafkaProducer.publish(
        'inventory.events',
        command.productId,
        {
          type: 'InventoryInsufficient',
          payload: { orderId: command.orderId, productId: command.productId },
        },
      );
      throw new InsufficientInventoryError();
    }

    // 재고 차감 성공 → 이벤트 발행
    // 실제 PostgreSQL DB 반영은 Sync Worker가 이 이벤트를 소비해서 처리
    await this.kafkaProducer.publish(
      'inventory.events',
      command.productId,
      {
        type: 'InventoryReserved',
        payload: {
          orderId: command.orderId,
          productId: command.productId,
          quantity: command.quantity,
          remainingStock: result,
        },
      },
    );
  }
}
```

---

## 9. 주문 서비스 구축 (SAGA 패턴)

### SAGA 패턴이란?
여러 마이크로서비스에 걸친 분산 트랜잭션을 처리하는 패턴이다. 하나의 단계가 실패하면 이전 단계들을 취소하는 **보상 트랜잭션(Compensating Transaction)**을 실행한다.

```
주문 생성 SAGA:
1. 주문 저장 (PENDING) ── 실패 시 → 그냥 종료 (DB에 아무것도 없음)
2. 재고 예약 요청     ── 실패 시 → 보상: 주문 CANCELLED 처리
3. 결제 처리 요청     ── 실패 시 → 보상: 재고 복구 이벤트 발행 + 주문 CANCELLED
4. 주문 CONFIRMED     ── 성공 시 종료
```

```typescript
// apps/order-service/src/application/commands/CreateOrderHandler.ts
import { IOrderRepository } from '../../domain/repositories/IOrderRepository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { Order } from '../../domain/entities/Order';
import { OrderStatus } from '../../domain/value-objects/OrderStatus';

interface CreateOrderCommand {
  userId: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
}

export class CreateOrderHandler {
  constructor(
    private readonly orderRepository: IOrderRepository, // PostgreSQL
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(command: CreateOrderCommand): Promise<string> {
    // 1. 주문 생성 (상태: PENDING)
    const order = Order.create({
      userId: command.userId,
      items: command.items,
      status: OrderStatus.PENDING,
    });

    // 2. Write DB (PostgreSQL)에 저장
    await this.orderRepository.save(order);

    // 3. Kafka에 OrderCreated 이벤트 발행 → 재고 서비스가 Consume하여 재고 예약 처리
    // 이 시점에서 유저에게 "주문이 접수되었습니다"를 응답하고 비동기로 처리
    await this.kafkaProducer.publish(
      'order.events',
      order.id,
      {
        type: 'OrderCreated',
        payload: {
          orderId: order.id,
          userId: command.userId,
          items: command.items,
          totalAmount: order.totalAmount,
          timestamp: new Date().toISOString(),
        },
      },
    );

    return order.id;
  }
}
```

```typescript
// apps/order-service/src/infrastructure/kafka/consumers/InventoryEventConsumer.ts
// 재고 서비스로부터 결과 이벤트를 수신하여 주문 상태를 업데이트한다

import { EachMessagePayload } from 'kafkajs';
import { IOrderRepository } from '../../../domain/repositories/IOrderRepository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { OrderStatus } from '../../../domain/value-objects/OrderStatus';

export class InventoryEventConsumer {
  constructor(
    private readonly orderRepository: IOrderRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async handle({ message }: EachMessagePayload): Promise<void> {
    const event = JSON.parse(message.value!.toString());

    if (event.type === 'InventoryReserved') {
      const { orderId } = event.payload;
      // 재고 예약 성공 → 결제 요청 이벤트 발행 (SAGA 다음 단계)
      await this.orderRepository.updateStatus(orderId, OrderStatus.INVENTORY_RESERVED);

      await this.kafkaProducer.publish('payment.events', orderId, {
        type: 'PaymentRequested',
        payload: event.payload,
      });
    }

    if (event.type === 'InventoryInsufficient') {
      const { orderId } = event.payload;
      // 재고 부족 → 보상 트랜잭션: 주문 취소
      await this.orderRepository.updateStatus(orderId, OrderStatus.CANCELLED);
    }
  }
}
```

---

## 10. 검색 서비스 구축 (OpenSearch)

### OpenSearch 인덱스 매핑 (한국어 형태소 분석기)

```typescript
// apps/search-service/src/infrastructure/opensearch/ProductIndex.ts
import { Client } from '@opensearch-project/opensearch';

export class ProductIndex {
  private readonly INDEX_NAME = 'products';

  constructor(private readonly client: Client) {}

  async initialize(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.INDEX_NAME });
    if (exists.body) return;

    await this.client.indices.create({
      index: this.INDEX_NAME,
      body: {
        settings: {
          number_of_shards: 3,
          number_of_replicas: 1,
          analysis: {
            analyzer: {
              korean: {
                type: 'custom',
                tokenizer: 'nori_tokenizer',
                filter: ['nori_readingform', 'lowercase'],
              },
            },
          },
        },
        mappings: {
          properties: {
            productId:    { type: 'keyword' },
            name:         { type: 'text', analyzer: 'korean' },
            description:  { type: 'text', analyzer: 'korean' },
            price:        { type: 'double' },
            categoryId:   { type: 'keyword' },
            brand:        { type: 'keyword' },
            tags:         { type: 'keyword' },
            rating:       { type: 'float' },
            inStock:      { type: 'boolean' },
            createdAt:    { type: 'date' },
          },
        },
      },
    });
  }
}
```

### 상품 검색 쿼리 — Cache-Aside + Cursor 페이지네이션

```typescript
// apps/search-service/src/application/queries/SearchProductsHandler.ts
import { Client } from '@opensearch-project/opensearch';
import { Redis } from 'ioredis';
import crypto from 'crypto';

interface SearchProductsQuery {
  keyword: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  brand?: string;
  inStockOnly?: boolean;
  searchAfter?: unknown[];   // cursor 기반 페이지네이션
  size?: number;
}

export class SearchProductsHandler {
  private readonly CACHE_TTL = 300; // 인기 검색어 캐시 5분

  constructor(
    private readonly openSearch: Client,
    private readonly redis: Redis,
  ) {}

  async execute(query: SearchProductsQuery): Promise<object> {
    // 캐시 키 생성 — 쿼리 파라미터를 해시화
    const cacheKey = `search:${crypto
      .createHash('md5')
      .update(JSON.stringify(query))
      .digest('hex')}`;

    // 1단계: Redis 캐시 확인 (인기 검색어는 여기서 즉시 반환)
    if (!query.searchAfter) { // 첫 페이지만 캐싱
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    // 2단계: OpenSearch 풀텍스트 검색
    const esQuery = this.buildQuery(query);
    const response = await this.openSearch.search({
      index: 'products',
      body: esQuery,
    });

    const result = {
      hits: response.body.hits.hits.map((h: any) => h._source),
      total: response.body.hits.total.value,
      searchAfter: response.body.hits.hits.at(-1)?.sort ?? null,
    };

    // 3단계: 결과 캐싱 (첫 페이지만)
    if (!query.searchAfter) {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);
    }

    // 4단계: 검색어 인기도 업데이트 (Sorted Set)
    if (query.keyword) {
      await this.redis.zincrby('search:popular', 1, query.keyword);
    }

    return result;
  }

  private buildQuery(query: SearchProductsQuery): object {
    const must: object[] = [];
    const filter: object[] = [];

    // 풀텍스트 검색 + Fuzzy 오타 교정
    if (query.keyword) {
      must.push({
        multi_match: {
          query: query.keyword,
          fields: ['name^3', 'description', 'tags'],
          fuzziness: 'AUTO', // 오타 교정 자동 적용
          type: 'best_fields',
        },
      });
    }

    // 필터 조건
    if (query.categoryId) filter.push({ term: { categoryId: query.categoryId } });
    if (query.brand) filter.push({ term: { brand: query.brand } });
    if (query.inStockOnly) filter.push({ term: { inStock: true } });
    if (query.minPrice || query.maxPrice) {
      filter.push({ range: { price: { gte: query.minPrice, lte: query.maxPrice } } });
    }

    return {
      query: { bool: { must, filter } },
      // 응답 경량화: 필수 필드만 반환 (상세 설명 제외)
      _source: ['productId', 'name', 'price', 'brand', 'rating', 'inStock', 'thumbnailUrl'],
      sort: [{ _score: 'desc' }, { productId: 'asc' }], // cursor 페이지네이션을 위해 tie-breaker 추가
      search_after: query.searchAfter,
      size: query.size ?? 20,
    };
  }
}
```

---

## 11. 장바구니 서비스 구축 (Redis)

장바구니는 RDBMS에 저장하면 고객이 상품을 담을 때마다 DB 쓰기 요청이 발생해 부하가 심하다. Redis Hash로 관리하면 메모리 단에서 처리되어 초고속이다.

```typescript
// apps/cart-service/src/application/CartService.ts
import { Redis } from 'ioredis';

interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  name: string;
}

export class CartService {
  constructor(private readonly redis: Redis) {}

  private getKey(userId: string): string {
    return `cart:${userId}`;
  }

  async addItem(userId: string, item: CartItem): Promise<void> {
    const key = this.getKey(userId);
    // Redis Hash: 상품 ID를 필드로, 상품 정보를 JSON으로 저장
    await this.redis.hset(key, item.productId, JSON.stringify(item));
    // 로그인 사용자: 30일 TTL, 비로그인: 24시간 TTL
    await this.redis.expire(key, 30 * 24 * 60 * 60);
  }

  async removeItem(userId: string, productId: string): Promise<void> {
    await this.redis.hdel(this.getKey(userId), productId);
  }

  async updateQuantity(userId: string, productId: string, quantity: number): Promise<void> {
    const key = this.getKey(userId);
    const existing = await this.redis.hget(key, productId);
    if (!existing) return;

    const item: CartItem = JSON.parse(existing);
    item.quantity = quantity;
    await this.redis.hset(key, productId, JSON.stringify(item));
  }

  async getCart(userId: string): Promise<CartItem[]> {
    const data = await this.redis.hgetall(this.getKey(userId));
    return Object.values(data).map((v) => JSON.parse(v));
  }

  async clearCart(userId: string): Promise<void> {
    // 주문 완료 후 장바구니 초기화
    await this.redis.del(this.getKey(userId));
  }
}
```

---

## 12. Kafka 이벤트 아키텍처 설계

### 토픽 설계 원칙
- 토픽명은 `{도메인}.events` 형식
- 파티션 키는 `entityId` (주문ID, 상품ID 등) — 같은 엔티티의 이벤트는 항상 같은 파티션으로 가서 순서 보장

```
토픽 목록:
├── order.events          # 주문 서비스 발행 (OrderCreated, OrderCancelled)
├── inventory.events      # 재고 서비스 발행 (InventoryReserved, InventoryInsufficient)
├── payment.events        # 결제 서비스 발행 (PaymentCompleted, PaymentFailed)
├── product.events        # 상품 서비스 발행 (ProductCreated, ProductUpdated)
├── user.events           # 회원 서비스 발행 (UserRegistered)
└── notification.events   # 알림 서비스 발행 (알림 발송 결과)

컨슈머 그룹 목록:
├── inventory-service     # order.events 구독 → 재고 예약
├── payment-service       # order.events 구독 → 결제 처리 시작
├── order-service         # inventory.events + payment.events 구독 → 주문 상태 업데이트
├── sync-worker           # 모든 이벤트 구독 → Read DB 동기화
├── notification-service  # payment.events + order.events 구독 → 알림 발송 (RabbitMQ로 전달)
└── search-service        # product.events 구독 → OpenSearch 인덱스 갱신
```

### Sync Worker — Read DB 동기화

```typescript
// apps/sync-worker/src/consumers/ProductSyncConsumer.ts
import { EachMessagePayload } from 'kafkajs';
import { MongoClient } from 'mongodb';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { Redis } from 'ioredis';

export class ProductSyncConsumer {
  constructor(
    private readonly mongo: MongoClient,
    private readonly openSearch: OpenSearchClient,
    private readonly redis: Redis,
  ) {}

  async handle({ message }: EachMessagePayload): Promise<void> {
    const event = JSON.parse(message.value!.toString());

    if (event.type === 'ProductCreated' || event.type === 'ProductUpdated') {
      const { payload } = event;

      // 1. MongoDB Read DB 업데이트 (비정규화 문서)
      await this.mongo.db().collection('products').replaceOne(
        { productId: payload.productId },
        { ...payload, updatedAt: new Date() },
        { upsert: true },
      );

      // 2. OpenSearch 인덱스 업데이트
      await this.openSearch.index({
        index: 'products',
        id: payload.productId,
        body: {
          productId: payload.productId,
          name: payload.name,
          description: payload.description,
          price: payload.price,
          categoryId: payload.categoryId,
          inStock: (payload.stock ?? 0) > 0,
        },
      });

      // 3. Redis 캐시 무효화 — 다음 조회 시 최신 데이터를 Read DB에서 다시 로드하도록
      await this.redis.del(`product:${payload.productId}`);
    }
  }
}
```

---

## 13. 모니터링 & 가관측성

### Prometheus 메트릭 설정

```typescript
// packages/shared/src/metrics.ts
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export function setupMetrics(serviceName: string) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: `${serviceName}_` });

  const httpRequestDuration = new Histogram({
    name: `${serviceName}_http_request_duration_seconds`,
    help: 'HTTP 요청 처리 시간',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const kafkaMessagesProcessed = new Counter({
    name: `${serviceName}_kafka_messages_total`,
    help: '처리된 Kafka 메시지 수',
    labelNames: ['topic', 'status'],
    registers: [registry],
  });

  const cacheHitRate = new Counter({
    name: `${serviceName}_cache_hits_total`,
    help: 'Redis 캐시 히트 수',
    labelNames: ['type'], // 'hit' | 'miss'
    registers: [registry],
  });

  return { registry, httpRequestDuration, kafkaMessagesProcessed, cacheHitRate };
}
```

---

## 14. 오프라인 환경 배포 전략

### PM2 Cluster 모드 설정

오프라인 온프레미스 서버에서는 Kubernetes 대신 PM2를 사용한다. CPU 코어 수만큼 프로세스를 띄워 Node.js 싱글 스레드 한계를 극복한다.

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: 'apps/api-gateway/dist/server.js',
      instances: 'max',    // CPU 코어 수만큼 자동 설정
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3000 },
      // 그레이스풀 셧다운
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
    {
      name: 'auth-service',
      script: 'apps/auth-service/dist/server.js',
      instances: 4,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3001 },
    },
    {
      name: 'product-service',
      script: 'apps/product-service/dist/server.js',
      instances: 4,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3002 },
    },
    {
      name: 'order-service',
      script: 'apps/order-service/dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3003 },
    },
    {
      name: 'sync-worker',
      script: 'apps/sync-worker/dist/worker.js',
      instances: 2,
      exec_mode: 'fork', // 워커는 fork 모드
      env: { NODE_ENV: 'production' },
    },
  ],
};
```

### 그레이스풀 셧다운

서버를 재시작할 때 처리 중인 요청을 끊지 않고 완료될 때까지 기다린 후 종료한다.

```typescript
// apps/api-gateway/src/server.ts
import app from './app';
import { KafkaProducer } from '@ecommerce/kafka-client';

const server = app.listen(process.env.PORT ?? 3000, () => {
  process.send?.('ready'); // PM2에 준비 완료 신호
});

// SIGTERM 수신 시 (PM2 재시작, 배포 시 발생)
process.on('SIGTERM', async () => {
  console.log('SIGTERM 수신 — 그레이스풀 셧다운 시작');

  // 새 요청 받지 않음 + 진행 중인 요청 완료 대기
  server.close(async () => {
    await kafkaProducer.disconnect();
    console.log('서버 종료 완료');
    process.exit(0);
  });

  // 최대 10초 대기 후 강제 종료
  setTimeout(() => {
    console.error('강제 종료');
    process.exit(1);
  }, 10000);
});
```

### 오프라인 NPM 의존성 패키징

인터넷이 차단된 환경에서는 `npm install`이 불가능하다. 두 가지 전략이 있다:

**전략 A: node_modules 번들링 (간단)**
```bash
# 개발 망에서 빌드 완료 후
tar -czf node_modules.tar.gz node_modules/
# 타겟 서버로 전송
scp node_modules.tar.gz user@prod-server:/app/
# 타겟 서버에서 압축 해제
tar -xzf node_modules.tar.gz
```

**전략 B: Verdaccio Private NPM (권장 — 팀 규모 이상)**
```bash
# 사내 서버에 Verdaccio 설치 (한 번만)
npm install -g verdaccio
verdaccio  # http://internal-npm.company.com:4873 에서 실행

# 개발 망에서 패키지를 내부 저장소에 미러링
npm set registry http://internal-npm.company.com:4873
# 각 서비스 package.json에 맞춰 publish

# 타겟 서버에서
npm set registry http://internal-npm.company.com:4873
npm install  # 내부 저장소에서 설치
```

---

## 구축 순서 요약

```
주 1: 모노레포 + 공유 패키지 + Docker Compose 인프라
주 2: API Gateway + Auth Service (기반 인증 흐름 완성)
주 3: Product Service (CQRS Write) + Sync Worker (Read DB 동기화)
주 4: Cart Service (Redis) + Inventory Service (분산 락)
주 5: Order Service (SAGA) + Payment Service (멱등성)
주 6: Search Service (OpenSearch) + Notification Service (RabbitMQ)
주 7: 모니터링 (Prometheus + Grafana + OpenTelemetry)
주 8: 부하 테스트 (k6) + 성능 튜닝 + 오프라인 배포 패키징
```
