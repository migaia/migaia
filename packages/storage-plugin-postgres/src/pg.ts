import type { Pool, PoolClient, ClientBase } from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IPgDriver, IPgConnection, IPgNativeParameter, IPgResult } from './types.js'
import { encodePgParameters } from './parameters.js'
import { decodePgRows } from './result.js'
import { pgResource } from './driver-resource.js'
import { copyCommand, quotePgIdentifier } from './copy-command.js'
import { normalizePostgresError } from './errors.js'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { createPgReplication } from './pg-replication.js'
import {
  throwIfAborted,
  subscribeToAbort,
  readAbortReason,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
/** Each query opts into raw text locally; the caller's pool and global parsers remain unchanged. */
async function query(
  client: Pool | ClientBase,
  text: string,
  params: readonly IPgNativeParameter[]
): Promise<IPgResult> {
  try {
    const result = await client.query<unknown[]>({
      text,
      values: [...encodePgParameters(params)],
      rowMode: 'array',
      types: { getTypeParser: () => (value: string) => value }
    })
    return {
      rows: decodePgRows(
        result.fields.map((column) => ({ name: column.name, type: column.dataTypeID })),
        result.rows
      ),
      rowCount: result.rowCount ?? 0
    }
  } catch (cause) {
    throw normalizePostgresError(cause)
  }
}
/** Borrow one real pg pool connection without ever transferring pool ownership to the backend. */
function connection(client: PoolClient): IPgConnection {
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
          await pipeline(
            Readable.from(source),
            client.query(copyFrom(copyCommand(target, options))),
            { signal: abort.signal }
          )
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
/** The pg-only entry loads its real peers; package root remains client-free. */
export function pgDriver(pool: Pool): IPgDriver {
  const report = createStorageOperationReporter()
  return {
    logicalReplication: createPgReplication(pool, query),
    query: async (text, params, ctx) => {
      throwIfAborted(ctx?.signal)
      return query(pool, text, params)
    },
    connect: async (ctx) => {
      throwIfAborted(ctx?.signal)
      try {
        return connection(await pool.connect())
      } catch (cause) {
        throw normalizePostgresError(cause)
      }
    },
    listen: async (channel, listener, ctx) => {
      throwIfAborted(ctx?.signal)
      const client = await pool.connect()
      const resource = pgResource(async () => {
        try {
          await client.query('UNLISTEN ' + quotePgIdentifier(channel))
        } finally {
          client.removeListener('notification', onNotification)
          client.release()
        }
      })
      const onNotification = (message: { channel: string; payload?: string }): void => {
        if (message.channel !== channel) return
        try {
          const result = listener(message.payload ?? '')
          observeThenableRejection(result, inspectThenable(result), (cause) =>
            reportCleanupError(report, cause)
          )
        } catch (cause) {
          reportCleanupError(report, cause)
        }
      }
      client.on('notification', onNotification)
      try {
        await client.query('LISTEN ' + quotePgIdentifier(channel))
        return resource
      } catch (cause) {
        await resource.dispose().catch((failure) => reportCleanupError(report, failure))
        throw normalizePostgresError(cause)
      }
    }
  }
}
