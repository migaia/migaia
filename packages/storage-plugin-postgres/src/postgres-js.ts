import type { Sql, ReservedSql } from 'postgres'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IPgDriver, IPgConnection, IPgNativeParameter, IPgResult } from './types.js'
import { encodePgParameters } from './parameters.js'
import { decodePgRows } from './result.js'
import { pgResource } from './driver-resource.js'
import { copyCommand } from './copy-command.js'
import { normalizePostgresError } from './errors.js'
import {
  throwIfAborted,
  subscribeToAbort,
  readAbortReason,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
/** Raw query-local results bypass caller transforms and retain each actual server OID. */
async function query(
  client: Sql | ReservedSql,
  text: string,
  params: readonly IPgNativeParameter[]
): Promise<IPgResult> {
  try {
    const values = encodePgParameters(params).map((value) =>
      typeof value === 'bigint'
        ? client.typed(value.toString(), 20)
        : typeof value === 'string'
          ? client.typed(value, 25)
          : value
    )
    const result = await client.unsafe(text, values, { prepare: false }).raw()
    return {
      rows: decodePgRows(
        (result.columns ?? []).map((column) => ({ name: column.name, type: column.type })),
        result
      ),
      rowCount: result.count ?? 0
    }
  } catch (cause) {
    throw normalizePostgresError(cause)
  }
}
/** A reserved postgres.js connection owns only its accepted commands and original release. */
function connection(client: ReservedSql): IPgConnection {
  const resource = pgResource(() => client.release())
  return {
    query: (text, params, ctx) =>
      resource.run(() => {
        throwIfAborted(ctx?.signal)
        return query(client, text, params)
      }),
    copyFrom: (target, source, options, ctx) =>
      resource.run(async () => {
        throwIfAborted(ctx?.signal)
        const abort = new AbortController()
        const report = createStorageOperationReporter()
        const stop = subscribeToAbort(
          ctx?.signal,
          () => abort.abort(readAbortReason(ctx?.signal)),
          report
        )
        try {
          const writable = await client.unsafe(copyCommand(target, options)).writable()
          await pipeline(Readable.from(source), writable, { signal: abort.signal })
        } catch (cause) {
          throwIfAborted(ctx?.signal)
          throw normalizePostgresError(cause)
        } finally {
          stop()
        }
      }),
    dispose: resource.dispose,
    [Symbol.asyncDispose]: resource[Symbol.asyncDispose]
  }
}
/** This entry borrows the injected postgres.js client and never closes its pool or shared socket. */
export function postgresJsDriver(client: Sql): IPgDriver {
  return {
    query: async (text, params, ctx) => {
      throwIfAborted(ctx?.signal)
      return query(client, text, params)
    },
    connect: async (ctx) => {
      throwIfAborted(ctx?.signal)
      try {
        return connection(await client.reserve())
      } catch (cause) {
        throw normalizePostgresError(cause)
      }
    },
    listen: async (channel, listener, ctx) => {
      throwIfAborted(ctx?.signal)
      try {
        const report = createStorageOperationReporter()
        const subscription = await client.listen(channel, (payload) => {
          try {
            const result = listener(payload)
            void Promise.resolve(result).catch((cause) => reportCleanupError(report, cause))
          } catch (cause) {
            reportCleanupError(report, cause)
          }
        })
        return pgResource(() => subscription.unlisten())
      } catch (cause) {
        throw normalizePostgresError(cause)
      }
    }
  }
}
