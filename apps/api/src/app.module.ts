import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthController } from './health.controller';
import { PrismaModule } from './shared/prisma/prisma.module';
import { QueueModule } from './shared/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { EndpointsModule } from './modules/endpoints/endpoints.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { DispatcherModule } from './modules/dispatcher/dispatcher.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    QueueModule,
    AuthModule,
    CatalogModule,
    EndpointsModule,
    IngestModule,
    DispatcherModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
