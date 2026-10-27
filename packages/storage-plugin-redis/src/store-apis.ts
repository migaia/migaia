// Key-value, record, TTL and counter capability APIs for the Redis store (see ./store.ts).
import {
  createBackendChangeIterator,
  createRecordQuery,
  snapshotStorageBatchKeys,
  snapshotStorageCounterIncrement,
  asyncDisposeKey
} from '@migaia/storage-host/sdk'
import { RedisCommand, RedisOperation } from './constants.js'
import {
  assertStorageTtlDuration,
  type IKeyValueApi,
  type IRecordsApi,
  type ITtlApi,
  type ICounterApi,
  type ITtlTarget
} from '@migaia/storage-contract'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { decodeRedisValue, replyOptionalString, replyInteger } from './layout.js'
import { unsupported, redisError } from './errors.js'
import { RedisText } from './constants.js'
import type { IRedisNativeStore } from './types.js'
import { redisRemovePrefix, redisIterator, redisMutate, redisTtlTarget } from './store-records.js'
import { redisRead } from './store-state.js'
import type { IRedisOrganizationContext } from './store-state.js'
import { redisSelectedVector } from './store-transaction.js'
import {
  redisEmpty,
  redisCaptureEntries,
  redisWrite,
  redisPrepareEntries,
  redisWriteLocks,
  redisKey,
  redisTextKey
} from './store-write.js'

/** Assemble the original keyValue methods from explicit organization state. */
export function createRedisKeyValue(
  organization: IRedisOrganizationContext,
  base: IRedisNativeStore
): IKeyValueApi {
  return {
    ...base,
    getMany: (inputs, ctx) => {
      const captured = snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key)
      if (captured.length === 0) return redisEmpty(organization, ctx, [])
      /** The native batch's canonical snapshot supplies keys without re-reading pipeline input. */
      let prepared: ReturnType<typeof snapshotStorageBatchKeys> | undefined
      return redisRead(
        organization,
        RedisOperation.getMany,
        captured,
        ctx,
        async (actual, send) => {
          prepared = snapshotStorageBatchKeys(actual, RedisText.backend)
          const values = await send([
            RedisCommand.mget,
            ...prepared.map((entry) => organization.layout.value('text', entry.key))
          ])
          if (!Array.isArray(values) || values.length !== prepared.length)
            throw redisError(RedisErrorCode.decodeFailed, values)
          return values.map((value) => {
            const raw = replyOptionalString(value)
            return raw === undefined ? undefined : (decodeRedisValue('text', raw) as string)
          })
        },
        captured.length,
        () => (prepared ?? []).map((entry) => ({ channel: 'text', key: entry.key }))
      )
    },
    setMany: (entries, ctx) => {
      const captured = redisCaptureEntries(organization, entries)
      if (captured.length === 0) return redisEmpty(organization, ctx, undefined)
      return redisWrite(
        organization,
        RedisOperation.setMany,
        captured,
        ctx,
        (...args) => redisPrepareEntries(organization, ...args),
        (actual) => actual.flatMap((entry) => redisWriteLocks(organization, entry.key)),
        async (draft, actual) => {
          for (const entry of actual)
            await draft.write('text', entry.key, entry.wire, 'conflict', entry.ttlMs)
        },
        captured.length
      )
    },
    removeMany: (inputs, ctx) => {
      const captured = snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key)
      if (captured.length === 0) return redisEmpty(organization, ctx, 0)
      return redisWrite(
        organization,
        RedisOperation.removeMany,
        captured,
        ctx,
        (input) => snapshotStorageBatchKeys(input, RedisText.backend),
        (actual) => actual.map((entry) => ({ channel: 'text', key: entry.key })),
        async (draft, actual) => {
          let count = 0
          for (const entry of actual) if (await draft.remove('text', entry.key)) count++
          return count
        },
        captured.length
      )
    },
    removeByPrefix: (input, ctx) =>
      redisWrite(
        organization,
        RedisOperation.removeByPrefix,
        redisKey(organization, input),
        ctx,
        (...args) => redisKey(organization, ...args),
        () => [],
        (draft, actual) => redisRemovePrefix(organization, 'text', actual, draft)
      )
  }
}
/** Assemble the original recordApi methods from explicit organization state. */
export function createRedisRecordApi(
  organization: IRedisOrganizationContext
): IRecordsApi<unknown, true> {
  return {
    query: <R>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: { source: RedisText.backend, operations: [], operators: [] },
          execute: ({ ctx }) => redisIterator(organization, undefined, ctx),
          watch: ({ ctx }) =>
            createBackendChangeIterator(organization.environment.controller, {
              orgId: organization.orgId,
              channel: 'record',
              ctx
            }),
          mutate: (request, run) =>
            redisWrite(
              organization,
              request.operation === 'delete'
                ? RedisOperation.queryDelete
                : RedisOperation.queryUpdate,
              request,
              request.ctx,
              (input) => input,
              () => [],
              (draft, actual) => redisMutate(organization, draft, actual, run),
              undefined,
              request.concurrency
            )
        },
        organization.environment.core.getChainMethods('query')
      ),
    removeByPrefix: (input, ctx) =>
      redisWrite(
        organization,
        RedisOperation.removeByPrefix,
        redisKey(organization, input),
        ctx,
        (...args) => redisKey(organization, ...args),
        () => [],
        (draft, actual) => redisRemovePrefix(organization, 'record', actual, draft)
      )
  }
}
/** Assemble the original timeToLive methods from explicit organization state. */
export function createRedisTtlApi(organization: IRedisOrganizationContext): ITtlApi {
  return {
    expire: (input, ms, ctx) => {
      const target = redisTtlTarget(organization, input)
      assertStorageTtlDuration(ms, RedisText.backend)
      return redisWrite(
        organization,
        RedisOperation.expire,
        { target, ms },
        ctx,
        (actual) => {
          const target = redisTtlTarget(organization, actual.target)
          assertStorageTtlDuration(actual.ms, RedisText.backend)
          return { target, ms: actual.ms }
        },
        (actual) => [actual.target],
        (draft, actual) =>
          actual.target.channel === 'vector'
            ? redisSelectedVector(organization).expire(draft, actual.target, actual.ms)
            : draft.expire(actual.target.channel, actual.target.key, actual.ms),
        1
      )
    },
    remaining: (input, ctx) => {
      const target = redisTtlTarget(organization, input)
      if (target.channel === 'vector')
        return redisSelectedVector(organization).remainingRoot(target, ctx)
      /** Native TTL lookup and telemetry share the same actual canonical target. */
      let captured: ITtlTarget = target
      return redisRead(
        organization,
        RedisOperation.remaining,
        target,
        ctx,
        async (actual, send) => {
          captured = redisTtlTarget(organization, actual)
          if (captured.channel === 'vector') unsupported()
          const value = replyInteger(
            await send([
              RedisCommand.pttl,
              organization.layout.value(captured.channel, captured.key)
            ])
          )
          return value < 0 ? undefined : value
        },
        1,
        () => [captured]
      )
    },
    persist: (input, ctx) => {
      const target = redisTtlTarget(organization, input)
      return redisWrite(
        organization,
        RedisOperation.persist,
        target,
        ctx,
        (...args) => redisTtlTarget(organization, ...args),
        (actual) => [actual],
        (draft, actual) =>
          actual.channel === 'vector'
            ? redisSelectedVector(organization).expire(draft, actual)
            : draft.expire(actual.channel, actual.key),
        1
      )
    }
  }
}
/** Assemble the original counters methods from explicit organization state. */
export function createRedisCounterApi(organization: IRedisOrganizationContext): ICounterApi {
  return {
    increment: (input, by, ctx) => {
      const captured = { key: redisTextKey(organization, input), by }
      snapshotStorageCounterIncrement(by, RedisText.backend)
      return redisWrite(
        organization,
        RedisOperation.increment,
        captured,
        ctx,
        (actual) => {
          snapshotStorageCounterIncrement(actual.by, RedisText.backend)
          return { key: redisTextKey(organization, actual.key), by: actual.by }
        },
        (actual) => redisWriteLocks(organization, actual.key),
        (draft, actual) => draft.increment(actual.key, actual.by),
        1
      )
    }
  }
}
