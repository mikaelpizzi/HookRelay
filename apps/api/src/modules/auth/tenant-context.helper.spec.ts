import { TenantContextHelper } from './tenant-context.helper';
import { TenantContextStorage } from './tenant-context.storage';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';

describe('TenantContextHelper', () => {
  let helper: TenantContextHelper;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      withTenantContext: jest.fn((tenantId, cb) => {
        const mockTx = { $executeRaw: jest.fn() };
        return cb(mockTx);
      }),
    };
    helper = new TenantContextHelper(mockPrisma as unknown as PrismaService);
  });

  it('should delegate runWithTenant to prisma.withTenantContext', async () => {
    const callback = jest.fn().mockResolvedValue('success');
    const result = await helper.runWithTenant('tenant-123', callback);

    expect(result).toBe('success');
    expect(mockPrisma.withTenantContext).toHaveBeenCalledWith('tenant-123', callback);
  });

  it('should throw UnauthorizedException if runInCurrentContext is called with no active context', async () => {
    await expect(helper.runInCurrentContext(jest.fn())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should run inside active TenantContextStorage when available', async () => {
    const callback = jest.fn().mockResolvedValue('context-success');

    const result = await TenantContextStorage.run(
      { tenantId: 'tenant-from-storage' },
      () => helper.runInCurrentContext(callback),
    );

    expect(result).toBe('context-success');
    expect(mockPrisma.withTenantContext).toHaveBeenCalledWith(
      'tenant-from-storage',
      callback,
    );
  });
});
