import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Response } from 'express';
import { environment_type } from '@prisma/client';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentEnvironment } from '../auth/decorators/current-environment.decorator';
import { IngestService } from './ingest.service';
import { IngestEventDto } from './dto/ingest-event.dto';
import { IngestResult } from './interfaces/ingest-result.interface';

@Controller('api/v1/events')
@UseGuards(ApiKeyGuard)
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post()
  async ingest(
    @CurrentTenant() tenantId: string,
    @CurrentEnvironment() environment: environment_type,
    @Headers('x-correlation-id') correlationHeader: string | undefined,
    @Body() dto: IngestEventDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestResult> {
    const correlationId = correlationHeader || crypto.randomUUID();
    const targetEnv = environment || environment_type.PRODUCTION;

    if (res?.setHeader) {
      res.setHeader('x-correlation-id', correlationId);
    }

    try {
      const result = await this.ingestService.ingestEvent(
        tenantId,
        targetEnv,
        dto,
        correlationId,
      );

      if (res?.status) {
        res.status(result.deduplicated ? HttpStatus.OK : HttpStatus.ACCEPTED);
      }

      return result;
    } catch (error: any) {
      if (res?.setHeader && error?.headers) {
        for (const [header, val] of Object.entries(error.headers)) {
          res.setHeader(header, val as string);
        }
      }
      throw error;
    }
  }
}
