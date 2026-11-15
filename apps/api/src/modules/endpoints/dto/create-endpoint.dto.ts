import { environment_type } from '@prisma/client';

export class CreateEndpointDto {
  url!: string;
  description?: string;
  environments?: environment_type[];
  failureThreshold?: number;
  failure_threshold?: number;
}
