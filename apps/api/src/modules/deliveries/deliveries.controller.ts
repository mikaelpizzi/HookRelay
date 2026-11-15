import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { DeliveriesService } from './deliveries.service';
import { ListDeliveriesDto } from './dto/list-deliveries.dto';

@Controller('api/v1/deliveries')
@UseGuards(ApiKeyGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listDeliveries(
    @CurrentTenant() tenantId: string,
    @Query() query: ListDeliveriesDto,
  ) {
    return this.deliveriesService.listDeliveries(tenantId, query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getDeliveryById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.deliveriesService.getDeliveryById(tenantId, id);
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  async replayDelivery(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.deliveriesService.replayDelivery(tenantId, id);
  }
}
