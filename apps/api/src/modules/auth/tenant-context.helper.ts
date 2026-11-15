import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TenantContextStorage } from './tenant-context.storage';

@Injectable()
export class TenantContextHelper {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs an operation inside a PostgreSQL transaction with app.current_tenant_id set.
   * Ensures RLS policies evaluate against the specified tenantId.
   */
  async runWithTenant<T>(
    tenantId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenantContext(tenantId, operation);
  }

  /**
   * Automatically resolves the tenantId from the active async storage context
   * and runs the operation with RLS enforcement.
   */
  async runInCurrentContext<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const tenantId = TenantContextStorage.getTenantId();
    if (!tenantId) {
      throw new UnauthorizedException(
        'No tenant context found in active execution context',
      );
    }
    return this.runWithTenant(tenantId, operation);
  }
}
