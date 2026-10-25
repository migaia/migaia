import type { SQL, ReservedSQL } from 'bun'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext
} from '@migaia/storage-contract'
import {
  createStorageOperationReporter,
  reportCleanupError,
  subscribeToAbort,
  readAbortReason,
  throwIfAborted
} from '@migaia/storage-host/authoring/backend'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type { IPgDriver, IPgConnection, IPgResult, IPgNativeParameter } from './types.js'
import { encodePgParameters } from './parameters.js'
import { decodePgRows } from './result.js'
import { copyCommand } from './copy-command.js'
import { pgResource } from './driver-resource.js'
import { normalizePostgresError } from './errors.js'
import { PgNames } from './constants.js'
/** Unsupported native protocol surfaces fail before a standard operation can modify data. */
function unsupported(): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: PgNames.backend
  })
}
/** Real raw rows remain unknown until their native array shape has been checked. */
function rawRows(value: unknown): value is readonly (readonly unknown[])[] {
  return Array.isArray(value) && value.every((row) => Array.isArray(row))
}
/** Bun 1.4.4 raw metadata supplies actual OIDs; prepare:false keeps every field in text format. */
async function query(
  client: SQL,
  text: string,
  params: readonly IPgNativeParameter[],
  ctx?: IOperationContext
): Promise<IPgResult> {
  throwIfAborted(ctx?.signal)
  try {
    const result: unknown = await client.unsafe(text, [...encodePgParameters(params)]).raw()
    if (!rawRows(result)) throw unsupported()
    const columns: unknown = Reflect.get(result, 'columns')
    const count: unknown = Reflect.get(result, 'count')
    if (!Array.isArray(columns)) throw unsupported()
    const captured: { name: string; type: number }[] = []
    for (const column of columns) {
      if (column === null || typeof column !== 'object') throw unsupported()
      const name: unknown = Reflect.get(column, 'name')
      const type: unknown = Reflect.get(column, 'type')
      if (typeof name !== 'string' || typeof type !== 'number') throw unsupported()
      captured.push({ name, type })
    }
    return { rows: decodePgRows(captured, result), rowCount: typeof count === 'number' ? count : 0 }
  } catch (cause) {
    throw normalizePostgresError(cause)
  }
}
/** A genuine reservation returns to Bun only after native query/COPY settlement. */
function connection(client: ReservedSQL): IPgConnection {
  const resource = pgResource(() => client.release())
  return {
    query: (text, params, ctx) => resource.run(() => query(client, text, params, ctx)),
    copyFrom: (target, source, options, ctx) =>
      resource.run(async () => {
        throwIfAborted(ctx?.signal)
        const pending = client.unsafe(copyCommand(target, options))
        if (!('writable' in pending) || typeof pending.writable !== 'function') throw unsupported()
        const stream: unknown = pending.writable()
        if (!(stream instanceof WritableStream)) throw unsupported()
        const writer = stream.getWriter()
        const report = createStorageOperationReporter()
        const stop = subscribeToAbort(
          ctx?.signal,
          () => {
            void writer
              .abort(readAbortReason(ctx?.signal))
              .catch((cause) => reportCleanupError(report, cause))
          },
          report
        )
        try {
          for await (const chunk of source) {
            throwIfAborted(ctx?.signal)
            await writer.write(chunk)
          }
          await writer.close()
          await pending
        } catch (cause) {
          const secondary: unknown[] = []
          try {
            await writer.abort(cause)
          } catch (failure) {
            if (failure !== cause) secondary.push(failure)
          }
          try {
            await pending
          } catch (failure) {
            if (failure !== cause) secondary.push(failure)
          }
          throw normalizePostgresError(
            secondary.length === 0 ? cause : attachSecondaryErrors(cause, secondary)
          )
        } finally {
          stop()
          writer.releaseLock()
        }
      }),
    dispose: resource.dispose,
    [Symbol.asyncDispose]: resource[Symbol.asyncDispose]
  }
}
/** The caller owns its SQL client and must select native text-format results with prepare:false. */
export function bunSqlDriver(client: SQL): IPgDriver {
  /** Earlier runtimes lack both real COPY streams and the OID metadata required before writes. */
  const version =
    typeof Bun === 'undefined'
      ? []
      : Bun.version.split('.').map((part) => Number.parseInt(part, 10))
  if (
    (version[0] ?? 0) < 1 ||
    (version[0] === 1 && ((version[1] ?? 0) < 4 || (version[1] === 4 && (version[2] ?? 0) < 4)))
  )
    throw unsupported()
  const options = client.options
  if (options.prepare !== false) throw unsupported()
  const report = createStorageOperationReporter()
  return {
    query: (text, params, ctx) => query(client, text, params, ctx),
    connect: async (ctx) => {
      throwIfAborted(ctx?.signal)
      const abort = new AbortController()
      const stop = subscribeToAbort(
        ctx?.signal,
        () => abort.abort(readAbortReason(ctx?.signal)),
        report
      )
      try {
        return connection(await client.reserve({ signal: abort.signal }))
      } catch (cause) {
        throw normalizePostgresError(cause)
      } finally {
        stop()
      }
    },
    listen: async (channel, listener, ctx) => {
      throwIfAborted(ctx?.signal)
      try {
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
