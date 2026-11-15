import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';

export interface BatchProcessResult {
  processedEvents: number;
  deliveriesCount: number;
}

@Injectable()
export class OutboxPollerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxPollerService.name);
  public isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Reconciles any orphaned PENDING events when the server starts up.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Reconciling pending outbox events on application bootstrap');
    await this.trigger();
  }

  /**
   * Event listener for new ingested events. Wakes the poller loop.
   */
  @OnEvent('outbox.wake')
  async handleOutboxWake(_payload?: unknown): Promise<void> {
    this.logger.debug('Received outbox.wake event, triggering poller');
    await this.trigger();
  }

  /**
   * Triggers the adaptive outbox drain loop.
   * Continues processing batches until 0 PENDING events remain, then suspends.
   * If already processing, the trigger is safely ignored to protect against concurrency.
   */
  async trigger(batchSize: number = 100): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Poller is already processing, ignoring trigger');
      return;
    }

    try {
      let processedCount = 0;
      do {
        const result = await this.processNextBatch(batchSize);
        processedCount = result.processedEvents;
      } while (processedCount > 0);
    } catch (error: any) {
      this.logger.error(
        `Error during outbox poller run: ${error?.message || error}`,
        error?.stack,
      );
    }
  }

  /**
   * Processes a single batch of PENDING events within a transactional boundary:
   * 1. SELECT PENDING events FOR UPDATE SKIP LOCKED
   * 2. Resolves active subscriptions from v_active_subscriptions
   * 3. Inserts deliveries with ON CONFLICT DO NOTHING RETURNING id, event_id, endpoint_id, max_attempts
   * 4. Updates events to DISPATCHED
   * 5. Enqueues jobs to BullMQ outside the database transaction
   */
  async processNextBatch(batchSize: number = 100): Promise<BatchProcessResult> {
    if (this.isProcessing) {
      this.logger.debug('Batch processing skipped: already in progress');
      return { processedEvents: 0, deliveriesCount: 0 };
    }

    this.isProcessing = true;
    try {
      return await this.executeBatch(batchSize);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeBatch(batchSize: number): Promise<BatchProcessResult> {
    const createdDeliveries: Array<{
      id: string;
      event_id: string;
      endpoint_id: string;
      max_attempts: number;
      tenant_id: string;
    }> = [];

    let processedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      // 1. Lock pending events batch non-blockingly
      const events = await tx.$queryRaw<
        Array<{
          id: string;
          tenant_id: string;
          topic_id: string;
          environment: string;
        }>
      >`
        SELECT id, tenant_id, topic_id, environment
        FROM events
        WHERE status = 'PENDING'::event_status
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (!events || events.length === 0) {
        return;
      }

      processedCount = events.length;
      const eventIds = events.map((e) => e.id);

      // 2. Resolve active subscriptions matching topic_id, environment and tenant_id
      const subscriptions = await tx.$queryRaw<
        Array<{
          event_id: string;
          tenant_id: string;
          endpoint_id: string;
          max_attempts: number;
        }>
      >`
        SELECT
          e.id AS event_id,
          e.tenant_id,
          s.endpoint_id,
          s.max_attempts
        FROM events e
        INNER JOIN v_active_subscriptions s
          ON s.tenant_id = e.tenant_id
         AND s.topic_id = e.topic_id
         AND s.environment = e.environment
        WHERE e.id = ANY(${eventIds}::uuid[])
      `;

      // 3. Insert deliveries with idempotent conflict handling
      if (subscriptions && subscriptions.length > 0) {
        for (const sub of subscriptions) {
          const rows = await tx.$queryRaw<
            Array<{
              id: string;
              event_id: string;
              endpoint_id: string;
              max_attempts: number;
            }>
          >`
            INSERT INTO deliveries (event_id, endpoint_id, max_attempts, status)
            VALUES (
              ${sub.event_id}::uuid,
              ${sub.endpoint_id}::uuid,
              ${sub.max_attempts},
              'PENDING'::delivery_status
            )
            ON CONFLICT (event_id, endpoint_id) DO NOTHING
            RETURNING id, event_id, endpoint_id, max_attempts
          `;

          if (rows && rows.length > 0) {
            createdDeliveries.push({
              id: rows[0].id,
              event_id: rows[0].event_id,
              endpoint_id: rows[0].endpoint_id,
              max_attempts: rows[0].max_attempts,
              tenant_id: sub.tenant_id,
            });
          }
        }
      }

      // 4. Update processed events to DISPATCHED
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`
          UPDATE events
          SET status = 'DISPATCHED'::event_status
          WHERE id = ANY(${eventIds}::uuid[])
        `;
      } else {
        await tx.$queryRaw`
          UPDATE events
          SET status = 'DISPATCHED'::event_status
          WHERE id = ANY(${eventIds}::uuid[])
        `;
      }
    });

    // 5. Enqueue jobs to BullMQ after transaction successfully commits
    if (createdDeliveries.length > 0) {
      const jobs = createdDeliveries.map((delivery) => ({
        name: 'webhook-delivery',
        data: {
          deliveryId: delivery.id,
          eventId: delivery.event_id,
          endpointId: delivery.endpoint_id,
          tenantId: delivery.tenant_id,
        },
        opts: {
          attempts: delivery.max_attempts,
          removeOnComplete: true,
        },
      }));

      await this.queueService.getQueue().addBulk(jobs);
    }

    return {
      processedEvents: processedCount,
      deliveriesCount: createdDeliveries.length,
    };
  }
}
