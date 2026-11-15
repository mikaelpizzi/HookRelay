import { Test, TestingModule } from '@nestjs/testing';
import { delivery_status } from '@prisma/client';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

describe('DeliveriesController', () => {
  let controller: DeliveriesController;
  let deliveriesService: any;

  const mockTenantId = 'tenant-123';
  const mockDeliveryId = 'delivery-123';

  const mockDelivery = {
    id: mockDeliveryId,
    status: delivery_status.PENDING,
    attempt_count: 0,
    max_attempts: 5,
    delivery_attempts: [],
  };

  beforeEach(async () => {
    deliveriesService = {
      listDeliveries: jest.fn().mockResolvedValue({
        items: [mockDelivery],
        total: 1,
        limit: 10,
        offset: 0,
      }),
      getDeliveryById: jest.fn().mockResolvedValue(mockDelivery),
      replayDelivery: jest.fn().mockResolvedValue({
        replayed: true,
        deliveryId: mockDeliveryId,
        status: delivery_status.PENDING,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliveriesController],
      providers: [
        { provide: DeliveriesService, useValue: deliveriesService },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DeliveriesController>(DeliveriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should list deliveries', async () => {
    const query = { limit: 10, offset: 0 };
    const result = await controller.listDeliveries(mockTenantId, query);
    expect(result.items).toEqual([mockDelivery]);
    expect(deliveriesService.listDeliveries).toHaveBeenCalledWith(
      mockTenantId,
      query,
    );
  });

  it('should get delivery by id', async () => {
    const result = await controller.getDeliveryById(
      mockTenantId,
      mockDeliveryId,
    );
    expect(result).toEqual(mockDelivery);
    expect(deliveriesService.getDeliveryById).toHaveBeenCalledWith(
      mockTenantId,
      mockDeliveryId,
    );
  });

  it('should replay delivery', async () => {
    const result = await controller.replayDelivery(
      mockTenantId,
      mockDeliveryId,
    );
    expect(result.replayed).toBe(true);
    expect(deliveriesService.replayDelivery).toHaveBeenCalledWith(
      mockTenantId,
      mockDeliveryId,
    );
  });
});
