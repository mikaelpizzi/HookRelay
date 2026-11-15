import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { circuit_state, delivery_status } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { WEBHOOK_DELIVERIES_QUEUE } from '../../shared/queue/queue.constants';
import { QueueService } from '../../shared/queue/queue.service';
import { SafeHttpTransport } from './safe-http-transport.service';

export interface WebhookDeliveryJobData {
  deliveryId: string;
  eventId: string;
  endpointId: string;
  tenantId: string;
}

export const CIRCUIT_BREAKER_COOLING_PERIOD_MS = 60_000;

/**
 * Calculates exponential backoff with full jitter to avoid thundering herd on endpoints.
 * Formula: min(baseMs * 2^(attempt - 1), maxMs) + random(0, jitterMs)
 */
export function calculateBackoffWithJitter(
  attemptNumber: number,
  baseMs = 60_000,
  maxMs = 3_600_000,
  jitterMs = 30_000,
): number {
  const safeAttempt = Math.max(1, attemptNumber);
  const exponentialDelay = baseMs * Math.pow(2, safeAttempt - 1);
  const boundedDelay = Math.min(exponentialDelay, maxMs);
  const jitter = Math.floor(Math.random() * jitterMs);
  return boundedDelay + jitter;
}

@Injectable()
export class DispatcherProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatcherProcessor.name);
  private worker: Worker<WebhookDeliveryJobData> | null = null;
  private redisClient: IORedis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly safeHttpTransport: SafeHttpTransport,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    // BullMQ worker requires dedicated Redis connection with maxRetriesPerRequest: null
    this.redisClient = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
    });

    this.redisClient.on('error', (err) => {
      this.logger.warn(`Worker Redis connection error: ${err.message}`);
    });

    this.worker = new Worker<WebhookDeliveryJobData>(
      WEBHOOK_DELIVERIES_QUEUE,
      async (job: Job<WebhookDeliveryJobData>) => {
        await this.process(job);
      },
      {
        connection: this.redisClient,
        concurrency: 5,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} failed during execution: ${err.message}`,
        err.stack,
      );
    });

    this.worker.on('error', (err) => {
      this.logger.warn(`BullMQ worker encountered error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err: any) {
        this.logger.warn(`Error closing BullMQ worker: ${err?.message}`);
      }
    }

    if (this.redisClient) {
      try {
        this.redisClient.disconnect();
      } catch {
        // Ignore disconnect errors during process termination
      }
    }
  }

  getWorker(): Worker<WebhookDeliveryJobData> | null {
    return this.worker;
  }

  /**
   * Core execution pipeline for a webhook delivery job.
   * Enforces idempotency, circuit breaker states, safe HTTP transport,
   * database locking hierarchy, and exponential backoff retry scheduling.
   */
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { deliveryId, eventId, endpointId, tenantId } = job.data;
    this.logger.debug(
      `Processing delivery ${deliveryId} for event ${eventId} and endpoint ${endpointId}`,
    );

    // 1. Fetch delivery, event, and endpoint within tenant context
    const delivery = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.deliveries.findUnique({
        where: { id: deliveryId },
        include: {
          events: true,
          webhook_endpoints: true,
        },
      });
    });

    if (!delivery) {
      this.logger.warn(`Delivery ${deliveryId} not found, skipping job`);
      return;
    }

    const { events: event, webhook_endpoints: endpoint } = delivery;
    if (!event || !endpoint) {
      this.logger.warn(
        `Delivery ${deliveryId} is missing associated event or endpoint, skipping job`,
      );
      return;
    }

    // Idempotency check: if already completed, return immediately
    if (delivery.status === delivery_status.DELIVERED) {
      this.logger.debug(`Delivery ${deliveryId} is already DELIVERED, skipping`);
      return;
    }

    // Check endpoint status: if disabled, skip delivery gracefully without dispatch
    if (!endpoint.is_active) {
      this.logger.warn(
        `Endpoint ${endpoint.id} is inactive, skipping delivery ${delivery.id}`,
      );
      return;
    }

    // 2. Circuit Breaker check
    if (endpoint.circuit_status === circuit_state.OPEN) {
      const openedAt = endpoint.circuit_opened_at
        ? new Date(endpoint.circuit_opened_at).getTime()
        : Date.now();
      const elapsed = Date.now() - openedAt;

      if (elapsed >= CIRCUIT_BREAKER_COOLING_PERIOD_MS) {
        // Cooling period elapsed: transition to HALF_OPEN for health probe dispatch
        await this.prisma.withTenantContext(tenantId, async (tx) => {
          await tx.webhook_endpoints.update({
            where: { id: endpoint.id },
            data: {
              circuit_status: circuit_state.HALF_OPEN,
              updated_at: new Date(),
            },
          });
        });
        this.logger.log(
          `Endpoint ${endpoint.id} circuit transitioned from OPEN to HALF_OPEN (probe request)`,
        );
      } else {
        // Cooling period still active: reschedule job without consuming attempt
        const remainingDelay = Math.max(
          1000,
          CIRCUIT_BREAKER_COOLING_PERIOD_MS - elapsed,
        );
        this.logger.warn(
          `Endpoint ${endpoint.id} circuit is OPEN. Rescheduling delivery ${delivery.id} with delay ${remainingDelay}ms without incrementing attempts`,
        );
        await this.queueService
          .getQueue()
          .add(job.name || 'webhook-delivery', job.data, {
            delay: remainingDelay,
          });
        return;
      }
    }

    // 3. Execute HTTP dispatch via SafeHttpTransport
    const rawPayload =
      typeof event.payload === 'string'
        ? event.payload
        : JSON.stringify(event.payload);

    const dispatchResult = await this.safeHttpTransport.dispatchWebhook({
      url: endpoint.url,
      payload: rawPayload,
      secret: endpoint.signing_secret,
      deliveryId: delivery.id,
      eventId: event.id,
      correlationId: event.correlation_id,
    });

    const nextAttemptNumber = delivery.attempt_count + 1;
    const requestHeaders = {
      'User-Agent': 'HookRelay-Dispatcher/1.0',
      'Content-Type': 'application/json',
      'X-HookRelay-Delivery-Id': delivery.id,
      'X-HookRelay-Event-Id': event.id,
      'X-HookRelay-Correlation-Id': event.correlation_id,
    };

    // 4. Database update & Audit recording respecting lock hierarchy: events -> deliveries -> delivery_attempts
    let delayForRetry: number | null = null;

    await this.prisma.withTenantContext(tenantId, async (tx) => {
      // Locking hierarchy 1: events lock
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`
          SELECT id FROM events WHERE id = ${event.id}::uuid FOR SHARE
        `;
      }

      // Locking hierarchy 2: deliveries lock FOR UPDATE
      if (typeof tx.$queryRaw === 'function') {
        const lockedRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM deliveries WHERE id = ${delivery.id}::uuid FOR UPDATE
        `;
        if (
          lockedRows &&
          lockedRows.length > 0 &&
          lockedRows[0].status === delivery_status.DELIVERED
        ) {
          return;
        }
      }

      // Locking hierarchy 3: delivery_attempts insertion
      // Note: trigger trg_update_endpoint_circuit automatically fires upon this insert
      await tx.delivery_attempts.create({
        data: {
          delivery_id: delivery.id,
          endpoint_id: endpoint.id,
          attempt_number: nextAttemptNumber,
          is_success: dispatchResult.success,
          http_status: dispatchResult.statusCode ?? null,
          latency_ms: dispatchResult.latencyMs,
          request_headers: requestHeaders,
          response_body: dispatchResult.responseBody ?? null,
          error_code: dispatchResult.errorCode ?? null,
        },
      });

      if (dispatchResult.success) {
        await tx.deliveries.update({
          where: { id: delivery.id },
          data: {
            status: delivery_status.DELIVERED,
            delivered_at: new Date(),
            attempt_count: nextAttemptNumber,
            updated_at: new Date(),
          },
        });
      } else {
        if (nextAttemptNumber < delivery.max_attempts) {
          delayForRetry = calculateBackoffWithJitter(nextAttemptNumber);
          const nextRetryAt = new Date(Date.now() + delayForRetry);

          await tx.deliveries.update({
            where: { id: delivery.id },
            data: {
              status: delivery_status.RETRYING,
              attempt_count: nextAttemptNumber,
              next_retry_at: nextRetryAt,
              updated_at: new Date(),
            },
          });
        } else {
          await tx.deliveries.update({
            where: { id: delivery.id },
            data: {
              status: delivery_status.DEAD_LETTER,
              attempt_count: nextAttemptNumber,
              updated_at: new Date(),
            },
          });
        }
      }
    });

    // Re-enqueue in BullMQ after database transaction successfully commits
    if (delayForRetry !== null) {
      this.logger.debug(
        `Re-enqueueing failed delivery ${delivery.id} (attempt ${nextAttemptNumber}/${delivery.max_attempts}) with delay ${delayForRetry}ms`,
      );
      await this.queueService
        .getQueue()
        .add(job.name || 'webhook-delivery', job.data, {
          delay: delayForRetry,
        });
    }
  }
}
