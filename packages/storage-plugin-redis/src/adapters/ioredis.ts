import type { Redis } from 'ioredis'
import type { IRedisConnection, IRedisDriver, IRedisExecEntry } from '../driver.js'
import { normalizeRedisError, invalidArgument } from '../errors.js'
import { RedisText } from '../constants.js'
import {
  runRedisCallback,
  captureCommand,
  captureCommands,
  nativeArguments,
  subscriptionResource,
  requireExecArray
} from '../native.js'
import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'

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
/** Ioredis raw call is its actual protocol API, unrelated to Function receiver helpers. */
export function ioredisDriver<M extends 'legacy' | 'resp3'>(
  client: Redis<M>
): IRedisDriver<Redis<M>> {
  if (!client || typeof client.duplicate !== 'function') throw invalidArgument()
  const reporter = createStorageOperationReporter()
  const withConnection = async <T>(
    run: (connection: IRedisConnection<Redis<M>>) => Promise<T>
  ): Promise<T> => {
    if (typeof run !== 'function') throw invalidArgument()
    const owned = duplicate(client)
    let result: T
    try {
      await owned.connect()
      result = await runRedisCallback(run, {
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
          if (captured.length === 0) return Object.freeze([])
          const multi = owned.multi()
          for (const args of captured) multi.call(args[0] as string, nativeArguments(args.slice(1)))
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
            return error instanceof Error
              ? Object.freeze({ ok: false, error })
              : Object.freeze({ ok: true, value: pair[1] })
          })
          return Object.freeze(entries)
        }
      })
    } catch (error) {
      try {
        await close(owned)
      } catch (cleanup) {
        reportCleanupError(reporter, normalizeRedisError(cleanup))
      }
      throw normalizeRedisError(error)
    }
    try {
      await close(owned)
    } catch (error) {
      throw normalizeRedisError(error)
    }
    return result
  }
  return {
    command: (input) => {
      const args = captureCommand(input, false) as string[]
      return withConnection((connection) => connection.command(args))
    },
    withConnection,
    subscribe: async (channel, listener) => {
      if (typeof channel !== 'string' || typeof listener !== 'function') throw invalidArgument()
      const owned = duplicate(client)
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
}
