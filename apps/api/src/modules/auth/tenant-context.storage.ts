import { AsyncLocalStorage } from 'async_hooks';
import { TenantContext } from './interfaces/tenant-context.interface';

const storage = new AsyncLocalStorage<TenantContext>();

export class TenantContextStorage {
  static run<T>(context: TenantContext, callback: () => T): T {
    return storage.run(context, callback);
  }

  static get(): TenantContext | undefined {
    return storage.getStore();
  }

  static getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  }
}
