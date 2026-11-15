import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { delivery_status } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';
import { ListDeliveriesDto } from './dto/list-deliveries.dto';

export interface PaginatedDeliveriesResult {
  items: any[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Lists deliveries for the authenticated tenant under RLS with optional filtering and pagination.
   */
  async listDeliveries(
    tenantId: string,
    query: ListDeliveriesDto,
  ): Promise<PaginatedDeliveriesResult> {
    const rawLimit = Number(query.limit ?? 50);
    const rawOffset = Number(query.offset ?? 0);

    const limit = isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 100);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const correlationId = query.correlationId || query.correlation_id;
    const eventId = query.eventId || query.event_id;
    const endpointId = query.endpointId || query.endpoint_id;

    if (query.status && !Object.values(delivery_status).includes(query.status)) {
      throw new BadRequestException(
        `Invalid status '${query.status}'. Allowed: ${Object.values(delivery_status).join(', ')}`,
      );
    }

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const where: any = {
        webhook_endpoints: {
          tenant_id: tenantId,
        },
      };

      if (query.status) {
        where.status = query.status;
      }

      if (correlationId) {
        where.events = {
          ...where.events,
          correlation_id: correlationId,
        };
      }

      if (eventId) {
        where.event_id = eventId;
      }

      if (endpointId) {
        where.endpoint_id = endpointId;
      }

      const [items, total] = await Promise.all([
        tx.deliveries.findMany({
          where,
          include: {
            events: {
              select: {
                id: true,
                correlation_id: true,
                idempotency_key: true,
                created_at: true,
                environment: true,
                topic_id: true,
                event_topics: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            webhook_endpoints: {
              select: {
                id: true,
                url: true,
                circuit_status: true,
                description: true,
              },
            },
            delivery_attempts: {
              orderBy: {
                created_at: 'desc',
              },
              take: 1,
              select: {
                latency_ms: true,
                http_status: true,
                is_success: true,
                created_at: true,
              },
            },
          },
          orderBy: {
            created_at: 'desc',
          },
          take: limit,
          skip: offset,
        }),
        tx.deliveries.count({ where }),
      ]);

      return {
        items,
        total,
        limit,
        offset,
      };
    });
  }

  /**
   * Retrieves full delivery details by ID including all chronological attempts.
   */
  async getDeliveryById(tenantId: string, id: string): Promise<any> {
    const delivery = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.deliveries.findFirst({
        where: {
          id,
          webhook_endpoints: {
            tenant_id: tenantId,
          },
        },
        include: {
          events: {
            include: {
              event_topics: true,
            },
          },
          webhook_endpoints: {
            include: {
              endpoint_environments: true,
            },
          },
          delivery_attempts: {
            orderBy: {
              attempt_number: 'asc',
            },
          },
        },
      });
    });

    if (!delivery) {
      throw new NotFoundException(`Delivery with ID '${id}' not found`);
    }

    return delivery;
  }

  /**
   * Manually re-enqueues a delivery into BullMQ queue with high priority and 0 delay.
   */
  async replayDelivery(
    tenantId: string,
    id: string,
  ): Promise<{ replayed: boolean; deliveryId: string; status: delivery_status }> {
    const delivery = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.deliveries.findFirst({
        where: {
          id,
          webhook_endpoints: {
            tenant_id: tenantId,
          },
        },
      });
    });

    if (!delivery) {
      throw new NotFoundException(`Delivery with ID '${id}' not found`);
    }

    const updated = await this.prisma.withTenantContext(tenantId, async (tx) => {
      return tx.deliveries.update({
        where: { id: delivery.id },
        data: {
          status: delivery_status.PENDING,
          next_retry_at: new Date(),
          updated_at: new Date(),
        },
      });
    });

    // Enqueue job into BullMQ queue with high priority and 0 delay
    await this.queueService.getQueue().add(
      'webhook-delivery',
      {
        deliveryId: delivery.id,
        eventId: delivery.event_id,
        endpointId: delivery.endpoint_id,
        tenantId,
      },
      {
        priority: 1,
        delay: 0,
        attempts: delivery.max_attempts,
        removeOnComplete: true,
      },
    );

    this.logger.log(`Delivery ${id} re-enqueued for tenant ${tenantId}`);

    return {
      replayed: true,
      deliveryId: updated.id,
      status: updated.status,
    };
  }
}
