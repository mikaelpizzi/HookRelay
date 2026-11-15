import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { OutboxPollerService } from './outbox-poller.service';

@Module({
  imports: [PrismaModule, QueueModule],
  providers: [OutboxPollerService],
  exports: [OutboxPollerService],
})
export class DispatcherModule {}
