import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CatalogService } from './catalog.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';

@Controller('api/v1/topics')
@UseGuards(ApiKeyGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTopic(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateTopicDto,
  ) {
    return this.catalogService.createTopic(tenantId, dto);
  }

  @Get()
  async listTopics(@CurrentTenant() tenantId: string) {
    return this.catalogService.listTopics(tenantId);
  }

  @Get(':id')
  async getTopicById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.catalogService.getTopicById(tenantId, id);
  }

  @Patch(':id')
  async updateTopic(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.catalogService.updateTopic(tenantId, id, dto);
  }
}
