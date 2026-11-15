import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { circuit_state, delivery_status } from '@prisma/client';
import { Job } from 'bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import {
  calculateBackoffWithJitter,
  DispatcherProcessor,
  WebhookDeliveryJobData,
} from '../src/modules/dispatcher/dispatcher.processor';

describe('Dispatcher Chaos, Backoff & Circuit Breaker (E2E / Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: DispatcherProcessor;

  // Ephemeral HTTP Chaos Server
  let chaosServer: http.Server;
  let serverPort: number;
  let serverResponses: Array<{ statusCode: number; receivedHeaders: http.IncomingHttpHeaders }> = [];
  let currentResponseStatus = 503;

  // Database test fixture IDs
  let tenantId: string;
  let endpointId: string;
  let topicId: string;
  let eventId: string;
  let deliveryId: string;

  const previousAllowLocal = process.env.ALLOW_LOCAL_WEBHOOKS;

  beforeAll(async () => {
    // Explicitly permit local dispatch to ephemeral chaos server port
    process.env.ALLOW_LOCAL_WEBHOOKS = 'true';

    // 1. Start ephemeral node:http server on dynamic port (0)
    await new Promise<void>((resolve) => {
      chaosServer = http.createServer((req, res) => {
        req.resume(); // Drain request body stream so socket remains responsive
        serverResponses.push({
          statusCode: currentResponseStatus,
          receivedHeaders: req.headers,
        });

        res.statusCode = currentResponseStatus;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Connection', 'close');
        if (currentResponseStatus >= 200 && currentResponseStatus < 300) {
          res.end(JSON.stringify({ status: 'ok', receivedAt: Date.now() }));
        } else {
          res.end(JSON.stringify({ error: 'Service Unavailable', code: 'CHAOS_503' }));
        }
      });

      chaosServer.listen(0, '127.0.0.1', () => {
        const addr = chaosServer.address() as { port: number };
        serverPort = addr.port;
        resolve();
      });
    });

    // 2. Initialize NestJS testing module
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    processor = app.get(DispatcherProcessor);

    // Pause background BullMQ worker so manual processor.process calls are fully deterministic
    try {
      await processor.getWorker()?.pause();
    } catch {
      // Ignore if worker pause is not supported
    }

    // 3. Provision database fixtures: Tenant -> Topic -> Endpoint (failure_threshold = 3) -> Event -> Delivery
    const tenant = await prisma.tenants.create({
      data: {
        name: 'Chaos Test Tenant',
        slug: `chaos-tenant-${crypto.randomUUID()}`,
      },
    });
    tenantId = tenant.id;

    const topic = await prisma.event_topics.create({
      data: {
        tenant_id: tenantId,
        name: 'invoice.failed',
        payload_schema: { type: 'object' },
        max_attempts: 10,
      },
    });
    topicId = topic.id;

    const endpoint = await prisma.webhook_endpoints.create({
      data: {
        tenant_id: tenantId,
        url: `http://127.0.0.1:${serverPort}/chaos-webhook`,
        signing_secret: 'whsec_chaos_test_secret_0123456789',
        is_active: true,
        failure_threshold: 3,
        circuit_status: circuit_state.CLOSED,
        consecutive_failures: 0,
      },
    });
    endpointId = endpoint.id;

    const event = await prisma.events.create({
      data: {
        tenant_id: tenantId,
        topic_id: topicId,
        environment: 'PRODUCTION',
        idempotency_key: `chaos-idem-${crypto.randomUUID()}`,
        correlation_id: `chaos-corr-${crypto.randomUUID()}`,
        payload: { invoiceId: 'inv_chaos_999', reason: 'insufficient_funds' },
        status: 'PENDING',
      },
    });
    eventId = event.id;

    const delivery = await prisma.deliveries.create({
      data: {
        event_id: eventId,
        endpoint_id: endpointId,
        status: delivery_status.PENDING,
        attempt_count: 0,
        max_attempts: 10,
      },
    });
    deliveryId = delivery.id;
  });

  afterAll(async () => {
    // Restore environment variable
    process.env.ALLOW_LOCAL_WEBHOOKS = previousAllowLocal;

    // Shut down ephemeral HTTP server and Nest application
    if (chaosServer) {
      await new Promise<void>((resolve) => chaosServer.close(() => resolve()));
    }
    if (app) {
      await app.close();
    }
  });

  describe('Exponential Backoff with Full Jitter Calculation', () => {
    it('should calculate exponential delay within bounded min/max ranges with non-negative jitter', () => {
      const baseMs = 1000;
      const maxMs = 30000;
      const jitterMs = 500;

      for (let attempt = 1; attempt <= 6; attempt++) {
        const expectedMin = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
        const expectedMax = expectedMin + jitterMs;

        const delays = Array.from({ length: 20 }).map(() =>
          calculateBackoffWithJitter(attempt, baseMs, maxMs, jitterMs),
        );

        for (const delay of delays) {
          expect(delay).toBeGreaterThanOrEqual(expectedMin);
          expect(delay).toBeLessThanOrEqual(expectedMax);
        }

        // Verify that jitter is non-deterministic (different values generated across iterations)
        const uniqueValues = new Set(delays);
        expect(uniqueValues.size).toBeGreaterThan(1);
      }
    });

    it('should clamp backoff to maxMs ceiling when attempt count is high', () => {
      const baseMs = 60000;
      const maxMs = 3600000; // 1 hour
      const jitterMs = 30000;

      const delay = calculateBackoffWithJitter(15, baseMs, maxMs, jitterMs);
      expect(delay).toBeGreaterThanOrEqual(maxMs);
      expect(delay).toBeLessThanOrEqual(maxMs + jitterMs);
    });
  });

  describe('Circuit Breaker Transitions & Worker Bypass', () => {
    const buildMockJob = (): Job<WebhookDeliveryJobData> => {
      return {
        id: `job-${crypto.randomUUID()}`,
        name: 'webhook-delivery',
        data: {
          deliveryId,
          eventId,
          endpointId,
          tenantId,
        },
      } as unknown as Job<WebhookDeliveryJobData>;
    };

    it('should increment consecutive_failures upon 503 responses and transition circuit to OPEN at threshold', async () => {
      currentResponseStatus = 503;
      serverResponses = [];

      // Attempt 1: 503
      await processor.process(buildMockJob());
      let endpoint = await prisma.webhook_endpoints.findUniqueOrThrow({ where: { id: endpointId } });
      expect(endpoint.consecutive_failures).toBe(1);
      expect(endpoint.circuit_status).toBe(circuit_state.CLOSED);

      // Attempt 2: 503
      await processor.process(buildMockJob());
      endpoint = await prisma.webhook_endpoints.findUniqueOrThrow({ where: { id: endpointId } });
      expect(endpoint.consecutive_failures).toBe(2);
      expect(endpoint.circuit_status).toBe(circuit_state.CLOSED);

      // Attempt 3: 503 -> reaches failure_threshold = 3 -> trigger trg_update_endpoint_circuit fires
      await processor.process(buildMockJob());
      endpoint = await prisma.webhook_endpoints.findUniqueOrThrow({ where: { id: endpointId } });
      expect(endpoint.consecutive_failures).toBe(3);
      expect(endpoint.circuit_status).toBe(circuit_state.OPEN);
      expect(endpoint.circuit_opened_at).not.toBeNull();

      // Verify delivery record status is RETRYING
      const delivery = await prisma.deliveries.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(delivery.status).toBe(delivery_status.RETRYING);
      expect(delivery.attempt_count).toBe(3);
    });

    it('should NOT perform HTTP requests while circuit status is OPEN within cooling period', async () => {
      serverResponses = [];

      // Endpoint circuit is OPEN and circuit_opened_at is fresh (< 60s)
      const mockJob = buildMockJob();
      await processor.process(mockJob);

      // Verify no HTTP request reached the chaos server
      expect(serverResponses.length).toBe(0);

      // Verify attempt count did not increment
      const attemptsCount = await prisma.delivery_attempts.count({
        where: { delivery_id: deliveryId },
      });
      expect(attemptsCount).toBe(3);
    });

    it('should transition endpoint from OPEN to HALF_OPEN after cooling period expires and send probe request', async () => {
      // Simulate cooling period expiration by moving circuit_opened_at into the past (> 60s)
      const pastDate = new Date(Date.now() - 75000);
      await prisma.webhook_endpoints.update({
        where: { id: endpointId },
        data: { circuit_opened_at: pastDate },
      });

      serverResponses = [];

      // Execute delivery job while in cooled state -> triggers probe transition to HALF_OPEN
      await processor.process(buildMockJob());

      // Verify probe HTTP request was dispatched
      expect(serverResponses.length).toBe(1);

      // Server still returned 503 on probe -> circuit returned to OPEN with incremented failures
      const endpoint = await prisma.webhook_endpoints.findUniqueOrThrow({ where: { id: endpointId } });
      expect(endpoint.circuit_status).toBe(circuit_state.OPEN);
      expect(endpoint.consecutive_failures).toBe(4);
    });

    it('should transition circuit to CLOSED and mark delivery DELIVERED when server recovers to 200 OK', async () => {
      // Recover server to 200 OK
      currentResponseStatus = 200;
      serverResponses = [];

      // Expire cooling period to allow probe request
      const pastDate = new Date(Date.now() - 75000);
      await prisma.webhook_endpoints.update({
        where: { id: endpointId },
        data: { circuit_opened_at: pastDate },
      });

      // Dispatch probe request against healthy server
      await processor.process(buildMockJob());

      // Verify probe was dispatched and received 200
      expect(serverResponses.length).toBe(1);
      expect(serverResponses[0].statusCode).toBe(200);

      // Verify endpoint circuit closed and failure counter reset to 0
      const endpoint = await prisma.webhook_endpoints.findUniqueOrThrow({ where: { id: endpointId } });
      expect(endpoint.circuit_status).toBe(circuit_state.CLOSED);
      expect(endpoint.consecutive_failures).toBe(0);
      expect(endpoint.circuit_opened_at).toBeNull();

      // Verify delivery is marked DELIVERED
      const delivery = await prisma.deliveries.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(delivery.status).toBe(delivery_status.DELIVERED);
      expect(delivery.delivered_at).not.toBeNull();
    });
  });
});
