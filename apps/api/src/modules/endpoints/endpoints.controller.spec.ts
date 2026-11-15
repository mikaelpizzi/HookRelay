import { Test, TestingModule } from '@nestjs/testing';
import { environment_type } from '@prisma/client';
import { EndpointsController } from './endpoints.controller';
import { EndpointsService } from './endpoints.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

describe('EndpointsController', () => {
  let controller: EndpointsController;
  let endpointsService: any;

  const mockTenantId = 'tenant-123';
  const mockEndpointId = 'endpoint-123';
  const mockTopicId = 'topic-123';

  const mockEndpoint = {
    id: mockEndpointId,
    tenant_id: mockTenantId,
    url: 'https://example.com/webhook',
    description: 'Webhook endpoint',
    signing_secret: 'whsec_test',
    is_active: true,
    circuit_status: 'CLOSED',
    failure_threshold: 5,
  };

  const mockSubscription = {
    endpoint_id: mockEndpointId,
    topic_id: mockTopicId,
    created_at: new Date(),
  };

  beforeEach(async () => {
    endpointsService = {
      createEndpoint: jest.fn().mockResolvedValue(mockEndpoint),
      listEndpoints: jest.fn().mockResolvedValue([mockEndpoint]),
      getEndpointById: jest.fn().mockResolvedValue(mockEndpoint),
      updateEndpoint: jest.fn().mockResolvedValue(mockEndpoint),
      deleteEndpoint: jest
        .fn()
        .mockResolvedValue({ ...mockEndpoint, is_active: false }),
      subscribeTopic: jest.fn().mockResolvedValue(mockSubscription),
      listSubscriptions: jest.fn().mockResolvedValue([mockSubscription]),
      unsubscribeTopic: jest.fn().mockResolvedValue(mockSubscription),
      resetCircuit: jest.fn().mockResolvedValue({
        ...mockEndpoint,
        circuit_status: 'CLOSED',
        consecutive_failures: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointsController],
      providers: [
        { provide: EndpointsService, useValue: endpointsService },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EndpointsController>(EndpointsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create an endpoint', async () => {
    const dto = {
      url: 'https://example.com/webhook',
      description: 'Webhook endpoint',
      failureThreshold: 5,
    };

    const result = await controller.createEndpoint(mockTenantId, dto);
    expect(result).toEqual(mockEndpoint);
    expect(endpointsService.createEndpoint).toHaveBeenCalledWith(
      mockTenantId,
      dto,
    );
  });

  it('should list endpoints for tenant', async () => {
    const result = await controller.listEndpoints(mockTenantId);
    expect(result).toEqual([mockEndpoint]);
    expect(endpointsService.listEndpoints).toHaveBeenCalledWith(mockTenantId);
  });

  it('should get endpoint by id', async () => {
    const result = await controller.getEndpointById(
      mockTenantId,
      mockEndpointId,
    );
    expect(result).toEqual(mockEndpoint);
    expect(endpointsService.getEndpointById).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
    );
  });

  it('should update endpoint', async () => {
    const dto = { description: 'Updated' };
    const result = await controller.updateEndpoint(
      mockTenantId,
      mockEndpointId,
      dto,
    );
    expect(result).toEqual(mockEndpoint);
    expect(endpointsService.updateEndpoint).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
      dto,
    );
  });

  it('should soft delete endpoint', async () => {
    const result = await controller.deleteEndpoint(
      mockTenantId,
      mockEndpointId,
    );
    expect(result.is_active).toBe(false);
    expect(endpointsService.deleteEndpoint).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
    );
  });

  it('should subscribe endpoint to topic', async () => {
    const dto = {
      topicId: mockTopicId,
      environment: environment_type.PRODUCTION,
    };

    const result = await controller.subscribeTopic(
      mockTenantId,
      mockEndpointId,
      dto,
    );
    expect(result).toEqual(mockSubscription);
    expect(endpointsService.subscribeTopic).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
      dto,
    );
  });

  it('should list subscriptions for endpoint', async () => {
    const result = await controller.listSubscriptions(
      mockTenantId,
      mockEndpointId,
    );
    expect(result).toEqual([mockSubscription]);
    expect(endpointsService.listSubscriptions).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
    );
  });

  it('should unsubscribe endpoint from topic', async () => {
    const result = await controller.unsubscribeTopic(
      mockTenantId,
      mockEndpointId,
      mockTopicId,
    );
    expect(result).toEqual(mockSubscription);
    expect(endpointsService.unsubscribeTopic).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
      mockTopicId,
    );
  });

  it('should reset endpoint circuit', async () => {
    const result = await controller.resetCircuit(
      mockTenantId,
      mockEndpointId,
    );
    expect(result.circuit_status).toBe('CLOSED');
    expect(endpointsService.resetCircuit).toHaveBeenCalledWith(
      mockTenantId,
      mockEndpointId,
    );
  });
});
