import {
  WatchError,
  MultiErrorReply,
  type RedisClientPoolType,
  type RedisClientType,
  type RedisModules,
  type RedisFunctions,
  type RedisScripts,
  type RespVersions,
  type TypeMapping
} from 'redis'
import type { IRedisConnection, IRedisDriver } from '../driver.js'
import { normalizeRedisError, invalidArgument } from '../errors.js'
import {
  runRedisCallback,
  captureCommand,
  captureCommands,
  nativeArguments,
  execEntries,
  requireExecArray,
  subscriptionResource
} from '../native.js'

/** Every native attempt stays inside the real pool's execute callback until its Promise settles. */
export function nodeRedisDriver<
  M extends RedisModules,
  F extends RedisFunctions,
  S extends RedisScripts,
  RESP extends RespVersions,
  TM extends TypeMapping
>(pool: RedisClientPoolType<M, F, S, RESP, TM>): IRedisDriver<RedisClientType<M, F, S, RESP, TM>> {
  if (!pool || typeof pool.execute !== 'function') throw invalidArgument()
  const withConnection = async <T>(
    run: (connection: IRedisConnection<RedisClientType<M, F, S, RESP, TM>>) => Promise<T>
  ): Promise<T> => {
    if (typeof run !== 'function') throw invalidArgument()
    try {
      return await pool.execute(async (client) =>
        runRedisCallback(run, {
          getClient: () => client,
          command: async (input) => {
            const args = captureCommand(input, false)
            try {
              return await client.sendCommand(nativeArguments(args))
            } catch (error) {
              throw normalizeRedisError(error)
            }
          },
          binaryCommand: async (input) => {
            const args = captureCommand(input, true)
            try {
              return await client.sendCommand(nativeArguments(args))
            } catch (error) {
              throw normalizeRedisError(error)
            }
          },
          exec: async (commands) => {
            const captured = captureCommands(commands, true)
            if (captured.length === 0) return Object.freeze([])
            const multi = client.multi()
            for (const args of captured) multi.addCommand(nativeArguments(args))
            try {
              return execEntries(requireExecArray(await multi.exec()))
            } catch (error) {
              if (error instanceof WatchError) return null
              if (error instanceof MultiErrorReply)
                return execEntries(requireExecArray(error.replies), error)
              throw normalizeRedisError(error)
            }
          }
        })
      )
    } catch (error) {
      throw normalizeRedisError(error)
    }
  }
  return {
    command: (input) => {
      const args = captureCommand(input, false) as string[]
      return withConnection((connection) => connection.command(args))
    },
    withConnection,
    subscribe: async (channel, listener) => {
      if (typeof channel !== 'string' || typeof listener !== 'function') throw invalidArgument()
      const ready = Promise.withResolvers<void>(),
        stopped = Promise.withResolvers<void>()
      let pending!: Promise<unknown>
      const state = subscriptionResource(async () => {
        stopped.resolve()
        await pending
      })
      const receive = (message: string): void => {
        if (state.isClosing()) return
        try {
          const result = listener(message) as unknown
          if (result !== undefined) void Promise.resolve(result).catch(state.report)
        } catch (error) {
          state.report(error)
        }
      }
      pending = pool.execute(async (client) => {
        await client.subscribe(channel, receive)
        ready.resolve()
        try {
          await stopped.promise
        } finally {
          await client.unsubscribe(channel, receive)
        }
      })
      // Setup observes early rejection; the same original pool Promise remains awaited by cleanup.
      void pending.then(undefined, ready.reject)
      try {
        await ready.promise
      } catch (error) {
        throw normalizeRedisError(error)
      }
      return state.resource
    }
  }
}
