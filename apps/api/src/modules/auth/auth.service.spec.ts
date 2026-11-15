import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenants: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      api_keys: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new AuthService(mockPrisma as unknown as PrismaService);
  });

  describe('createTenant', () => {
    it('should throw BadRequestException if name is shorter than 2 chars', async () => {
      await expect(
        service.createTenant({ name: 'A', slug: 'valid-slug' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if slug is invalid', async () => {
      await expect(
        service.createTenant({ name: 'Acme Corp', slug: 'Invalid Slug!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if slug already exists', async () => {
      mockPrisma.tenants.findUnique.mockResolvedValue({ id: 'existing-id', slug: 'acme' });

      await expect(
        service.createTenant({ name: 'Acme Corp', slug: 'acme' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create and return tenant with valid data', async () => {
      mockPrisma.tenants.findUnique.mockResolvedValue(null);
      mockPrisma.tenants.create.mockResolvedValue({
        id: 'new-id',
        name: 'Acme Corp',
        slug: 'acme',
        is_active: true,
      });

      const result = await service.createTenant({ name: 'Acme Corp', slug: 'acme' });
      expect(result.id).toBe('new-id');
      expect(mockPrisma.tenants.create).toHaveBeenCalledWith({
        data: {
          name: 'Acme Corp',
          slug: 'acme',
        },
      });
    });
  });

  describe('createApiKey', () => {
    it('should throw NotFoundException if tenant does not exist', async () => {
      mockPrisma.tenants.findUnique.mockResolvedValue(null);

      await expect(
        service.createApiKey('nonexistent', { name: 'Prod Key' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if expiresAt is in the past', async () => {
      mockPrisma.tenants.findUnique.mockResolvedValue({ id: 'tenant-1' });

      await expect(
        service.createApiKey('tenant-1', {
          name: 'Prod Key',
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate a 32-byte key, hash with SHA-256 and persist only prefix and hash', async () => {
      mockPrisma.tenants.findUnique.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.api_keys.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'key-1',
          ...data,
          created_at: new Date(),
        }),
      );

      const result = await service.createApiKey('tenant-1', {
        name: 'Production Key',
        environment: 'PRODUCTION',
      });

      expect(result.rawKey).toBeDefined();
      expect(result.rawKey.startsWith('hr_live_')).toBe(true);
      expect(result.keyPrefix).toBe(result.rawKey.slice(0, 8));

      // Verify what was passed to Prisma
      const expectedHash = crypto
        .createHash('sha256')
        .update(result.rawKey)
        .digest('hex');

      expect(mockPrisma.api_keys.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          name: 'Production Key',
          key_prefix: result.keyPrefix,
          key_hash: expectedHash,
          environment: 'PRODUCTION',
          expires_at: null,
        },
      });
    });
  });
});
