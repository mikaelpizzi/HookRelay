import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { environment_type } from '@prisma/client';
import { EndpointsService } from './endpoints.service';
import { SsrfValidatorService } from './ssrf-validator.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

describe('EndpointsService', () => {
  let service: EndpointsService;
  let prismaService: any;
  let ssrfValidator: any;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockEndpointId = '22222222-2222-2222-2222-222222222222';
  const mockTopicId = '33333333-3333-3333-3333-333333333333';

  const mockEndpoint = {
    id: mockEndpointId,
    tenant_id: mockTenantId,
    url: 'https://example.com/webhook',
    description: 'Production webhook endpoint',
    signing_secret:
      'whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    is_active: true,
    circuit_status: 'CLOSED',
    consecutive_failures: 0,
    failure_threshold: 5,
    circuit_opened_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    endpoint_environments: [
      { endpoint_id: mockEndpointId, environment: environment_type.PRODUCTION },
      { endpoint_id: mockEndpointId, environment: environment_type.SANDBOX },
    ],
  };

  const mockTopic = {
    id: mockTopicId,
    tenant_id: mockTenantId,
    name: 'order.created',
    description: 'Order created event',
    payload_schema: { type: 'object' },
    max_attempts: 5,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prismaService = {
      withTenantContext: jest.fn().mockImplementation((_tenantId, callback) => {
        const tx = {
          webhook_endpoints: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
          event_topics: {
            findFirst: jest.fn(),
          },
          endpoint_environments: {
            upsert: jest.fn(),
          },
          topic_environments: {
            upsert: jest.fn(),
          },
          endpoint_topic_subscriptions: {
            upsert: jest.fn(),
            findMany: jest.fn(),
            findUnique: jest.fn(),
            delete: jest.fn(),
          },
        };
        return callback(tx);
      }),
    };

    ssrfValidator = {
      validateUrl: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: SsrfValidatorService, useValue: ssrfValidator },
      ],
    }).compile();

    service = module.get<EndpointsService>(EndpointsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createEndpoint', () => {
    const validDto = {
      url: 'https://example.com/webhook',
      description: 'Webhook receiver',
      failureThreshold: 5,
    };

    it('should validate SSRF, generate a whsec_ secret, and insert into webhook_endpoints and environments', async () => {
      let createdData: any = null;
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            create: jest.fn().mockImplementation(({ data }) => {
              createdData = data;
              return {
                ...mockEndpoint,
                signing_secret: data.signing_secret,
              };
            }),
          },
        }),
      );

      const result = await service.createEndpoint(mockTenantId, validDto);

      expect(ssrfValidator.validateUrl).toHaveBeenCalledWith(validDto.url);
      expect(result).toBeDefined();
      expect(createdData).toBeDefined();
      expect(createdData.tenant_id).toBe(mockTenantId);
      expect(createdData.url).toBe(validDto.url);
      expect(createdData.signing_secret).toMatch(/^whsec_[0-9a-f]{64}$/);
      expect(createdData.endpoint_environments.create).toEqual([
        { environment: environment_type.PRODUCTION },
        { environment: environment_type.SANDBOX },
      ]);
    });

    it('should respect custom environments when provided', async () => {
      let createdData: any = null;
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            create: jest.fn().mockImplementation(({ data }) => {
              createdData = data;
              return mockEndpoint;
            }),
          },
        }),
      );

      await service.createEndpoint(mockTenantId, {
        ...validDto,
        environments: [environment_type.PRODUCTION],
      });

      expect(createdData.endpoint_environments.create).toEqual([
        { environment: environment_type.PRODUCTION },
      ]);
    });

    it('should reject invalid URL', async () => {
      await expect(
        service.createEndpoint(mockTenantId, { url: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject SSRF blocked URL', async () => {
      ssrfValidator.validateUrl.mockRejectedValue(
        new BadRequestException('SSRF_BLOCKED: Loopback address'),
      );

      await expect(
        service.createEndpoint(mockTenantId, { url: 'http://127.0.0.1:8080' }),
      ).rejects.toThrow(/SSRF_BLOCKED/);
    });

    it('should reject invalid failure threshold (< 1 or > 50)', async () => {
      await expect(
        service.createEndpoint(mockTenantId, {
          ...validDto,
          failureThreshold: 0,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createEndpoint(mockTenantId, {
          ...validDto,
          failureThreshold: 51,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listEndpoints', () => {
    it('should list all endpoints for the authenticated tenant', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findMany: jest.fn().mockResolvedValue([mockEndpoint]),
          },
        }),
      );

      const result = await service.listEndpoints(mockTenantId);
      expect(result).toEqual([mockEndpoint]);
    });
  });

  describe('getEndpointById', () => {
    it('should return endpoint if found', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
          },
        }),
      );

      const result = await service.getEndpointById(mockTenantId, mockEndpointId);
      expect(result).toEqual(mockEndpoint);
    });

    it('should throw NotFoundException if endpoint does not exist for tenant', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.getEndpointById(mockTenantId, 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEndpoint', () => {
    it('should update endpoint properties successfully', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
            update: jest.fn().mockResolvedValue({
              ...mockEndpoint,
              description: 'Updated description',
            }),
          },
        }),
      );

      const result = await service.updateEndpoint(mockTenantId, mockEndpointId, {
        description: 'Updated description',
      });

      expect(result.description).toBe('Updated description');
    });

    it('should validate SSRF if URL is modified', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
            update: jest.fn().mockResolvedValue({
              ...mockEndpoint,
              url: 'https://newdomain.com/hook',
            }),
          },
        }),
      );

      await service.updateEndpoint(mockTenantId, mockEndpointId, {
        url: 'https://newdomain.com/hook',
      });

      expect(ssrfValidator.validateUrl).toHaveBeenCalledWith(
        'https://newdomain.com/hook',
      );
    });

    it('should throw NotFoundException if updating non-existent endpoint', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.updateEndpoint(mockTenantId, 'non-existent', {
          description: 'test',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteEndpoint', () => {
    it('should soft delete endpoint by setting is_active = false', async () => {
      let updatedData: any = null;
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
            update: jest.fn().mockImplementation(({ data }) => {
              updatedData = data;
              return { ...mockEndpoint, is_active: false };
            }),
          },
        }),
      );

      const result = await service.deleteEndpoint(mockTenantId, mockEndpointId);

      expect(updatedData).toEqual({ is_active: false });
      expect(result.is_active).toBe(false);
    });
  });

  describe('subscribeTopic (5NF Decomposition)', () => {
    const subscribeDto = {
      topicId: mockTopicId,
      environment: environment_type.PRODUCTION,
    };

    it('should verify topic and endpoint ownership and upsert into 5NF projection tables', async () => {
      const mockUpsertTopicEnv = jest.fn().mockResolvedValue({});
      const mockUpsertEndpointEnv = jest.fn().mockResolvedValue({});
      const mockUpsertSub = jest.fn().mockResolvedValue({
        endpoint_id: mockEndpointId,
        topic_id: mockTopicId,
      });

      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
          },
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(mockTopic),
          },
          topic_environments: {
            upsert: mockUpsertTopicEnv,
          },
          endpoint_environments: {
            upsert: mockUpsertEndpointEnv,
          },
          endpoint_topic_subscriptions: {
            upsert: mockUpsertSub,
          },
        }),
      );

      const result = await service.subscribeTopic(
        mockTenantId,
        mockEndpointId,
        subscribeDto,
      );

      expect(result).toBeDefined();
      expect(mockUpsertTopicEnv).toHaveBeenCalledWith({
        where: {
          topic_id_environment: {
            topic_id: mockTopicId,
            environment: environment_type.PRODUCTION,
          },
        },
        create: {
          topic_id: mockTopicId,
          environment: environment_type.PRODUCTION,
        },
        update: {},
      });
      expect(mockUpsertEndpointEnv).toHaveBeenCalledWith({
        where: {
          endpoint_id_environment: {
            endpoint_id: mockEndpointId,
            environment: environment_type.PRODUCTION,
          },
        },
        create: {
          endpoint_id: mockEndpointId,
          environment: environment_type.PRODUCTION,
        },
        update: {},
      });
      expect(mockUpsertSub).toHaveBeenCalledWith({
        where: {
          endpoint_id_topic_id: {
            endpoint_id: mockEndpointId,
            topic_id: mockTopicId,
          },
        },
        create: {
          endpoint_id: mockEndpointId,
          topic_id: mockTopicId,
        },
        update: {},
      });
    });

    it('should throw NotFoundException if topic does not belong to tenant', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
          },
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.subscribeTopic(mockTenantId, mockEndpointId, subscribeDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if environment is invalid', async () => {
      await expect(
        service.subscribeTopic(mockTenantId, mockEndpointId, {
          topicId: mockTopicId,
          environment: 'STAGING' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listSubscriptions', () => {
    it('should list active subscriptions for an endpoint', async () => {
      const mockSubscriptions = [
        {
          endpoint_id: mockEndpointId,
          topic_id: mockTopicId,
          created_at: new Date(),
          event_topics: mockTopic,
        },
      ];

      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
          },
          endpoint_topic_subscriptions: {
            findMany: jest.fn().mockResolvedValue(mockSubscriptions),
          },
        }),
      );

      const result = await service.listSubscriptions(
        mockTenantId,
        mockEndpointId,
      );
      expect(result).toEqual(mockSubscriptions);
    });
  });

  describe('unsubscribeTopic', () => {
    it('should delete subscription record when found', async () => {
      const mockDelete = jest.fn().mockResolvedValue({
        endpoint_id: mockEndpointId,
        topic_id: mockTopicId,
      });

      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
          },
          endpoint_topic_subscriptions: {
            findUnique: jest.fn().mockResolvedValue({
              endpoint_id: mockEndpointId,
              topic_id: mockTopicId,
            }),
            delete: mockDelete,
          },
        }),
      );

      const result = await service.unsubscribeTopic(
        mockTenantId,
        mockEndpointId,
        mockTopicId,
      );

      expect(result).toBeDefined();
      expect(mockDelete).toHaveBeenCalledWith({
        where: {
          endpoint_id_topic_id: {
            endpoint_id: mockEndpointId,
            topic_id: mockTopicId,
          },
        },
      });
    });

    it('should throw NotFoundException if subscription does not exist', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          webhook_endpoints: {
            findFirst: jest.fn().mockResolvedValue(mockEndpoint),
          },
          endpoint_topic_subscriptions: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.unsubscribeTopic(mockTenantId, mockEndpointId, mockTopicId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
