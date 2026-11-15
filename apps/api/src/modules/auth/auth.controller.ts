import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyGuard } from './api-key.guard';
import { CurrentTenant } from './decorators/current-tenant.decorator';
import { CurrentEnvironment } from './decorators/current-environment.decorator';
import { environment_type } from '@prisma/client';

@Controller('api/v1')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('tenants')
  @HttpCode(HttpStatus.CREATED)
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.authService.createTenant(dto);
  }

  @Get('tenants/:id')
  async getTenant(@Param('id') id: string) {
    return this.authService.getTenantById(id);
  }

  @Post('tenants/:id/api-keys')
  @HttpCode(HttpStatus.CREATED)
  async createApiKey(
    @Param('id') tenantId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.authService.createApiKey(tenantId, dto);
  }

  @Get('tenants/:id/api-keys')
  async listApiKeys(@Param('id') tenantId: string) {
    return this.authService.listApiKeys(tenantId);
  }

  /**
   * Diagnostic / validation endpoint protected by ApiKeyGuard.
   * Returns authenticated tenant context.
   */
  @Get('auth/me')
  @UseGuards(ApiKeyGuard)
  getMe(
    @CurrentTenant() tenantId: string,
    @CurrentEnvironment() environment: environment_type,
  ) {
    return {
      authenticated: true,
      tenantId,
      environment,
    };
  }
}
