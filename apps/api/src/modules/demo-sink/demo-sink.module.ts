import { Module } from '@nestjs/common';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { DemoSinkController } from './demo-sink.controller';
import { DemoSinkService } from './demo-sink.service';

@Module({
  imports: [DispatcherModule],
  controllers: [DemoSinkController],
  providers: [DemoSinkService],
  exports: [DemoSinkService],
})
export class DemoSinkModule {}
