import { Test, TestingModule } from '@nestjs/testing';
import { OutboxPollerService } from './outbox-poller.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QueueService } from '../../shared/queue/queue.service';

describe('OutboxPollerService', () => {
  let service: OutboxPollerService;
  let prismaService: any;
  let queueService: any;
  let mockQueue: any;
  let mockTx: any;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockTopicId1 = '22222222-2222-2222-2222-222222222222';
  const mockTopicId2 = '33333333-3333-3333-3333-333333333333';
  const mockEventId1 = '44444444-4444-4444-4444-444444444444';
  const mockEventId2 = '55555555-5555-5555-5555-555555555555';
  const mockEndpointId1 = '66666666-6666-6666-6666-666666666666';
  const mockEndpointId2 = '77777777-7777-7777-7777-777777777777';
  const mockEndpointId3 = '88888888-8888-8888-8888-888888888888';
  const mockDeliveryId1 = '99999999-9999-9999-9999-999999999991';
  const mockDeliveryId2 = '99999999-9999-9999-9999-999999999992';
  const mockDeliveryId3 = '99999999-9999-9999-9999-999999999993';

  beforeEach(async () => {
    mockQueue = {
      addBulk: jest.fn().mockResolvedValue([]),
    };

    queueService = {
      getQueue: jest.fn().mockReturnValue(mockQueue),
    };

    mockTx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };

    prismaService = {
      $transaction: jest.fn().mockImplementation((callback) => callback(mockTx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxPollerService,
        { provide: PrismaService, useValue: prismaService },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    service = module.get<OutboxPollerService>(OutboxPollerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.isProcessing).toBe(false);
  });

  it('processes batch with PENDING events, creates deliveries, updates events to DISPATCHED, enqueues to BullMQ', async () => {
    // 1. SELECT PENDING events FOR UPDATE SKIP LOCKED
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: mockEventId1,
        tenant_id: mockTenantId,
        topic_id: mockTopicId1,
        environment: 'PRODUCTION',
      },
      {
        id: mockEventId2,
        tenant_id: mockTenantId,
        topic_id: mockTopicId2,
        environment: 'PRODUCTION',
      },
    ]);

    // 2. Resolve active subscriptions from v_active_subscriptions
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        event_id: mockEventId1,
        tenant_id: mockTenantId,
        endpoint_id: mockEndpointId1,
        max_attempts: 5,
      },
      {
        event_id: mockEventId1,
        tenant_id: mockTenantId,
        endpoint_id: mockEndpointId2,
        max_attempts: 3,
      },
      {
        event_id: mockEventId2,
        tenant_id: mockTenantId,
        endpoint_id: mockEndpointId3,
        max_attempts: 4,
      },
    ]);

    // 3. INSERT INTO deliveries (3 subscriptions)
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: mockDeliveryId1,
        event_id: mockEventId1,
        endpoint_id: mockEndpointId1,
        max_attempts: 5,
      },
    ]);
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: mockDeliveryId2,
        event_id: mockEventId1,
        endpoint_id: mockEndpointId2,
        max_attempts: 3,
      },
    ]);
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: mockDeliveryId3,
        event_id: mockEventId2,
        endpoint_id: mockEndpointId3,
        max_attempts: 4,
      },
    ]);

    // 4. UPDATE events to DISPATCHED
    mockTx.$executeRaw.mockResolvedValueOnce(2);

    const result = await service.processNextBatch(100);

    expect(result).toEqual({
      processedEvents: 2,
      deliveriesCount: 3,
    });

    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(5);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
    expect(mockQueue.addBulk).toHaveBeenCalledWith([
      {
        name: 'webhook-delivery',
        data: {
          deliveryId: mockDeliveryId1,
          eventId: mockEventId1,
          endpointId: mockEndpointId1,
          tenantId: mockTenantId,
        },
        opts: {
          attempts: 5,
          removeOnComplete: true,
        },
      },
      {
        name: 'webhook-delivery',
        data: {
          deliveryId: mockDeliveryId2,
          eventId: mockEventId1,
          endpointId: mockEndpointId2,
          tenantId: mockTenantId,
        },
        opts: {
          attempts: 3,
          removeOnComplete: true,
        },
      },
      {
        name: 'webhook-delivery',
        data: {
          deliveryId: mockDeliveryId3,
          eventId: mockEventId2,
          endpointId: mockEndpointId3,
          tenantId: mockTenantId,
        },
        opts: {
          attempts: 4,
          removeOnComplete: true,
        },
      },
    ]);
    expect(service.isProcessing).toBe(false);
  });

  it('handles case where events have no active subscriptions (events marked DISPATCHED, 0 deliveries created)', async () => {
    // 1. SELECT PENDING events FOR UPDATE SKIP LOCKED
    mockTx.$queryRaw.mockResolvedValueOnce([
      {
        id: mockEventId1,
        tenant_id: mockTenantId,
        topic_id: mockTopicId1,
        environment: 'DEVELOPMENT',
      },
    ]);

    // 2. v_active_subscriptions returns empty array
    mockTx.$queryRaw.mockResolvedValueOnce([]);

    // 3. UPDATE events to DISPATCHED
    mockTx.$executeRaw.mockResolvedValueOnce(1);

    const result = await service.processNextBatch(100);

    expect(result).toEqual({
      processedEvents: 1,
      deliveriesCount: 0,
    });

    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockQueue.addBulk).not.toHaveBeenCalled();
    expect(service.isProcessing).toBe(false);
  });

  it('adaptive suspension: when 0 events, stops processing and stays idle', async () => {
    // Return empty PENDING events list
    mockTx.$queryRaw.mockResolvedValueOnce([]);

    await service.trigger();

    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(mockQueue.addBulk).not.toHaveBeenCalled();
    expect(service.isProcessing).toBe(false);
  });

  it('reactivation: when @OnEvent("outbox.wake") fires, triggers batch processing', async () => {
    const triggerSpy = jest.spyOn(service, 'trigger');

    mockTx.$queryRaw.mockResolvedValueOnce([]);

    await service.handleOutboxWake({ eventId: mockEventId1, tenantId: mockTenantId });

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
  });

  it('concurrency protection: ignores trigger if already processing', async () => {
    service.isProcessing = true;

    const triggerSpy = jest.spyOn(service, 'processNextBatch');

    await service.trigger();

    expect(triggerSpy).not.toHaveBeenCalled();
    expect(prismaService.$transaction).not.toHaveBeenCalled();

    const directBatch = await service.processNextBatch(100);
    expect(directBatch).toEqual({ processedEvents: 0, deliveriesCount: 0 });
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('bootstrap reconciliation: runs on application startup', async () => {
    const triggerSpy = jest.spyOn(service, 'trigger');

    mockTx.$queryRaw.mockResolvedValueOnce([]);

    await service.onApplicationBootstrap();

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
  });

  it('drains multiple sequential batches until empty and then suspends', async () => {
    // Batch 1: returns 1 event with 1 subscription and 1 delivery
    mockTx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: mockEventId1,
          tenant_id: mockTenantId,
          topic_id: mockTopicId1,
          environment: 'PRODUCTION',
        },
      ])
      .mockResolvedValueOnce([
        {
          event_id: mockEventId1,
          tenant_id: mockTenantId,
          endpoint_id: mockEndpointId1,
          max_attempts: 5,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: mockDeliveryId1,
          event_id: mockEventId1,
          endpoint_id: mockEndpointId1,
          max_attempts: 5,
        },
      ]);
    mockTx.$executeRaw.mockResolvedValueOnce(1);

    // Batch 2: returns 0 events (outbox drained)
    mockTx.$queryRaw.mockResolvedValueOnce([]);

    await service.trigger(100);

    // 2 transaction cycles
    expect(prismaService.$transaction).toHaveBeenCalledTimes(2);
    expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
    expect(service.isProcessing).toBe(false);
  });
});
