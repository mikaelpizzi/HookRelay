import { Module } from '@nestjs/common';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { QueueModule } from '../../shared/queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
