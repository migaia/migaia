import {
  StorageContractError,
  StorageContractErrorCode,
  type IDurableChangeFeedApi,
  type IOperationContext,
  type IStorageResource
} from '@migaia/storage-contract'
import type {
  IPgDriver,
  IPgLogicalReplicationOptions,
  IPgLogicalReplicationRoute
} from './types.ts'
import { invalidArgument } from './errors.ts'
import { PgNames, PgOperation, PgTruncatePolicy } from './constants.ts'
/** Original Feature ownership is captured once; child APIs retain only their own immutable route. */
export type IPgReplicationSelection = IPgLogicalReplicationOptions & {
  own(resource: IStorageResource): IStorageResource
}
/**
 * Capture deployment names before deferred installation can await; use PostgreSQL's actual
 * slot-name domain.
 */
export function snapshotPgReplication(
  options: IPgLogicalReplicationOptions
): IPgLogicalReplicationOptions {
  const slot = options.slot
  const publication = options.publication
  /** The selected policy is stable across every native read and subscription. */
  const truncate = options.truncate ?? PgTruncatePolicy.reset
  if (
    typeof slot !== 'string' ||
    !/^[a-z0-9_]{1,63}$/.test(slot) ||
    typeof publication !== 'string' ||
    publication.length === 0 ||
    !publication.isWellFormed() ||
    publication.includes('\0') ||
    new TextEncoder().encode(publication).length > 63 ||
    (truncate !== PgTruncatePolicy.reset && truncate !== PgTruncatePolicy.block)
  )
    throw invalidArgument()
  return { slot, publication, truncate }
}
/**
 * Durable methods use the same original host execution owner without opening a business
 * transaction.
 */
export function createPgDurableApi(input: {
  readonly driver: IPgDriver
  readonly route: IPgLogicalReplicationRoute
  readonly selection: IPgReplicationSelection
  readonly execute: <R>(
    operation: string,
    ctx: IOperationContext | undefined,
    run: () => Promise<R>
  ) => Promise<R>
}): IDurableChangeFeedApi {
  const port = input.driver.logicalReplication
  if (port === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  return {
    readChanges(options, ctx) {
      const after = options?.after
      const limit = options?.limit
      return input.execute(PgOperation.readChanges, ctx, () =>
        port.read(
          {
            ...input.route,
            slot: input.selection.slot,
            publication: input.selection.publication,
            truncate: input.selection.truncate,
            after,
            limit
          },
          ctx
        )
      )
    },
    tailChanges(options, ctx) {
      const from = options.from
      const onChange = options.onChange
      const onError = options.onError
      if (
        typeof from !== 'string' ||
        typeof onChange !== 'function' ||
        (onError !== undefined && typeof onError !== 'function')
      )
        throw invalidArgument()
      return input.execute(PgOperation.tailChanges, ctx, async () =>
        input.selection.own(
          await port.open(
            {
              ...input.route,
              slot: input.selection.slot,
              publication: input.selection.publication,
              truncate: input.selection.truncate,
              from,
              onChange: async (change) => {
                await onChange(change)
              },
              onError
            },
            ctx
          )
        )
      )
    }
  }
}
