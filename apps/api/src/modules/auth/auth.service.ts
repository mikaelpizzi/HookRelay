import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { environment_type, tenants } from '@prisma/client';

export interface GeneratedApiKeyResponse {
  id: string;
  tenantId: string;
  name: string;
  environment: environment_type;
  keyPrefix: string;
  rawKey: string;
  expiresAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto): Promise<tenants> {
    if (!dto.name || dto.name.trim().length < 2) {
      throw new BadRequestException('Tenant name must be at least 2 characters long');
    }

    const trimmedSlug = dto.slug ? dto.slug.trim().toLowerCase() : '';
    const slugRegex = /^[a-z0-9-]+$/;
    if (!trimmedSlug || !slugRegex.test(trimmedSlug)) {
      throw new BadRequestException(
        'Tenant slug must only contain lowercase alphanumeric characters and hyphens',
      );
    }

    const existing = await this.prisma.tenants.findUnique({
      where: { slug: trimmedSlug },
    });

    if (existing) {
      throw new ConflictException(`Tenant with slug '${trimmedSlug}' already exists`);
    }

    return this.prisma.tenants.create({
      data: {
        name: dto.name.trim(),
        slug: trimmedSlug,
      },
    });
  }

  async getTenantById(id: string): Promise<tenants> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID '${id}' not found`);
    }

    return tenant;
  }

  async createApiKey(
    tenantId: string,
    dto: CreateApiKeyDto,
  ): Promise<GeneratedApiKeyResponse> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID '${tenantId}' not found`);
    }

    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('API key name is required');
    }

    const environment: environment_type =
      dto.environment === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';

    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be a valid future ISO-8601 date');
      }
    }

    const envPrefix = environment === 'SANDBOX' ? 'test_' : 'live_';
    const randomEntropy = crypto.randomBytes(32).toString('hex');
    const rawKey = `hr_${envPrefix}${randomEntropy}`;
    const keyPrefix = rawKey.slice(0, 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const created = await this.prisma.api_keys.create({
      data: {
        tenant_id: tenantId,
        name: dto.name.trim(),
        key_prefix: keyPrefix,
        key_hash: keyHash,
        environment,
        expires_at: expiresAt,
      },
    });

    return {
      id: created.id,
      tenantId: created.tenant_id,
      name: created.name,
      environment: created.environment,
      keyPrefix: created.key_prefix,
      rawKey,
      expiresAt: created.expires_at,
      createdAt: created.created_at,
    };
  }

  async listApiKeys(tenantId: string) {
    return this.prisma.api_keys.findMany({
      where: {
        tenant_id: tenantId,
        revoked_at: null,
      },
      select: {
        id: true,
        tenant_id: true,
        name: true,
        key_prefix: true,
        environment: true,
        last_used_at: true,
        expires_at: true,
        created_at: true,
      },
    });
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<void> {
    const key = await this.prisma.api_keys.findFirst({
      where: { id: keyId, tenant_id: tenantId },
    });

    if (!key) {
      throw new NotFoundException('API Key not found for this tenant');
    }

    await this.prisma.api_keys.update({
      where: { id: keyId },
      data: { revoked_at: new Date() },
    });
  }
}
