import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { SchemaValidatorService } from './schema-validator.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

describe('CatalogService', () => {
  let service: CatalogService;
  let prismaService: any;
  let schemaValidatorService: any;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockTopicId = '22222222-2222-2222-2222-222222222222';

  const mockTopic = {
    id: mockTopicId,
    tenant_id: mockTenantId,
    name: 'order.created',
    description: 'Fired when order is created',
    payload_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
    max_attempts: 5,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    prismaService = {
      withTenantContext: jest.fn().mockImplementation((_tenantId, callback) => {
        const tx = {
          event_topics: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
          },
        };
        return callback(tx);
      }),
    };

    schemaValidatorService = {
      compileAndValidateSchema: jest.fn().mockReturnValue(true),
      validate: jest.fn().mockReturnValue({ valid: true }),
      invalidate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: prismaService },
        { provide: SchemaValidatorService, useValue: schemaValidatorService },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTopic', () => {
    const validDto = {
      name: 'order.created',
      description: 'Order created event',
      payloadSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    };

    it('should create a topic successfully with valid name and schema', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            create: jest.fn().mockResolvedValue(mockTopic),
          },
        }),
      );

      const result = await service.createTopic(mockTenantId, validDto);

      expect(result).toEqual(mockTopic);
      expect(schemaValidatorService.compileAndValidateSchema).toHaveBeenCalledWith(
        validDto.payloadSchema,
      );
      expect(prismaService.withTenantContext).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Function),
      );
    });

    it('should allow multi-segment topic names like payment.invoice.paid', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            create: jest.fn().mockResolvedValue({
              ...mockTopic,
              name: 'payment.invoice.paid',
            }),
          },
        }),
      );

      const result = await service.createTopic(mockTenantId, {
        ...validDto,
        name: 'payment.invoice.paid',
      });

      expect(result.name).toBe('payment.invoice.paid');
    });

    it('should reject invalid topic names without dots (e.g. invalid_topic)', async () => {
      await expect(
        service.createTopic(mockTenantId, {
          ...validDto,
          name: 'invalid_topic',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject uppercase topic names (e.g. ORDER.CREATED)', async () => {
      await expect(
        service.createTopic(mockTenantId, {
          ...validDto,
          name: 'ORDER.CREATED',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid topic names with special characters', async () => {
      await expect(
        service.createTopic(mockTenantId, {
          ...validDto,
          name: 'order..created',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createTopic(mockTenantId, {
          ...validDto,
          name: 'order@created',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if payloadSchema is not valid JSON Schema', async () => {
      schemaValidatorService.compileAndValidateSchema.mockReturnValue(false);

      await expect(
        service.createTopic(mockTenantId, {
          name: 'order.created',
          payloadSchema: { type: 'invalid_schema_type' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if maxAttempts is out of range', async () => {
      await expect(
        service.createTopic(mockTenantId, {
          ...validDto,
          maxAttempts: 15,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createTopic(mockTenantId, {
          ...validDto,
          maxAttempts: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException on duplicate topic name (P2002)', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            create: jest.fn().mockRejectedValue({ code: 'P2002' }),
          },
        }),
      );

      await expect(
        service.createTopic(mockTenantId, validDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listTopics', () => {
    it('should return list of topics for the given tenant', async () => {
      const mockList = [mockTopic];
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findMany: jest.fn().mockResolvedValue(mockList),
          },
        }),
      );

      const result = await service.listTopics(mockTenantId);

      expect(result).toEqual(mockList);
      expect(prismaService.withTenantContext).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Function),
      );
    });
  });

  describe('getTopicById', () => {
    it('should return topic if found', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(mockTopic),
          },
        }),
      );

      const result = await service.getTopicById(mockTenantId, mockTopicId);

      expect(result).toEqual(mockTopic);
    });

    it('should throw NotFoundException if topic does not exist', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.getTopicById(mockTenantId, 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTopic', () => {
    it('should update description without invalidating schema validator cache', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(mockTopic),
            update: jest.fn().mockResolvedValue({
              ...mockTopic,
              description: 'Updated description',
            }),
          },
        }),
      );

      const result = await service.updateTopic(mockTenantId, mockTopicId, {
        description: 'Updated description',
      });

      expect(result.description).toBe('Updated description');
      expect(schemaValidatorService.invalidate).not.toHaveBeenCalled();
    });

    it('should validate new schema, invalidate cache and update topic', async () => {
      const newSchema = {
        type: 'object',
        properties: { orderId: { type: 'string' }, version: { type: 'number' } },
        required: ['orderId', 'version'],
      };

      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(mockTopic),
            update: jest.fn().mockResolvedValue({
              ...mockTopic,
              payload_schema: newSchema,
            }),
          },
        }),
      );

      const result = await service.updateTopic(mockTenantId, mockTopicId, {
        payloadSchema: newSchema,
      });

      expect(schemaValidatorService.compileAndValidateSchema).toHaveBeenCalledWith(
        newSchema,
      );
      expect(schemaValidatorService.invalidate).toHaveBeenCalledWith(mockTopicId);
      expect(result.payload_schema).toEqual(newSchema);
    });

    it('should throw BadRequestException if updated schema is invalid', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(mockTopic),
          },
        }),
      );

      schemaValidatorService.compileAndValidateSchema.mockReturnValue(false);

      await expect(
        service.updateTopic(mockTenantId, mockTopicId, {
          payloadSchema: { type: 'broken_type' },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(schemaValidatorService.invalidate).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if updating non-existent topic', async () => {
      prismaService.withTenantContext.mockImplementation((_tId: string, cb: any) =>
        cb({
          event_topics: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
      );

      await expect(
        service.updateTopic(mockTenantId, 'missing-id', {
          description: 'test',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
