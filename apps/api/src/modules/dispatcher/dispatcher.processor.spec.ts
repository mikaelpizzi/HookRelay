import { Test, TestingModule } from '@nestjs/testing';
import { circuit_state, delivery_status } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';
import {
  calculateBackoffWithJitter,
  CIRCUIT_BREAKER_COOLING_PERIOD_MS,
  DispatcherProcessor,
  WebhookDeliveryJobData,
} from './dispatcher.processor';
import { SafeHttpTransport } from './safe-http-transport.service';

const mockRedisInstance = {
  on: jest.fn(),
  disconnect: jest.fn(),
};

const mockWorkerInstance = {
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockQueueInstance = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  addBulk: jest.fn().mockResolvedValue([]),
  getWaitingCount: jest.fn().mockResolvedValue(0),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('ioredis', () => {
  const MockIORedis = jest.fn().mockImplementation(() => mockRedisInstance);
  return {
    __esModule: true,
    default: MockIORedis,
    MockIORedis,
  };
});

jest.mock('bullmq', () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => mockQueueInstance),
  Worker: jest.fn().mockImplementation(() => mockWorkerInstance),
}));

describe('DispatcherProcessor', () => {
  let processor: DispatcherProcessor;
  let mockPrismaService: any;
  let mockQueueService: any;
  let mockSafeHttpTransport: any;
  let mockTx: any;

  const mockEvent = {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: 'tenant-123',
    topic_id: 'topic-123',
    environment: 'PRODUCTION',
    idempotency_key: 'idem-test-1',
    correlation_id: 'corr-test-1',
    payload: { action: 'user.created', user_id: 42 },
    status: 'DISPATCHED',
    created_at: new Date(),
  };

  const mockEndpoint = {
    id: '22222222-2222-2222-2222-222222222222',
    tenant_id: 'tenant-123',
    url: 'https://api.merchant.com/webhooks',
    description: 'Merchant primary receiver',
    signing_secret: 'whsec_secret_1234567890abcdef',
    is_active: true,
    circuit_status: circuit_state.CLOSED,
    consecutive_failures: 0,
    failure_threshold: 5,
    circuit_opened_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockDelivery = {
    id: '33333333-3333-3333-3333-333333333333',
    event_id: mockEvent.id,
    endpoint_id: mockEndpoint.id,
    status: delivery_status.PENDING,
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
    delivered_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    events: mockEvent,
    webhook_endpoints: mockEndpoint,
  };

  const createMockJob = (data?: Partial<WebhookDeliveryJobData>) =>
    ({
      id: 'job-bullmq-100',
      name: 'webhook-delivery',
      data: {
        deliveryId: mockDelivery.id,
        eventId: mockEvent.id,
        endpointId: mockEndpoint.id,
        tenantId: mockEvent.tenant_id,
        ...data,
      },
    }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ id: mockDelivery.id, status: delivery_status.PENDING }]),
      deliveries: {
        findUnique: jest.fn().mockResolvedValue(mockDelivery),
        update: jest.fn().mockResolvedValue({ ...mockDelivery, status: delivery_status.DELIVERED }),
      },
      webhook_endpoints: {
        update: jest.fn().mockResolvedValue(mockEndpoint),
      },
      delivery_attempts: {
        create: jest.fn().mockResolvedValue({ id: 'att-1' }),
      },
    };

    mockPrismaService = {
      withTenantContext: jest.fn().mockImplementation((_tenantId, callback) => callback(mockTx)),
    };

    mockQueueService = {
      getQueue: jest.fn().mockReturnValue(mockQueueInstance),
    };

    mockSafeHttpTransport = {
      dispatchWebhook: jest.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        responseBody: '{"received":true}',
        latencyMs: 42,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatcherProcessor,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: SafeHttpTransport, useValue: mockSafeHttpTransport },
      ],
    }).compile();

    processor = module.get<DispatcherProcessor>(DispatcherProcessor);
  });

  describe('calculateBackoffWithJitter', () => {
    it('should calculate exponential delay within expected bounds for attempt 1', () => {
      const delay = calculateBackoffWithJitter(1, 60_000, 3_600_000, 30_000);
      expect(delay).toBeGreaterThanOrEqual(60_000);
      expect(delay).toBeLessThan(90_000);
    });

    it('should scale exponentially for attempt 2 and attempt 3', () => {
      const delayAttempt2 = calculateBackoffWithJitter(2, 60_000, 3_600_000, 0);
      expect(delayAttempt2).toBe(120_000);

      const delayAttempt3 = calculateBackoffWithJitter(3, 60_000, 3_600_000, 0);
      expect(delayAttempt3).toBe(240_000);
    });

    it('should cap exponential delay at maxMs', () => {
      const delay = calculateBackoffWithJitter(10, 60_000, 3_600_000, 0);
      expect(delay).toBe(3_600_000);
    });

    it('should safely handle 0 or negative attempt numbers by defaulting to attempt 1', () => {
      const delayZero = calculateBackoffWithJitter(0, 60_000, 3_600_000, 0);
      expect(delayZero).toBe(60_000);

      const delayNeg = calculateBackoffWithJitter(-5, 60_000, 3_600_000, 0);
      expect(delayNeg).toBe(60_000);
    });
  });

  describe('process - Happy Path & Successful Delivery', () => {
    it('processes healthy endpoint -> creates delivery_attempts with is_success: true, updates delivery to DELIVERED', async () => {
      const job = createMockJob();

      await processor.process(job);

      expect(mockSafeHttpTransport.dispatchWebhook).toHaveBeenCalledTimes(1);
      expect(mockSafeHttpTransport.dispatchWebhook).toHaveBeenCalledWith({
        url: mockEndpoint.url,
        payload: JSON.stringify(mockEvent.payload),
        secret: mockEndpoint.signing_secret,
        deliveryId: mockDelivery.id,
        eventId: mockEvent.id,
        correlationId: mockEvent.correlation_id,
      });

      expect(mockTx.delivery_attempts.create).toHaveBeenCalledTimes(1);
      expect(mockTx.delivery_attempts.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          delivery_id: mockDelivery.id,
          endpoint_id: mockEndpoint.id,
          attempt_number: 1,
          is_success: true,
          http_status: 200,
          latency_ms: 42,
          response_body: '{"received":true}',
          error_code: null,
          request_headers: expect.objectContaining({
            'User-Agent': 'HookRelay-Dispatcher/1.0',
            'Content-Type': 'application/json',
            'X-HookRelay-Delivery-Id': mockDelivery.id,
            'X-HookRelay-Event-Id': mockEvent.id,
            'X-HookRelay-Correlation-Id': mockEvent.correlation_id,
          }),
        }),
      });

      expect(mockTx.deliveries.update).toHaveBeenCalledTimes(1);
      expect(mockTx.deliveries.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: expect.objectContaining({
          status: delivery_status.DELIVERED,
          attempt_count: 1,
          delivered_at: expect.any(Date),
        }),
      });

      // No retry job should be scheduled
      expect(mockQueueInstance.add).not.toHaveBeenCalled();
    });

    it('should respect raw string payloads without double serialization', async () => {
      const stringPayload = '{"raw":"string"}';
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        events: { ...mockEvent, payload: stringPayload },
      });

      const job = createMockJob();
      await processor.process(job);

      expect(mockSafeHttpTransport.dispatchWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ payload: stringPayload }),
      );
    });
  });

  describe('process - Idempotency & Inactive Endpoints', () => {
    it('Idempotency: delivery already DELIVERED skips execution', async () => {
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        status: delivery_status.DELIVERED,
      });

      const job = createMockJob();
      await processor.process(job);

      expect(mockSafeHttpTransport.dispatchWebhook).not.toHaveBeenCalled();
      expect(mockTx.delivery_attempts.create).not.toHaveBeenCalled();
      expect(mockTx.deliveries.update).not.toHaveBeenCalled();
      expect(mockQueueInstance.add).not.toHaveBeenCalled();
    });

    it('Inactive endpoint -> skips delivery gracefully', async () => {
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        webhook_endpoints: { ...mockEndpoint, is_active: false },
      });

      const job = createMockJob();
      await processor.process(job);

      expect(mockSafeHttpTransport.dispatchWebhook).not.toHaveBeenCalled();
      expect(mockTx.delivery_attempts.create).not.toHaveBeenCalled();
      expect(mockTx.deliveries.update).not.toHaveBeenCalled();
      expect(mockQueueInstance.add).not.toHaveBeenCalled();
    });

    it('should gracefully skip if delivery or relations are not found in database', async () => {
      mockTx.deliveries.findUnique.mockResolvedValueOnce(null);

      const job = createMockJob();
      await processor.process(job);

      expect(mockSafeHttpTransport.dispatchWebhook).not.toHaveBeenCalled();
      expect(mockTx.delivery_attempts.create).not.toHaveBeenCalled();
    });
  });

  describe('process - Circuit Breaker Management', () => {
    it('Circuit Breaker OPEN within cooling period -> re-enqueues without consuming attempt or inserting attempt record', async () => {
      const twentySecondsAgo = new Date(Date.now() - 20_000);
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        webhook_endpoints: {
          ...mockEndpoint,
          circuit_status: circuit_state.OPEN,
          circuit_opened_at: twentySecondsAgo,
        },
      });

      const job = createMockJob();
      await processor.process(job);

      // Should NOT dispatch HTTP or touch attempts
      expect(mockSafeHttpTransport.dispatchWebhook).not.toHaveBeenCalled();
      expect(mockTx.delivery_attempts.create).not.toHaveBeenCalled();
      expect(mockTx.deliveries.update).not.toHaveBeenCalled();

      // Must re-enqueue with remaining delay (~40s)
      expect(mockQueueInstance.add).toHaveBeenCalledTimes(1);
      const addCall = mockQueueInstance.add.mock.calls[0];
      expect(addCall[0]).toBe('webhook-delivery');
      expect(addCall[1]).toEqual(job.data);
      expect(addCall[2].delay).toBeGreaterThan(0);
      expect(addCall[2].delay).toBeLessThanOrEqual(CIRCUIT_BREAKER_COOLING_PERIOD_MS);
    });

    it('Circuit Breaker OPEN after cooling period -> transitions to HALF_OPEN and attempts dispatch', async () => {
      const seventySecondsAgo = new Date(Date.now() - 70_000);
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        webhook_endpoints: {
          ...mockEndpoint,
          circuit_status: circuit_state.OPEN,
          circuit_opened_at: seventySecondsAgo,
        },
      });

      const job = createMockJob();
      await processor.process(job);

      // Endpoint should transition to HALF_OPEN
      expect(mockTx.webhook_endpoints.update).toHaveBeenCalledTimes(1);
      expect(mockTx.webhook_endpoints.update).toHaveBeenCalledWith({
        where: { id: mockEndpoint.id },
        data: expect.objectContaining({
          circuit_status: circuit_state.HALF_OPEN,
          updated_at: expect.any(Date),
        }),
      });

      // Probe request must be dispatched
      expect(mockSafeHttpTransport.dispatchWebhook).toHaveBeenCalledTimes(1);
      expect(mockTx.delivery_attempts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_success: true }),
        }),
      );
      expect(mockTx.deliveries.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: delivery_status.DELIVERED }),
        }),
      );
    });
  });

  describe('process - Failures, Backoff Retries & Dead Lettering', () => {
    it('Endpoint failure with retries left -> updates to RETRYING, computes delay with jitter, re-enqueues job', async () => {
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        attempt_count: 1, // Will become attempt 2
        max_attempts: 5,
      });

      mockSafeHttpTransport.dispatchWebhook.mockResolvedValueOnce({
        success: false,
        statusCode: 503,
        latencyMs: 150,
        responseBody: 'Service Unavailable',
        errorCode: 'HTTP_503',
      });

      const job = createMockJob();
      await processor.process(job);

      // Attempt 2 recorded
      expect(mockTx.delivery_attempts.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempt_number: 2,
          is_success: false,
          http_status: 503,
          latency_ms: 150,
          response_body: 'Service Unavailable',
          error_code: 'HTTP_503',
        }),
      });

      // Delivery updated to RETRYING with next_retry_at
      expect(mockTx.deliveries.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: expect.objectContaining({
          status: delivery_status.RETRYING,
          attempt_count: 2,
          next_retry_at: expect.any(Date),
        }),
      });

      // Job re-enqueued with exponential backoff delay (~120s + jitter)
      expect(mockQueueInstance.add).toHaveBeenCalledTimes(1);
      const addCall = mockQueueInstance.add.mock.calls[0];
      expect(addCall[0]).toBe('webhook-delivery');
      expect(addCall[1]).toEqual(job.data);
      expect(addCall[2].delay).toBeGreaterThanOrEqual(120_000);
      expect(addCall[2].delay).toBeLessThan(150_000);
    });

    it('Max attempts exhausted -> updates delivery to DEAD_LETTER', async () => {
      mockTx.deliveries.findUnique.mockResolvedValueOnce({
        ...mockDelivery,
        attempt_count: 4, // Will become attempt 5, exhausting max_attempts: 5
        max_attempts: 5,
      });

      mockSafeHttpTransport.dispatchWebhook.mockResolvedValueOnce({
        success: false,
        statusCode: 500,
        latencyMs: 310,
        responseBody: 'Internal Server Error',
        errorCode: 'HTTP_500',
      });

      const job = createMockJob();
      await processor.process(job);

      // Attempt 5 recorded
      expect(mockTx.delivery_attempts.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempt_number: 5,
          is_success: false,
          http_status: 500,
          latency_ms: 310,
        }),
      });

      // Delivery transitioned to DEAD_LETTER
      expect(mockTx.deliveries.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: expect.objectContaining({
          status: delivery_status.DEAD_LETTER,
          attempt_count: 5,
          updated_at: expect.any(Date),
        }),
      });

      // No re-enqueue when max attempts are reached
      expect(mockQueueInstance.add).not.toHaveBeenCalled();
    });
  });

  describe('Lifecycle & Graceful Shutdown', () => {
    it('Graceful shutdown -> closes worker and disconnects redis client', async () => {
      await processor.onModuleInit();
      expect(processor.getWorker()).toBeDefined();

      await processor.onModuleDestroy();
      expect(mockWorkerInstance.close).toHaveBeenCalledTimes(1);
      expect(mockRedisInstance.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
