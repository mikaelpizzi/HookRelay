import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { EndpointsModule } from '../endpoints/endpoints.module';
import { DispatcherProcessor } from './dispatcher.processor';
import { HmacSignerService } from './hmac-signer.service';
import { OutboxPollerService } from './outbox-poller.service';
import { SafeHttpTransport } from './safe-http-transport.service';

@Module({
  imports: [PrismaModule, QueueModule, EndpointsModule],
  providers: [
    OutboxPollerService,
    HmacSignerService,
    SafeHttpTransport,
    DispatcherProcessor,
  ],
  exports: [
    OutboxPollerService,
    HmacSignerService,
    SafeHttpTransport,
    DispatcherProcessor,
  ],
})
export class DispatcherModule {}
