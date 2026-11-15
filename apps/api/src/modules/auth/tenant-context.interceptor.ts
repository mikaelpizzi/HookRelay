import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { TenantContextStorage } from './tenant-context.storage';
import { environment_type } from '@prisma/client';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantId =
      request.tenantId || (request.headers['x-tenant-id'] as string | undefined);

    if (tenantId) {
      return new Observable((subscriber) => {
        TenantContextStorage.run(
          {
            tenantId,
            environment: request.environment as environment_type | undefined,
            apiKeyId: request.apiKeyId,
          },
          () => {
            next.handle().subscribe(subscriber);
          },
        );
      });
    }

    return next.handle();
  }
}
