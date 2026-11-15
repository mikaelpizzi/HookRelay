import { Test, TestingModule } from '@nestjs/testing';
import { SchemaValidatorService } from './schema-validator.service';

describe('SchemaValidatorService', () => {
  let service: SchemaValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SchemaValidatorService],
    }).compile();

    service = module.get<SchemaValidatorService>(SchemaValidatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('compileAndValidateSchema', () => {
    it('should return true for a valid JSON Schema draft-07/2020-12', () => {
      const validSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          amount: { type: 'number', minimum: 0 },
        },
        required: ['orderId', 'amount'],
      };

      expect(service.compileAndValidateSchema(validSchema)).toBe(true);
    });

    it('should return true for standard schema without explicit $schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      expect(service.compileAndValidateSchema(schema)).toBe(true);
    });

    it('should return false for invalid schema definitions', () => {
      expect(service.compileAndValidateSchema(null as any)).toBe(false);
      expect(service.compileAndValidateSchema('not an object' as any)).toBe(false);
      expect(service.compileAndValidateSchema([] as any)).toBe(false);
      expect(
        service.compileAndValidateSchema({
          type: 'unsupported_type_name_123',
        }),
      ).toBe(false);
    });
  });

  describe('validate', () => {
    const topicId = 'topic-uuid-1';
    const schema = {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        price: { type: 'number', minimum: 1 },
      },
      required: ['eventId', 'price'],
      additionalProperties: false,
    };

    it('should validate a compliant payload successfully', () => {
      const payload = {
        eventId: 'evt_123',
        price: 99.5,
      };

      const result = service.validate(topicId, schema, payload);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return errors for invalid payload', () => {
      const payload = {
        eventId: 12345, // invalid type
        price: 0, // below minimum
        extra: 'not allowed',
      };

      const result = service.validate(topicId, schema, payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.some((e) => e.includes('eventId'))).toBe(true);
      expect(result.errors?.some((e) => e.includes('price'))).toBe(true);
    });

    it('should return error when schema itself is invalid', () => {
      const invalidSchema = { type: 'not_real_type' };
      const result = service.validate('bad-topic', invalidSchema, {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Invalid JSON Schema definition for topic payload',
      );
    });
  });

  describe('caching and invalidation', () => {
    const topicId = 'cached-topic-id';
    const schema = {
      type: 'object',
      properties: {
        userId: { type: 'string' },
      },
      required: ['userId'],
    };

    it('should cache compiled validator after first validation', () => {
      expect(service.hasCachedValidator(topicId)).toBe(false);

      service.validate(topicId, schema, { userId: 'usr_abc' });

      expect(service.hasCachedValidator(topicId)).toBe(true);
    });

    it('should reuse cached validator on subsequent calls', () => {
      service.validate(topicId, schema, { userId: 'usr_abc' });
      expect(service.hasCachedValidator(topicId)).toBe(true);

      const result = service.validate(topicId, schema, { userId: 'usr_xyz' });
      expect(result.valid).toBe(true);
    });

    it('should evict validator from cache when invalidate is called', () => {
      service.validate(topicId, schema, { userId: 'usr_abc' });
      expect(service.hasCachedValidator(topicId)).toBe(true);

      service.invalidate(topicId);
      expect(service.hasCachedValidator(topicId)).toBe(false);
    });

    it('should allow compiling updated schema after invalidation', () => {
      service.validate(topicId, schema, { userId: 'usr_abc' });
      service.invalidate(topicId);

      const updatedSchema = {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          version: { type: 'number' },
        },
        required: ['userId', 'version'],
      };

      const resultOld = service.validate(topicId, updatedSchema, {
        userId: 'usr_abc',
      });
      expect(resultOld.valid).toBe(false);
      expect(resultOld.errors?.some((e) => e.includes('version'))).toBe(true);

      const resultNew = service.validate(topicId, updatedSchema, {
        userId: 'usr_abc',
        version: 2,
      });
      expect(resultNew.valid).toBe(true);
    });
  });
});
