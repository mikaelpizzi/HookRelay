import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { DemoSinkService } from './demo-sink.service';
import { SetModeDto } from './dto/set-mode.dto';

@Controller(['api/demo/webhook-sink', 'api/v1/demo/webhook-sink'])
export class DemoSinkController {
  constructor(private readonly demoSinkService: DemoSinkService) {}

  /**
   * Public webhook ingestion endpoint simulating a third-party webhook sink.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Headers() headers: Record<string, any>,
    @Body() body: any,
    @Req() req: any,
    @Query('secret') querySecret?: string,
  ) {
    const rawBody =
      req?.rawBody?.toString?.('utf-8') ??
      (typeof body === 'string' ? body : JSON.stringify(body ?? {}));
    const secret = querySecret || headers['x-demo-secret'];

    return this.demoSinkService.processWebhook(
      headers,
      body,
      rawBody,
      secret,
    );
  }

  /**
   * Retrieves current simulation mode (HEALTHY, DOWN, SLOW).
   */
  @Get('mode')
  getMode() {
    return this.demoSinkService.getMode();
  }

  /**
   * Configures simulation mode (supports both PUT and POST).
   */
  @Put('mode')
  @Post('mode')
  setMode(@Body() dto: SetModeDto) {
    return this.demoSinkService.setMode(dto?.mode);
  }

  /**
   * Retrieves in-memory webhook log buffer (last 50 received, newest first).
   */
  @Get(['log', 'logs'])
  getLogs() {
    return this.demoSinkService.getLogs();
  }

  /**
   * Clears in-memory webhook log buffer.
   */
  @Delete(['log', 'logs'])
  clearLogs() {
    return this.demoSinkService.clearLogs();
  }
}
