// Transaction scope class for the Redis store (see ./store.ts).
import {
  assertTransactionOwner,
  useTransactionCapability,
  createRecordQuery,
  snapshotStorageBatchKeys,
  snapshotStorageCounterIncrement,
  asyncDisposeKey
} from '@migaia/storage-host/sdk'
import { RedisOperation } from './constants.ts'
import { assertStorageTtlDuration, readTransactionConflictPolicy } from '@migaia/storage-contract'
import { RedisDraft } from './transaction.ts'
import { decodeRedisValue } from './layout.ts'
import { RedisText } from './constants.ts'
import {
  redisScoped,
  redisIterator,
  redisRemovePrefix,
  redisMutate,
  redisTtlTarget
} from './store-records.ts'
import { ttlApi, counterApi, recordsApi } from './store-state.ts'
import type { IRedisInternalScope, IRedisOrganizationContext } from './store-state.ts'
import { redisSelectedVector } from './store-transaction.ts'
import {
  redisTextKey,
  redisCapturePoint,
  redisPreparePoint,
  redisKey,
  redisCaptureEntries,
  redisPrepareEntries
} from './store-write.ts'

/** One Redis transaction scope: a draft over WATCH-guarded native reads for one organization. */
class RedisScope implements IRedisInternalScope {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organization: IRedisOrganizationContext

  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #draft: RedisDraft

  use: IRedisInternalScope['use'] = (capability) => useTransactionCapability(this, capability)

  get: IRedisInternalScope['get'] = (key) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.get,
      () => redisTextKey(this.#organization, key),
      async (actual) =>
        ((await this.#draft.read('text', redisTextKey(this.#organization, actual))) as
          | string
          | undefined) ?? null
    )

  set: IRedisInternalScope['set'] = (key, value, options) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.set,
      () => ({
        ...redisCapturePoint(
          this.#organization,
          'text',
          redisTextKey(this.#organization, key),
          value
        ),
        policy: readTransactionConflictPolicy(options, RedisText.backend)
      }),
      async (actual) => {
        const prepared = redisPreparePoint(this.#organization, 'text', actual)
        await this.#draft.write(
          'text',
          prepared.key,
          prepared.wire,
          readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
        )
      }
    )

  remove: IRedisInternalScope['remove'] = (key) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.remove,
      () => redisTextKey(this.#organization, key),
      async (actual) => {
        await this.#draft.remove('text', redisTextKey(this.#organization, actual))
      }
    )

  has: IRedisInternalScope['has'] = (key) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.has,
      () => redisTextKey(this.#organization, key),
      async (actual) =>
        (await this.#draft.read('text', redisTextKey(this.#organization, actual))) !== undefined
    )

  getBytes: IRedisInternalScope['getBytes'] = (key) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.getBytes,
      () => redisTextKey(this.#organization, key),
      async (actual) =>
        ((await this.#draft.read('bytes', redisTextKey(this.#organization, actual))) as
          | Uint8Array
          | undefined) ?? null
    )

  setBytes: IRedisInternalScope['setBytes'] = (key, value, options) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.setBytes,
      () => ({
        ...redisCapturePoint(
          this.#organization,
          'bytes',
          redisTextKey(this.#organization, key),
          value
        ),
        policy: readTransactionConflictPolicy(options, RedisText.backend)
      }),
      async (actual) => {
        const prepared = redisPreparePoint(this.#organization, 'bytes', actual)
        await this.#draft.write(
          'bytes',
          prepared.key,
          prepared.wire,
          readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
        )
      }
    )

  removeBytes: IRedisInternalScope['removeBytes'] = (key) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.removeBytes,
      () => redisTextKey(this.#organization, key),
      async (actual) => {
        await this.#draft.remove('bytes', redisTextKey(this.#organization, actual))
      }
    )

  getRecord: IRedisInternalScope['getRecord'] = (input) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.getRecord,
      () => redisKey(this.#organization, input),
      (actual) => this.#draft.read('record', redisKey(this.#organization, actual))
    )

  putRecord: IRedisInternalScope['putRecord'] = (value, input, options) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.putRecord,
      () => ({
        ...redisCapturePoint(this.#organization, 'record', input ?? crypto.randomUUID(), value),
        policy: readTransactionConflictPolicy(options, RedisText.backend)
      }),
      async (actual) => {
        const prepared = redisPreparePoint(this.#organization, 'record', actual)
        await this.#draft.write(
          'record',
          prepared.key,
          prepared.wire,
          readTransactionConflictPolicy({ conflictPolicy: actual.policy }, RedisText.backend)
        )
        return prepared.key
      }
    )

  deleteRecord: IRedisInternalScope['deleteRecord'] = (input) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.deleteRecord,
      () => redisKey(this.#organization, input),
      async (actual) => {
        await this.#draft.remove('record', redisKey(this.#organization, actual))
      }
    )

  iterateRecords: IRedisInternalScope['iterateRecords'] = (range) => {
    assertTransactionOwner(this.#organization.store, this)
    return redisIterator(this.#organization, range, undefined, this.#draft, this)
  }

  getMany: IRedisInternalScope['getMany'] = (inputs) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.getMany,
      () => snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key),
      async (actual) =>
        (
          await this.#draft.loadMany(
            'text',
            snapshotStorageBatchKeys(actual, RedisText.backend).map((entry) => entry.key)
          )
        ).map((entry) =>
          entry.value === undefined ? undefined : (decodeRedisValue('text', entry.value) as string)
        ),
      (actual) => actual.length
    )

  setMany: IRedisInternalScope['setMany'] = (entries) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.setMany,
      () => redisCaptureEntries(this.#organization, entries),
      async (actual) => {
        const prepared = redisPrepareEntries(this.#organization, actual)
        for (const entry of prepared)
          await this.#draft.write('text', entry.key, entry.wire, 'conflict', entry.ttlMs)
      },
      (actual) => actual.length
    )

  removeMany: IRedisInternalScope['removeMany'] = (inputs) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.removeMany,
      () => snapshotStorageBatchKeys(inputs, RedisText.backend).map((entry) => entry.key),
      async (actual) => {
        const prepared = snapshotStorageBatchKeys(actual, RedisText.backend)
        let count = 0
        for (const entry of prepared) if (await this.#draft.remove('text', entry.key)) count++
        return count
      },
      (actual) => actual.length
    )

  removeByPrefix: IRedisInternalScope['removeByPrefix'] = (prefix) =>
    redisScoped(
      this.#organization,
      this,
      this.#draft,
      RedisOperation.removeByPrefix,
      () => redisKey(this.#organization, prefix),
      (actual) =>
        redisRemovePrefix(
          this.#organization,
          'text',
          redisKey(this.#organization, actual),
          this.#draft
        )
    );

  [recordsApi]: IRedisInternalScope[typeof recordsApi] = {
    query: <R>() =>
      createRecordQuery<R, undefined>(
        {
          asyncDisposeKey,
          pushdown: { source: RedisText.backend, operations: [], operators: [] },
          execute: () => {
            assertTransactionOwner(this.#organization.store, this)
            return redisIterator(this.#organization, undefined, undefined, this.#draft, this)
          },
          mutate: (request, run) =>
            redisScoped(
              this.#organization,
              this,
              this.#draft,
              request.operation === 'delete'
                ? RedisOperation.queryDelete
                : RedisOperation.queryUpdate,
              () => request,
              (actual, current) =>
                redisMutate(this.#organization, this.#draft, actual, run, current)
            )
        },
        this.#organization.environment.core.getChainMethods('query')
      ),
    removeByPrefix: (input) =>
      redisScoped(
        this.#organization,
        this,
        this.#draft,
        RedisOperation.removeByPrefix,
        () => redisKey(this.#organization, input),
        (actual) =>
          redisRemovePrefix(
            this.#organization,
            'record',
            redisKey(this.#organization, actual),
            this.#draft
          )
      )
  };

  [ttlApi]: IRedisInternalScope[typeof ttlApi] = {
    expire: (target, ms) =>
      redisScoped(
        this.#organization,
        this,
        this.#draft,
        RedisOperation.expire,
        () => {
          const captured = redisTtlTarget(this.#organization, target)
          assertStorageTtlDuration(ms, RedisText.backend)
          return { target: captured, ms }
        },
        (actual) => {
          const target = redisTtlTarget(this.#organization, actual.target)
          assertStorageTtlDuration(actual.ms, RedisText.backend)
          return target.channel === 'vector'
            ? redisSelectedVector(this.#organization).expire(this.#draft, target, actual.ms)
            : this.#draft.expire(target.channel, target.key, actual.ms)
        }
      ),
    remaining: (target) =>
      redisScoped(
        this.#organization,
        this,
        this.#draft,
        RedisOperation.remaining,
        () => redisTtlTarget(this.#organization, target),
        (actual) => {
          const target = redisTtlTarget(this.#organization, actual)
          return target.channel === 'vector'
            ? redisSelectedVector(this.#organization).remaining(this.#draft, target)
            : this.#draft.remaining(target.channel, target.key)
        }
      ),
    persist: (target) =>
      redisScoped(
        this.#organization,
        this,
        this.#draft,
        RedisOperation.persist,
        () => redisTtlTarget(this.#organization, target),
        (actual) => {
          const target = redisTtlTarget(this.#organization, actual)
          return target.channel === 'vector'
            ? redisSelectedVector(this.#organization).expire(this.#draft, target)
            : this.#draft.expire(target.channel, target.key)
        }
      )
  };

  [counterApi]: IRedisInternalScope[typeof counterApi] = {
    increment: (input, by) =>
      redisScoped(
        this.#organization,
        this,
        this.#draft,
        RedisOperation.increment,
        () => {
          snapshotStorageCounterIncrement(by, RedisText.backend)
          return { key: redisTextKey(this.#organization, input), by }
        },
        (actual) => this.#draft.increment(redisTextKey(this.#organization, actual.key), actual.by)
      )
  }

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organization: IRedisOrganizationContext, draft: RedisDraft) {
    this.#organization = organization
    this.#draft = draft
  }
}

/** Every original view receives fresh closures over the same draft, never a copied old scope. */
export function redisCreateScope(
  organization: IRedisOrganizationContext,
  draft: RedisDraft
): IRedisInternalScope {
  const scope: IRedisInternalScope = new RedisScope(organization, draft)
  organization.environment.scopeDrafts.set(scope, { store: organization.store, draft })
  return scope
}
