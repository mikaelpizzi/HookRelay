import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { SchemaValidatorService } from './schema-validator.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatalogController],
  providers: [CatalogService, SchemaValidatorService],
  exports: [CatalogService, SchemaValidatorService],
})
export class CatalogModule {}
