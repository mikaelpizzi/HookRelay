import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { environment_type } from '@prisma/client';
import { TenantContextStorage } from '../tenant-context.storage';

export const CurrentEnvironment = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): environment_type | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (
      (request.environment as environment_type | undefined) ||
      TenantContextStorage.get()?.environment
    );
  },
);
