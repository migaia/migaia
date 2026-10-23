import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { sqliteBackendKind } from '../plugin.js'
import type { ISqliteMaintenanceApi } from '../types.js'
/** Maintenance executes on the original store SQL endpoint and inherits its admission and hooks. */
export function sqliteMaintenanceFeature() {
  return defineFeature<
    typeof sqliteBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      {},
      { readonly store: { readonly maintenance: ISqliteMaintenanceApi }; readonly transaction: {} }
    >
  >(sqliteBackendKind, () => ({
    capabilities: [] as const,
    chain: {},
    api: {
      store: {
        maintenance: {
          async backup(
            path: string,
            ctx?: import('@migaia/storage-contract').IOperationContext
          ): Promise<void> {
            await this.store.sql`VACUUM INTO ${path}`.run(ctx)
          },
          async vacuum(ctx?: import('@migaia/storage-contract').IOperationContext): Promise<void> {
            await this.store.sql`VACUUM`.run(ctx)
          }
        }
      },
      transaction: {}
    }
  }))
}
