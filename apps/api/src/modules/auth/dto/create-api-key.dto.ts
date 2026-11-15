import { environment_type } from '@prisma/client';

export class CreateApiKeyDto {
  name!: string;
  environment?: environment_type;
  expiresAt?: string;
}
