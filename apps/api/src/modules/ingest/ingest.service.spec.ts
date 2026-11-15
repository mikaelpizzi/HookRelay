import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { environment_type } from '@prisma/client';
import { IngestService } from './ingest.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';
import { SchemaValidatorService } from '../catalog/schema-validator.service';

describe('IngestService', () => {
  let service: IngestService;
  let prismaService: any;
  let schemaValidatorService: any;
  let queueService: any;
  let eventEmitter: any;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockTopicId = '22222222-2222-2222-2222-222222222222';
  const mockEventId = '33333333-3333-3333-3333-333333333333';
  const mockCorrelationId = 'corr-uuid-1234';

  const mockTopic = {
    id: mockTopicId,
    tenant_id: mockTenantId,
    name: 'order.created',
    payload_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
      required: ['orderId', 'amount'],
    },
  };

  const validDto = {
    topic: 'order.created',
    data: { orderId: 'ord-100', amount: 99.95 },
    idempotencyKey: 'idem-key-001',
  };

  let mockTx: any;

  beforeEach(async () => {
    mockTx = {
      event_topics: {
        findFirst: jest.fn().mockResolvedValue(mockTopic),
      },
      events: {
        findFirst: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    prismaService = {
      withTenantContext: jest.fn().mockImplementation((_tenantId, callback) => {
        return callback(mockTx);
      }),
    };

    schemaValidatorService = {
      validate: jest.fn().mockReturnValue({ valid: true }),
    };

    queueService = {
      getWaitingCount: jest.fn().mockResolvedValue(100),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestService,
        { provide: PrismaService, useValue: prismaService },
        { provide: SchemaValidatorService, useValue: schemaValidatorService },
        { provide: QueueService, useValue: queueService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<IngestService>(IngestService);
  });

  it('should successfully ingest a new event and emit outbox.wake', async () => {
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: mockEventId,
        created_at: new Date(),
        status: 'PENDING',
      },
    ]);

    const result = await service.ingestEvent(
      mockTenantId,
      environment_type.PRODUCTION,
      validDto,
      mockCorrelationId,
    );

    expect(result).toEqual({
      eventId: mockEventId,
      correlationId: mockCorrelationId,
      status: 'ACCEPTED',
      deduplicated: false,
    });

    expect(prismaService.withTenantContext).toHaveBeenCalledWith(
      mockTenantId,
      expect.any(Function),
    );
    expect(schemaValidatorService.validate).toHaveBeenCalledWith(
      mockTopicId,
      mockTopic.payload_schema,
      validDto.data,
    );
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith('outbox.wake', {
      eventId: mockEventId,
      tenantId: mockTenantId,
    });
  });

  it('should return existing event on deduplication without emitting outbox.wake', async () => {
    // Empty return from INSERT simulates ON CONFLICT DO NOTHING
    mockTx.$queryRaw.mockResolvedValueOnce([]);

    // Existing event lookup
    mockTx.events.findFirst.mockResolvedValueOnce({
      id: mockEventId,
      correlation_id: 'original-corr-id',
      status: 'PENDING',
    });

    const result = await service.ingestEvent(
      mockTenantId,
      environment_type.PRODUCTION,
      validDto,
      mockCorrelationId,
    );

    expect(result).toEqual({
      eventId: mockEventId,
      correlationId: 'original-corr-id',
      status: 'PENDING',
      deduplicated: true,
    });

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should throw 422 Unprocessable Entity when payload schema validation fails', async () => {
    schemaValidatorService.validate.mockReturnValueOnce({
      valid: false,
      errors: ["must have required property 'amount'"],
    });

    await expect(
      service.ingestEvent(
        mockTenantId,
        environment_type.PRODUCTION,
        validDto,
        mockCorrelationId,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        response: {
          message: 'Validation failed',
          errors: ["must have required property 'amount'"],
        },
      }),
    );

    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should throw 404 NotFoundException when topic does not exist', async () => {
    mockTx.event_topics.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.ingestEvent(
        mockTenantId,
        environment_type.PRODUCTION,
        { ...validDto, topic: 'nonexistent.topic' },
        mockCorrelationId,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(schemaValidatorService.validate).not.toHaveBeenCalled();
    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should throw 429 Too Many Requests with Retry-After header when queue depth >= 5000', async () => {
    queueService.getWaitingCount.mockResolvedValueOnce(5000);

    try {
      await service.ingestEvent(
        mockTenantId,
        environment_type.PRODUCTION,
        validDto,
        mockCorrelationId,
      );
      fail('Expected BackpressureException to be thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(error.message).toBe('System under high backpressure. Queue limit exceeded.');
      expect(error.headers?.['Retry-After'] || error['Retry-After']).toBe('10');
    }

    expect(prismaService.withTenantContext).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
