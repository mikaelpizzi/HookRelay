import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ArchiverService } from './archiver.service';
import { TriggerArchiveDto } from './dto/trigger-archive.dto';

@Controller('api/v1/admin/archives')
@UseGuards(ApiKeyGuard)
export class ArchiverController {
  constructor(private readonly archiverService: ArchiverService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runArchival(
    @CurrentTenant() _tenantId: string,
    @Body() dto?: TriggerArchiveDto,
  ) {
    return this.archiverService.triggerManualArchival(dto?.retentionDays);
  }

  @Get('partitions')
  @HttpCode(HttpStatus.OK)
  async getPartitions(@CurrentTenant() _tenantId: string) {
    return this.archiverService.listPartitions();
  }
}
