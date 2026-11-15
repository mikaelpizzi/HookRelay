import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ApiKeyGuard } from './api-key.guard';
import { TenantContextHelper } from './tenant-context.helper';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    ApiKeyGuard,
    TenantContextHelper,
    TenantContextInterceptor,
  ],
  exports: [
    AuthService,
    ApiKeyGuard,
    TenantContextHelper,
    TenantContextInterceptor,
  ],
})
export class AuthModule {}
