import { environment_type } from '@prisma/client';

export interface TenantContext {
  tenantId: string;
  environment?: environment_type;
  apiKeyId?: string;
}
