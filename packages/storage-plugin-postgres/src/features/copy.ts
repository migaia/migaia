import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { postgresBackendKind } from '../plugin.js'
import type { IPgCopyApi } from '../types.js'
import { copyCommand } from '../copy-command.js'
import { PgNames, PgOperation } from '../constants.js'
import { invalidArgument } from '../errors.js'
/** Native COPY is admitted and drained by the original transaction operation owner. */
export function pgCopyFeature() {
  return defineFeature<
    typeof postgresBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      {},
      {
        readonly store: { readonly copy: IPgCopyApi }
        readonly transaction: { readonly copy: IPgCopyApi }
      }
    >
  >(postgresBackendKind, ({ featureExpose: core }) => ({
    capabilities: [] as const,
    chain: {},
    api: {
      store: {
        copy: {
          async from(target, source, options = {}, ctx) {
            core.assertNativeRoot(this.store)
            const captured = {
              table: [...target.table] as [string, ...string[]],
              columns: [...target.columns] as [string, ...string[]]
            }
            const settings = {
              format: options.format,
              header: options.header,
              delimiter: options.delimiter,
              null: options.null
            }
            copyCommand(captured, settings)
            if (typeof source !== 'function') throw invalidArgument()
            await core.runNative(undefined, PgOperation.copy, ctx, async (client, context) => {
              if (!client.copyFrom)
                throw new StorageContractError(StorageContractErrorCode.unsupported, {
                  backend: PgNames.backend
                })
              await client.copyFrom(captured, source(), settings, context)
            })
          }
        }
      },
      transaction: {
        copy: {
          async from(target, source, options = {}, ctx) {
            core.assertNativeRoot(this.store)
            const captured = {
              table: [...target.table] as [string, ...string[]],
              columns: [...target.columns] as [string, ...string[]]
            }
            const settings = {
              format: options.format,
              header: options.header,
              delimiter: options.delimiter,
              null: options.null
            }
            copyCommand(captured, settings)
            if (typeof source !== 'function') throw invalidArgument()
            await core.runNative(this.scope, PgOperation.copy, ctx, async (client, context) => {
              if (!client.copyFrom)
                throw new StorageContractError(StorageContractErrorCode.unsupported, {
                  backend: PgNames.backend
                })
              await client.copyFrom(captured, source(), settings, context)
            })
          }
        }
      }
    }
  }))
}
