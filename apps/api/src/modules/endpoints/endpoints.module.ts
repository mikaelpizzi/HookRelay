import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EndpointsController } from './endpoints.controller';
import { EndpointsService } from './endpoints.service';
import { SsrfValidatorService } from './ssrf-validator.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EndpointsController],
  providers: [EndpointsService, SsrfValidatorService],
  exports: [EndpointsService, SsrfValidatorService],
})
export class EndpointsModule {}
