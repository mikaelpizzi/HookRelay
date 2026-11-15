import {
  Body,
  Controller,
  Delete,
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
import { EndpointsService } from './endpoints.service';
import { CreateEndpointDto } from './dto/create-endpoint.dto';
import { UpdateEndpointDto } from './dto/update-endpoint.dto';
import { SubscribeTopicDto } from './dto/subscribe-topic.dto';

@Controller('api/v1/endpoints')
@UseGuards(ApiKeyGuard)
export class EndpointsController {
  constructor(private readonly endpointsService: EndpointsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEndpoint(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateEndpointDto,
  ) {
    return this.endpointsService.createEndpoint(tenantId, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listEndpoints(@CurrentTenant() tenantId: string) {
    return this.endpointsService.listEndpoints(tenantId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getEndpointById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.endpointsService.getEndpointById(tenantId, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateEndpoint(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEndpointDto,
  ) {
    return this.endpointsService.updateEndpoint(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteEndpoint(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.endpointsService.deleteEndpoint(tenantId, id);
  }

  @Post(':id/subscriptions')
  @HttpCode(HttpStatus.CREATED)
  async subscribeTopic(
    @CurrentTenant() tenantId: string,
    @Param('id') endpointId: string,
    @Body() dto: SubscribeTopicDto,
  ) {
    return this.endpointsService.subscribeTopic(tenantId, endpointId, dto);
  }

  @Get(':id/subscriptions')
  @HttpCode(HttpStatus.OK)
  async listSubscriptions(
    @CurrentTenant() tenantId: string,
    @Param('id') endpointId: string,
  ) {
    return this.endpointsService.listSubscriptions(tenantId, endpointId);
  }

  @Delete(':id/subscriptions/:topicId')
  @HttpCode(HttpStatus.OK)
  async unsubscribeTopic(
    @CurrentTenant() tenantId: string,
    @Param('id') endpointId: string,
    @Param('topicId') topicId: string,
  ) {
    return this.endpointsService.unsubscribeTopic(tenantId, endpointId, topicId);
  }
}
