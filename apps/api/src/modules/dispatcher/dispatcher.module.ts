import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { EndpointsModule } from '../endpoints/endpoints.module';
import { HmacSignerService } from './hmac-signer.service';
import { OutboxPollerService } from './outbox-poller.service';
import { SafeHttpTransport } from './safe-http-transport.service';

@Module({
  imports: [PrismaModule, QueueModule, EndpointsModule],
  providers: [OutboxPollerService, HmacSignerService, SafeHttpTransport],
  exports: [OutboxPollerService, HmacSignerService, SafeHttpTransport],
})
export class DispatcherModule {}
