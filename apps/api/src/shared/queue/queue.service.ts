import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { WEBHOOK_DELIVERIES_QUEUE } from './queue.constants';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queue: Queue;
  private readonly redisClient: IORedis;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    // BullMQ requires maxRetriesPerRequest: null on dedicated Redis connections
    this.redisClient = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
    });

    // Suppress unhandled error crashes when Redis is offline in test or dev environments
    this.redisClient.on('error', (err) => {
      this.logger.warn(`Redis connection error: ${err.message}`);
    });

    this.queue = new Queue(WEBHOOK_DELIVERIES_QUEUE, {
      connection: this.redisClient,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }

  /**
   * Exposes the dedicated Redis connection for health probe pings.
   */
  getRedisClient(): IORedis {
    return this.redisClient;
  }

  /**
   * Retrieves the current count of waiting jobs in the delivery queue.
   * Gracefully returns 0 if Redis is offline or unreachable.
   */
  async getWaitingCount(): Promise<number> {
    try {
      return await this.queue.getWaitingCount();
    } catch (error: any) {
      this.logger.warn(
        `Failed to retrieve queue waiting count: ${error?.message || error}`,
      );
      return 0;
    }
  }

  /**
   * Exposes the underlying BullMQ queue for job dispatching.
   */
  getQueue(): Queue {
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue.close();
    } catch {
      // Ignore cleanup failures during shutdown
    }
    try {
      this.redisClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}
