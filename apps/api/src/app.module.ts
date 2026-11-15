import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from './shared/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';

@Module({
  imports: [PrismaModule, AuthModule, CatalogModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
