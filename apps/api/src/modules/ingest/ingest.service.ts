import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { environment_type } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';
import { QUEUE_BACKPRESSURE_THRESHOLD } from '../../shared/queue/queue.constants';
import { SchemaValidatorService } from '../catalog/schema-validator.service';
import { IngestEventDto } from './dto/ingest-event.dto';
import { IngestResult } from './interfaces/ingest-result.interface';
import { BackpressureException } from './exceptions/backpressure.exception';

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schemaValidatorService: SchemaValidatorService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Ingests an event idempotently within a PostgreSQL transaction enforcing tenant isolation.
   * Emits outbox.wake if a new event is accepted, and skips re-dispatch if deduplicated.
   */
  async ingestEvent(
    tenantId: string,
    environment: environment_type,
    dto: IngestEventDto,
    correlationId: string,
  ): Promise<IngestResult> {
    // 1. Backpressure Check against BullMQ waiting queue depth
    const waitingCount = await this.queueService.getWaitingCount();
    if (waitingCount >= QUEUE_BACKPRESSURE_THRESHOLD) {
      throw new BackpressureException();
    }

    if (!dto.topic || typeof dto.topic !== 'string') {
      throw new BadRequestException('topic is required and must be a string');
    }

    if (!dto.data || typeof dto.data !== 'object' || Array.isArray(dto.data)) {
      throw new BadRequestException('data is required and must be an object');
    }

    const idempotencyKey =
      dto.idempotencyKey || dto.idempotency_key || crypto.randomUUID();

    // 2 & 3. Transaction with PostgreSQL Row-Level Security
    const result = await this.prisma.withTenantContext(
      tenantId,
      async (tx) => {
        // Query topic within tenant boundary
        let topic: { id: string; payload_schema: any } | null = null;
        if (typeof tx.event_topics?.findFirst === 'function') {
          topic = await tx.event_topics.findFirst({
            where: { tenant_id: tenantId, name: dto.topic },
            select: { id: true, payload_schema: true },
          });
        } else {
          const topicRows = await tx.$queryRaw<
            Array<{ id: string; payload_schema: any }>
          >`
            SELECT id, payload_schema
            FROM event_topics
            WHERE tenant_id = ${tenantId}::uuid AND name = ${dto.topic}
            LIMIT 1
          `;
          topic = topicRows[0] || null;
        }

        if (!topic) {
          throw new NotFoundException('Topic not found');
        }

        // Validate payload data against registered topic schema
        const validation = this.schemaValidatorService.validate(
          topic.id,
          topic.payload_schema as object,
          dto.data,
        );

        if (!validation.valid) {
          throw new HttpException(
            {
              message: 'Validation failed',
              errors: validation.errors,
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        // Insert event atomically with ON CONFLICT DO NOTHING
        const insertedRows = await tx.$queryRaw<
          Array<{ id: string; created_at: Date; status: string }>
        >`
          INSERT INTO events (
            tenant_id,
            topic_id,
            environment,
            idempotency_key,
            correlation_id,
            payload,
            status
          )
          VALUES (
            ${tenantId}::uuid,
            ${topic.id}::uuid,
            ${environment}::environment_type,
            ${idempotencyKey},
            ${correlationId},
            ${JSON.stringify(dto.data)}::jsonb,
            'PENDING'::event_status
          )
          ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
          RETURNING id, created_at, status
        `;

        if (insertedRows && insertedRows.length > 0) {
          const inserted = insertedRows[0];
          return {
            eventId: inserted.id,
            correlationId,
            status: 'ACCEPTED',
            deduplicated: false,
          };
        }

        // Deduplication: conflict detected, retrieve existing event record
        let existing: { id: string; correlation_id: string; status: string } | null =
          null;

        if (typeof tx.events?.findFirst === 'function') {
          existing = await tx.events.findFirst({
            where: { tenant_id: tenantId, idempotency_key: idempotencyKey },
            select: { id: true, correlation_id: true, status: true },
          });
        } else {
          const existingRows = await tx.$queryRaw<
            Array<{ id: string; correlation_id: string; status: string }>
          >`
            SELECT id, correlation_id, status
            FROM events
            WHERE tenant_id = ${tenantId}::uuid AND idempotency_key = ${idempotencyKey}
            LIMIT 1
          `;
          existing = existingRows[0] || null;
        }

        if (!existing) {
          throw new NotFoundException(
            'Event conflict detected but existing event was not found',
          );
        }

        return {
          eventId: existing.id,
          correlationId: existing.correlation_id,
          status: existing.status,
          deduplicated: true,
        };
      },
    );

    // Outbox notification emitted after successful transaction commit
    if (!result.deduplicated) {
      this.eventEmitter.emit('outbox.wake', {
        eventId: result.eventId,
        tenantId,
      });
    }

    return result;
  }
}
