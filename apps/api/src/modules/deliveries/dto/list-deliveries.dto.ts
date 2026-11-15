import { delivery_status } from '@prisma/client';

export class ListDeliveriesDto {
  status?: delivery_status;
  correlationId?: string;
  correlation_id?: string;
  eventId?: string;
  event_id?: string;
  endpointId?: string;
  endpoint_id?: string;
  limit?: number | string;
  offset?: number | string;
}
