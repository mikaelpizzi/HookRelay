import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      api_keys: {
        findUnique: jest.fn(),
        update: jest.fn().mockReturnValue(Promise.resolve({})),
      },
    };
    guard = new ApiKeyGuard(mockPrisma as unknown as PrismaService);
  });

  const createMockContext = (headers: Record<string, string | undefined>): ExecutionContext => {
    const request: any = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('should throw UnauthorizedException if X-API-Key header is missing', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if X-API-Key header is empty', async () => {
    const context = createMockContext({ 'x-api-key': '   ' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if API Key does not exist in DB', async () => {
    mockPrisma.api_keys.findUnique.mockResolvedValue(null);
    const context = createMockContext({ 'x-api-key': 'hr_live_nonexistent' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if API Key is revoked', async () => {
    mockPrisma.api_keys.findUnique.mockResolvedValue({
      id: 'key-1',
      tenant_id: 'tenant-1',
      environment: 'PRODUCTION',
      revoked_at: new Date(),
      expires_at: null,
      tenants: { is_active: true },
    });

    const context = createMockContext({ 'x-api-key': 'hr_live_revoked' });
    await expect(guard.canActivate(context)).rejects.toThrow('API Key has been revoked');
  });

  it('should throw UnauthorizedException if API Key has expired', async () => {
    mockPrisma.api_keys.findUnique.mockResolvedValue({
      id: 'key-1',
      tenant_id: 'tenant-1',
      environment: 'PRODUCTION',
      revoked_at: null,
      expires_at: new Date(Date.now() - 10000), // in the past
      tenants: { is_active: true },
    });

    const context = createMockContext({ 'x-api-key': 'hr_live_expired' });
    await expect(guard.canActivate(context)).rejects.toThrow('API Key has expired');
  });

  it('should throw UnauthorizedException if Tenant is inactive', async () => {
    mockPrisma.api_keys.findUnique.mockResolvedValue({
      id: 'key-1',
      tenant_id: 'tenant-1',
      environment: 'PRODUCTION',
      revoked_at: null,
      expires_at: null,
      tenants: { is_active: false },
    });

    const context = createMockContext({ 'x-api-key': 'hr_live_inactive' });
    await expect(guard.canActivate(context)).rejects.toThrow('Tenant is inactive or not found');
  });

  it('should authenticate valid API Key, set context on req, and trigger last_used_at update', async () => {
    const rawKey = 'hr_live_valid_secret_key_12345';
    const expectedHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    mockPrisma.api_keys.findUnique.mockResolvedValue({
      id: 'key-123',
      tenant_id: 'tenant-456',
      environment: 'PRODUCTION',
      revoked_at: null,
      expires_at: new Date(Date.now() + 100000),
      tenants: { id: 'tenant-456', is_active: true },
    });

    const request: any = { headers: { 'x-api-key': rawKey } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockPrisma.api_keys.findUnique).toHaveBeenCalledWith({
      where: { key_hash: expectedHash },
      include: { tenants: true },
    });
    expect(request.tenantId).toBe('tenant-456');
    expect(request.environment).toBe('PRODUCTION');
    expect(request.apiKeyId).toBe('key-123');
    expect(mockPrisma.api_keys.update).toHaveBeenCalledWith({
      where: { id: 'key-123' },
      data: { last_used_at: expect.any(Date) },
    });
  });
});
