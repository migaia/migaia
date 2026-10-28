import type { Redis } from 'ioredis'
import type { IRedisConnection, IRedisDriver, IRedisExecEntry } from '../driver.ts'
import { normalizeRedisError, invalidArgument } from '../errors.ts'
import { RedisCommand, RedisText } from '../constants.ts'
import {
  runRedisCallback,
  captureCommand,
  captureCommands,
  nativeArguments,
  subscriptionResource,
  requireExecArray,
  RedisConnectionPool
} from '../native.ts'
import { createStorageOperationReporter, reportCleanupError } from '@migaia/storage-host/sdk'

/** Owned duplicates never replay an unacknowledged command or mutate the injected root options. */
function duplicate<M extends 'legacy' | 'resp3'>(client: Redis<M>) {
  return client.duplicate({
    lazyConnect: true,
    autoResendUnfulfilledCommands: false,
    reconnectOnError: () => false,
    retryStrategy: null
  })
}
/** A completed callback owns no outstanding accepted work when its actual duplicate closes. */
async function close<M extends 'legacy' | 'resp3'>(client: Redis<M>): Promise<void> {
  try {
    if (client.status === 'ready') await client.quit()
  } finally {
    client.disconnect()
  }
}
/** The real SDK owns native leases; this driver owns only borrowed root metadata and reporting. */
class IoredisDriver<M extends 'legacy' | 'resp3'> implements IRedisDriver<Redis<M>> {
  /** Injected native root remains caller-owned and is never closed by this driver. */
  readonly #root: Redis<M>
  /** All native cleanup failures use the existing report boundary. */
  readonly #reporter = createStorageOperationReporter()
  /** Capture the borrowed SDK root without opening another connection. */
  constructor(root: Redis<M>) {
    this.#root = root
  }
  /** Dedicated duplicates reused across callbacks; each one is UNWATCHed before reuse. */
  readonly #pool = new RedisConnectionPool<Redis<M>>({
    open: async () => {
      const owned = duplicate(this.#root)
      try {
        await owned.connect()
      } catch (error) {
        owned.disconnect()
        throw error
      }
      return owned
    },
    reset: async (owned) => {
      await owned.call(RedisCommand.unwatch)
    },
    close: (owned) => close(owned),
    report: (error) => reportCleanupError(this.#reporter, normalizeRedisError(error))
  })
  /** Keep the complete original native callback inside the SDK's lease and unwind path. */
  readonly withConnection: IRedisDriver<Redis<M>>['withConnection'] = async <T>(
    run: (connection: IRedisConnection<Redis<M>>) => Promise<T>
  ): Promise<T> => {
    if (typeof run !== 'function') throw invalidArgument()
    try {
      return await this.#pool.run((owned) =>
        runRedisCallback(run, {
          getClient: () => owned,
          command: async (input) => {
            const args = captureCommand(input, false)
            try {
              return await owned.call(args[0] as string, nativeArguments(args.slice(1)))
            } catch (error) {
              throw normalizeRedisError(error)
            }
          },
          binaryCommand: async (input) => {
            const args = captureCommand(input, true)
            try {
              return await owned.callBuffer(args[0] as string, nativeArguments(args.slice(1)))
            } catch (error) {
              throw normalizeRedisError(error)
            }
          },
          exec: async (commands) => {
            const captured = captureCommands(commands, true)
            if (captured.length === 0) return []
            const multi = owned.multi()
            for (const args of captured)
              multi.callBuffer(args[0] as string, nativeArguments(args.slice(1)))
            let replies: unknown
            try {
              replies = await multi.exec()
            } catch (error) {
              throw normalizeRedisError(error)
            }
            if (replies === null) return null
            const entries = requireExecArray(replies).map((reply): IRedisExecEntry => {
              const pair = requireExecArray(reply),
                error = pair[0]
              return error instanceof Error ? { ok: false, error } : { ok: true, value: pair[1] }
            })
            return entries
          }
        })
      )
    } catch (error) {
      throw normalizeRedisError(error)
    }
  }
  /** Close the idle duplicates this driver opened; the caller's root client stays open. */
  readonly release: NonNullable<IRedisDriver<Redis<M>>['release']> = () => this.#pool.release()
  /** Capture caller arguments before asynchronous native lease acquisition. */
  readonly command: IRedisDriver<Redis<M>>['command'] = (input) => {
    const args = captureCommand(input, false) as string[]
    return this.withConnection((connection) => connection.command(args))
  }
  /** Subscribe through one genuine native lease and the original shared resource owner. */
  readonly subscribe: IRedisDriver<Redis<M>>['subscribe'] = async (channel, listener) => {
    if (typeof channel !== 'string' || typeof listener !== 'function') throw invalidArgument()
    const owned = duplicate(this.#root)
    const state = subscriptionResource(async () => {
      owned.off(RedisText.message, receive)
      try {
        await owned.unsubscribe(channel)
      } catch (error) {
        try {
          await close(owned)
        } catch (cleanup) {
          state.report(cleanup)
        }
        throw error
      }
      await close(owned)
    })
    const receive = (receivedChannel: string, message: string): void => {
      if (receivedChannel !== channel || state.isClosing()) return
      try {
        const pending = listener(message) as unknown
        if (pending !== undefined) void Promise.resolve(pending).catch(state.report)
      } catch (error) {
        state.report(error)
      }
    }
    try {
      await owned.connect()
      owned.on(RedisText.message, receive)
      await owned.subscribe(channel)
    } catch (error) {
      try {
        await close(owned)
      } catch (cleanup) {
        state.report(cleanup)
      }
      throw normalizeRedisError(error)
    }
    return state.resource
  }
}
/** Validate the supported SDK before publishing its exact borrowed driver ports. */
export function ioredisDriver<M extends 'legacy' | 'resp3'>(
  client: Redis<M>
): IRedisDriver<Redis<M>> {
  if (!client || typeof client.duplicate !== 'function') throw invalidArgument()
  return new IoredisDriver<M>(client)
}
