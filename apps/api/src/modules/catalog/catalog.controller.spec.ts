import { Test, TestingModule } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

describe('CatalogController', () => {
  let controller: CatalogController;
  let catalogService: any;

  const mockTenantId = 'tenant-123';
  const mockTopic = {
    id: 'topic-123',
    tenant_id: mockTenantId,
    name: 'order.created',
    description: 'Order event',
    payload_schema: { type: 'object' },
    max_attempts: 5,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    catalogService = {
      createTopic: jest.fn().mockResolvedValue(mockTopic),
      listTopics: jest.fn().mockResolvedValue([mockTopic]),
      getTopicById: jest.fn().mockResolvedValue(mockTopic),
      updateTopic: jest.fn().mockResolvedValue(mockTopic),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [
        { provide: CatalogService, useValue: catalogService },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CatalogController>(CatalogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create a topic', async () => {
    const dto = {
      name: 'order.created',
      payloadSchema: { type: 'object' },
    };

    const result = await controller.createTopic(mockTenantId, dto);
    expect(result).toEqual(mockTopic);
    expect(catalogService.createTopic).toHaveBeenCalledWith(mockTenantId, dto);
  });

  it('should list topics', async () => {
    const result = await controller.listTopics(mockTenantId);
    expect(result).toEqual([mockTopic]);
    expect(catalogService.listTopics).toHaveBeenCalledWith(mockTenantId);
  });

  it('should get topic by id', async () => {
    const result = await controller.getTopicById(mockTenantId, 'topic-123');
    expect(result).toEqual(mockTopic);
    expect(catalogService.getTopicById).toHaveBeenCalledWith(
      mockTenantId,
      'topic-123',
    );
  });

  it('should update topic', async () => {
    const dto = { description: 'Updated' };
    const result = await controller.updateTopic(mockTenantId, 'topic-123', dto);
    expect(result).toEqual(mockTopic);
    expect(catalogService.updateTopic).toHaveBeenCalledWith(
      mockTenantId,
      'topic-123',
      dto,
    );
  });
});
