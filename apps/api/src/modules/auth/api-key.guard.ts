import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Request } from 'express';
import { environment_type } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

declare module 'express' {
  interface Request {
    tenantId?: string;
    environment?: environment_type;
    apiKeyId?: string;
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const headerValue =
      request.headers['x-api-key'] || (request.headers['X-API-KEY'] as string);

    if (!headerValue || typeof headerValue !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const trimmedKey = headerValue.trim();
    if (!trimmedKey) {
      throw new UnauthorizedException('Empty X-API-Key header');
    }

    const keyHash = crypto
      .createHash('sha256')
      .update(trimmedKey)
      .digest('hex');

    const apiKey = await this.prisma.api_keys.findUnique({
      where: { key_hash: keyHash },
      include: { tenants: true },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API Key');
    }

    if (apiKey.revoked_at !== null) {
      throw new UnauthorizedException('API Key has been revoked');
    }

    if (apiKey.expires_at && apiKey.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedException('API Key has expired');
    }

    if (!apiKey.tenants || !apiKey.tenants.is_active) {
      throw new UnauthorizedException('Tenant is inactive or not found');
    }

    request.tenantId = apiKey.tenant_id;
    request.environment = apiKey.environment;
    request.apiKeyId = apiKey.id;

    // Asynchronously update last_used_at without blocking the request
    this.prisma.api_keys
      .update({
        where: { id: apiKey.id },
        data: { last_used_at: new Date() },
      })
      .catch((error: Error) => {
        this.logger.error(
          `Failed to update last_used_at for key ${apiKey.id}: ${error.message}`,
        );
      });

    return true;
  }
}
