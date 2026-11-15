import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { delivery_status } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';

describe('DeliveriesService', () => {
  let service: DeliveriesService;
  let prismaService: any;
  let queueService: any;

  const mockTenantId = 'tenant-123';
  const mockDeliveryId = 'delivery-123';
  const mockEventId = 'event-123';
  const mockEndpointId = 'endpoint-123';

  const mockDelivery = {
    id: mockDeliveryId,
    event_id: mockEventId,
    endpoint_id: mockEndpointId,
    status: delivery_status.PENDING,
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
    delivered_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    events: {
      id: mockEventId,
      correlation_id: 'corr-123',
      idempotency_key: 'idem-123',
      created_at: new Date(),
      environment: 'PRODUCTION',
      topic_id: 'topic-123',
      event_topics: { name: 'order.created' },
    },
    webhook_endpoints: {
      id: mockEndpointId,
      url: 'https://example.com/webhook',
      circuit_status: 'CLOSED',
      description: 'Webhook endpoint',
    },
    delivery_attempts: [],
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeEach(async () => {
    prismaService = {
      withTenantContext: jest.fn(),
    };

    queueService = {
      getQueue: jest.fn().mockReturnValue(mockQueue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: PrismaService, useValue: prismaService },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    service = module.get<DeliveriesService>(DeliveriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listDeliveries', () => {
    it('should return paginated deliveries with total count', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          deliveries: {
            findMany: jest.fn().mockResolvedValue([mockDelivery]),
            count: jest.fn().mockResolvedValue(1),
          },
        }),
      );

      const result = await service.listDeliveries(mockTenantId, {
        limit: 10,
        offset: 0,
        status: delivery_status.PENDING,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('should throw BadRequestException if status is invalid', async () => {
      await expect(
        service.listDeliveries(mockTenantId, {
          status: 'INVALID_STATUS' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDeliveryById', () => {
    it('should return delivery if found', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          deliveries: {
            findFirst: jest.fn().mockResolvedValue(mockDelivery),
          },
        }),
      );

      const result = await service.getDeliveryById(mockTenantId, mockDeliveryId);
      expect(result).toEqual(mockDelivery);
    });

    it('should throw NotFoundException if delivery does not exist', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          deliveries: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.getDeliveryById(mockTenantId, 'missing-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('replayDelivery', () => {
    it('should update status and re-enqueue delivery in BullMQ', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          deliveries: {
            findFirst: jest.fn().mockResolvedValue(mockDelivery),
            update: jest.fn().mockResolvedValue({
              ...mockDelivery,
              status: delivery_status.PENDING,
            }),
          },
        }),
      );

      const result = await service.replayDelivery(mockTenantId, mockDeliveryId);

      expect(result.replayed).toBe(true);
      expect(result.deliveryId).toBe(mockDeliveryId);
      expect(result.status).toBe(delivery_status.PENDING);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'webhook-delivery',
        expect.objectContaining({
          deliveryId: mockDeliveryId,
          eventId: mockEventId,
          endpointId: mockEndpointId,
          tenantId: mockTenantId,
        }),
        expect.objectContaining({
          priority: 1,
          delay: 0,
        }),
      );
    });

    it('should throw NotFoundException if delivery to replay is not found', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          deliveries: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.replayDelivery(mockTenantId, 'missing-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
