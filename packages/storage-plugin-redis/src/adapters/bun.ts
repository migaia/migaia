import type { RedisClient as IBunRedisClient } from 'bun'
import type { IRedisConnection, IRedisDriver } from '../driver.js'
import { RedisErrorCode } from '../error-code.js'
import { RedisCommand, RedisReply } from '../constants.js'
import {
  runRedisCallback,
  captureCommand,
  captureCommands,
  execEntries,
  requireExecArray,
  subscriptionResource
} from '../native.js'
import { normalizeRedisError, invalidArgument, redisError } from '../errors.js'
import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'

/** Bun owns duplicate creation and connection state; no URL or lookalike client is reconstructed. */
export function bunRedisDriver(client: IBunRedisClient): IRedisDriver<IBunRedisClient> {
  if (!client || typeof client.duplicate !== 'function') throw invalidArgument()
  const reporter = createStorageOperationReporter()
  const withConnection = async <T>(
    run: (connection: IRedisConnection<IBunRedisClient>) => Promise<T>
  ): Promise<T> => {
    if (typeof run !== 'function') throw invalidArgument()
    let owned: IBunRedisClient | undefined, result: T
    try {
      owned = await client.duplicate()
      const connection = owned
      result = await runRedisCallback(run, {
        getClient: () => connection,
        command: async (input) => {
          const args = captureCommand(input, false) as string[]
          try {
            return await connection.send(args[0]!, args.slice(1))
          } catch (error) {
            throw normalizeRedisError(error)
          }
        },
        exec: async (commands) => {
          const captured = captureCommands(commands, false) as string[][]
          if (captured.length === 0) return Object.freeze([])
          let started = false,
            sent = false
          try {
            if ((await connection.send(RedisCommand.multi, [])) !== RedisReply.ok)
              throw redisError(RedisErrorCode.decodeFailed)
            started = true
            for (const args of captured)
              if ((await connection.send(args[0]!, args.slice(1))) !== RedisReply.queued)
                throw redisError(RedisErrorCode.decodeFailed)
            sent = true
            const replies: unknown = await connection.send(RedisCommand.exec, [])
            return replies === null ? null : execEntries(requireExecArray(replies))
          } catch (error) {
            if (started && !sent)
              try {
                await connection.send(RedisCommand.discard, [])
              } catch (cleanup) {
                reportCleanupError(reporter, normalizeRedisError(cleanup))
              }
            throw normalizeRedisError(error)
          }
        }
      })
    } catch (error) {
      try {
        owned?.close()
      } catch (cleanup) {
        reportCleanupError(reporter, normalizeRedisError(cleanup))
      }
      throw normalizeRedisError(error)
    }
    try {
      owned?.close()
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
      let owned: IBunRedisClient
      try {
        owned = await client.duplicate()
      } catch (error) {
        throw normalizeRedisError(error)
      }
      const state = subscriptionResource(async () => {
        try {
          await owned.unsubscribe(channel, receive)
        } catch (error) {
          try {
            owned.close()
          } catch (cleanup) {
            state.report(cleanup)
          }
          throw error
        }
        owned.close()
      })
      const receive = (message: string): void => {
        if (state.isClosing()) return
        try {
          const pending = listener(message) as unknown
          if (pending !== undefined) void Promise.resolve(pending).catch(state.report)
        } catch (error) {
          state.report(error)
        }
      }
      try {
        await owned.subscribe(channel, receive)
      } catch (error) {
        try {
          owned.close()
        } catch (cleanup) {
          state.report(cleanup)
        }
        throw normalizeRedisError(error)
      }
      return state.resource
    }
  }
}
