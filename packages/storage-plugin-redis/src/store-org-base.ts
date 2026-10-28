// Native resource, feature port and per-organization store class for the Redis store (see ./store.ts).
import {
  createBackendChangeIterator,
  runWithConcurrency,
  createTransactionBuilder,
  asyncDisposeKey,
  reportCleanupError,
  withAbort,
  mergeSignals,
  subscribeToAbort,
  throwIfAborted,
  observeStorageBatch
} from '@migaia/storage-host/sdk'
import { RedisOperation } from './constants.ts'
import type { IStorageResource, ILockHolding } from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { createRedisLocks } from './locks.ts'
import { invalidArgument } from './errors.ts'
import { RedisText } from './constants.ts'
import { redisCapabilities, type IRedisNativeStore } from './types.ts'
import { nativeFeaturePort, type IRedisNativeFeaturePort } from './native-feature.ts'
import { redisPage, redisRemovePrefix, redisClearBytes, redisIterator } from './store-records.ts'
import {
  redisAssertWrite,
  redisOperate,
  redisOperations,
  redisRead,
  redisConcurrencyStages,
  redisObserve,
  redisCommand
} from './store-state.ts'
import type { IRedisOrganizationContext } from './store-state.ts'
import {
  redisGet,
  redisPut,
  redisRemove,
  redisClear,
  redisTransaction
} from './store-transaction.ts'
import { redisWrite, redisTextKey, redisKey, redisBounds } from './store-write.ts'

/**
 * One borrowed native resource retains its original abort subscription and underlying Promise
 * identity.
 */
class RedisNativeResource implements IStorageResource {
  /** The existing installation set owns accepted resources until native cleanup settles. */
  readonly #organization: IRedisOrganizationContext
  /** The Feature's actual resource owns the original cleanup, not a new lifecycle. */
  readonly #underlying: IStorageResource
  /** The original merged signal remains owned until this native resource releases. */
  readonly #merged: ReturnType<typeof mergeSignals>
  /** Only the existing abort listener is removed after underlying cleanup settles. */
  #off: () => void = () => {}
  /** Register the original accepted resource before subscribing to its cancellation signal. */
  constructor(
    organization: IRedisOrganizationContext,
    underlying: IStorageResource,
    merged: ReturnType<typeof mergeSignals>
  ) {
    this.#organization = organization
    this.#underlying = underlying
    this.#merged = merged
    organization.environment.resources.add(this)
    this.#off = subscribeToAbort(
      merged.signal,
      () => {
        void this[asyncDisposeKey]()
      },
      organization.environment.report
    )
  }
  /** Release borrowed references after either successful or failed native cleanup. */
  #release(): void {
    this.#off()
    this.#merged.dispose()
    this.#organization.environment.resources.delete(this)
  }
  /** Return the underlying explicit Promise unchanged and observe its settlement only for release. */
  readonly dispose = (): Promise<void> => {
    const pending = this.#underlying.dispose()
    void pending.then(
      () => this.#release(),
      () => this.#release()
    )
    return pending
  }
  /**
   * Return the underlying symbolic Promise unchanged, preserving its original report-only
   * semantics.
   */
  readonly [asyncDisposeKey] = (): Promise<void> => {
    const pending = this.#underlying[asyncDisposeKey]()
    void pending.then(
      () => this.#release(),
      () => this.#release()
    )
    return pending
  }
}
/** Assemble the original native methods from explicit organization state. */
function createRedisNativePort(organization: IRedisOrganizationContext): IRedisNativeFeaturePort {
  return {
    driver: organization.nativeDriver,
    layout: organization.layout,
    assertLive: () => organization.environment.controller.assertLive(),
    beginOperation: () => organization.environment.controller.beginMutation(),
    own: (resource) => {
      organization.environment.controller.assertLive()
      organization.environment.resources.add(resource)
      return () => {
        organization.environment.resources.delete(resource)
      }
    },
    chain: () =>
      organization.environment.core.getChainMethods('vector') as Record<never, never> | undefined,
    watch: (ctx) =>
      createBackendChangeIterator(organization.environment.controller, {
        orgId: organization.orgId,
        channel: 'all',
        ctx
      }),
    mutate: (name, input, ctx, capture, keys, run, policy) =>
      redisWrite(organization, name, input, ctx, capture, keys, run, undefined, policy),
    enableVector: (create) => {
      organization.environment.vectorFactory = create
      organization.vectorBinding ??= create(organization.store)
    },
    now: () => organization.environment.core.featureExpose.getScheduler().now(),
    closingSignal: organization.environment.controller.closingSignal,
    allOrganizations: organization.allOrganizations,
    enableDurable: (maxLen, create) => {
      if (
        !Number.isSafeInteger(maxLen) ||
        maxLen < 1 ||
        (organization.environment.durableMaxLen !== undefined &&
          organization.environment.durableMaxLen !== maxLen)
      )
        throw invalidArgument()
      organization.environment.durableMaxLen = maxLen
      organization.environment.durableFactory = create
    },
    run: (name, input, ctx, writing, run, pipeline = true) => {
      if (writing) redisAssertWrite(organization.environment)
      else organization.environment.controller.assertLive()
      const finish = organization.environment.controller.beginMutation()
      return withAbort(ctx, async (signal, context) => {
        if (organization.ports.journal !== undefined) await organization.ports.journal.prepare()
        const invoke = (actual: typeof input) => {
          throwIfAborted(signal)
          return organization.nativeDriver.withConnection((connection) =>
            run(actual, connection, organization.layout, signal)
          )
        }
        return pipeline
          ? redisOperate(organization, name, input, context, undefined, invoke)
          : observeStorageBatch(
              redisOperations(organization),
              organization.environment.core.featureExpose.getScheduler(),
              name,
              undefined,
              () => invoke(input)
            )
      }).finally(finish)
    },
    resource: (name, input, ctx, run, pipeline = true) => {
      organization.environment.controller.assertLive()
      const finish = organization.environment.controller.beginMutation()
      let merged: ReturnType<typeof mergeSignals>
      try {
        merged = mergeSignals(ctx, organization.environment.report)
      } catch (error) {
        finish()
        throw error
      }
      const invoke = async (actual: typeof input): Promise<IStorageResource> => {
        if (organization.ports.journal !== undefined) await organization.ports.journal.prepare()
        throwIfAborted(merged.signal)
        const underlying = await run(actual, organization.layout, merged.signal)
        const resource = new RedisNativeResource(organization, underlying, merged)
        try {
          throwIfAborted(merged.signal)
        } catch (error) {
          await resource[asyncDisposeKey]()
          throw error
        }
        return resource
      }
      const pending = pipeline
        ? redisOperate(organization, name, input, merged.context, undefined, invoke)
        : observeStorageBatch(
            redisOperations(organization),
            organization.environment.core.featureExpose.getScheduler(),
            name,
            undefined,
            () => invoke(input)
          )
      return pending
        .catch((error) => {
          merged.dispose()
          throw error
        })
        .finally(finish)
    },
    report: (error) => reportCleanupError(organization.environment.report, error)
  }
}

/**
 * Store shape the RedisOrgBase class implements; named because implements cannot take an
 * intersection.
 */
type IRedisOrgBaseShape = IRedisNativeStore & {
  readonly [nativeFeaturePort]: IRedisNativeFeaturePort
}

/** One organization's native Redis store: text, bytes and record channels under its key prefix. */
class RedisOrgBase implements IRedisOrgBaseShape {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organization: IRedisOrganizationContext;

  [nativeFeaturePort]: IRedisOrgBaseShape[typeof nativeFeaturePort]

  backend: IRedisOrgBaseShape['backend'] = RedisText.backend

  capabilities: IRedisOrgBaseShape['capabilities'] = redisCapabilities

  dispose: IRedisOrgBaseShape['dispose'];

  [asyncDisposeKey]: IRedisOrgBaseShape[typeof asyncDisposeKey] = () =>
    (this.#organization.symbolic ??= this.#organization.environment.controller
      .dispose()
      .then(undefined, (error) => reportCleanupError(this.#organization.environment.report, error)))

  get: IRedisOrgBaseShape['get'] = (input, ctx) =>
    redisGet(this.#organization, 'text', redisTextKey(this.#organization, input), ctx).then(
      (value) => (value as string | undefined) ?? null
    )

  set: IRedisOrgBaseShape['set'] = (input, value, ctx) =>
    redisPut(this.#organization, 'text', redisTextKey(this.#organization, input), value, ctx)

  remove: IRedisOrgBaseShape['remove'] = (input, ctx) =>
    redisRemove(this.#organization, 'text', redisTextKey(this.#organization, input), ctx)

  has: IRedisOrgBaseShape['has'] = (input, ctx) =>
    redisGet(this.#organization, 'text', redisTextKey(this.#organization, input), ctx).then(
      (value) => value !== undefined
    )

  getBytes: IRedisOrgBaseShape['getBytes'] = (input, ctx) =>
    redisGet(this.#organization, 'bytes', redisTextKey(this.#organization, input), ctx).then(
      (value) => (value as Uint8Array | undefined) ?? null
    )

  setBytes: IRedisOrgBaseShape['setBytes'] = (input, value, ctx) => {
    if (!isUint8Array(value)) throw invalidArgument()
    return redisPut(
      this.#organization,
      'bytes',
      redisTextKey(this.#organization, input),
      value,
      ctx
    )
  }

  removeBytes: IRedisOrgBaseShape['removeBytes'] = (input, ctx) =>
    redisRemove(this.#organization, 'bytes', redisTextKey(this.#organization, input), ctx)

  getRecord: IRedisOrgBaseShape['getRecord'] = (input, ctx) =>
    redisGet(this.#organization, 'record', input, ctx)

  putRecord: IRedisOrgBaseShape['putRecord'] = async (value, input, ctx) => {
    const captured = redisKey(this.#organization, input ?? crypto.randomUUID())
    await redisPut(this.#organization, 'record', captured, value, ctx)
    return captured
  }

  deleteRecord: IRedisOrgBaseShape['deleteRecord'] = (input, ctx) =>
    redisRemove(this.#organization, 'record', input, ctx)

  keys: IRedisOrgBaseShape['keys'] = (ctx) =>
    redisRead(this.#organization, RedisOperation.keys, {}, ctx, async (_input, send) => {
      const result: string[] = [],
        [initial, upper] = redisBounds(this.#organization)
      let lower = initial
      for (;;) {
        const next = await redisPage(this.#organization, 'text', send, lower, upper, 128)
        for (const [key] of next.rows) if (typeof key === 'string') result.push(key)
        if (next.done || next.last === undefined) return result
        lower = '(' + next.last
      }
    })

  clearValues: IRedisOrgBaseShape['clearValues'] = (ctx) =>
    redisWrite(
      this.#organization,
      RedisOperation.clearValues,
      {},
      ctx,
      (input) => input,
      () => [],
      async (draft) => {
        await redisRemovePrefix(this.#organization, 'text', undefined, draft)
      }
    )

  clearBytes: IRedisOrgBaseShape['clearBytes'] = (ctx) =>
    redisWrite(
      this.#organization,
      RedisOperation.clearBytes,
      {},
      ctx,
      (input) => input,
      () => [],
      (draft) => redisClearBytes(this.#organization, draft)
    )

  clearRecords: IRedisOrgBaseShape['clearRecords'] = (ctx) =>
    redisWrite(
      this.#organization,
      RedisOperation.clearRecords,
      {},
      ctx,
      (input) => input,
      () => [],
      async (draft) => {
        await redisRemovePrefix(this.#organization, 'record', undefined, draft)
      }
    )

  clearAll: IRedisOrgBaseShape['clearAll'] = (ctx) => redisClear(this.#organization, false, ctx)

  iterateRecords: IRedisOrgBaseShape['iterateRecords'] = (range, ctx) =>
    redisIterator(this.#organization, range, ctx)

  transaction: IRedisOrgBaseShape['transaction'] = (...args) =>
    redisTransaction(this.#organization, ...args)

  tx: IRedisOrgBaseShape['tx'] = () => {
    this.#organization.environment.controller.assertLive()
    return createTransactionBuilder(
      this.#organization.store,
      undefined,
      this.#organization.environment.core.getChainMethods('tx')
    )
  }

  inspectLocks: IRedisOrgBaseShape['inspectLocks'] = (ctx) => {
    this.#organization.environment.controller.assertLive()
    const finish = this.#organization.environment.controller.beginMutation()
    return runWithConcurrency<readonly ILockHolding[]>(
      {
        store: this.#organization.store,
        options: ctx ?? {},
        execute: (context, proceed) =>
          redisOperate(
            this.#organization,
            RedisOperation.inspectLocks,
            {},
            context,
            undefined,
            proceed
          )
      },
      {
        attempt: async (context) => {
          const stages = redisConcurrencyStages(this.#organization)
          redisObserve(this.#organization.environment, stages, 'beforeLockInspect')
          try {
            const value = await this.#organization.environment.driver.withConnection((connection) =>
              createRedisLocks({
                layout: this.#organization.layout,
                context,
                owner: this.#organization.environment.controller.origin,
                label: this.#organization.environment.label,
                maxLockMs: this.#organization.environment.maxLockMs,
                send: (args) =>
                  redisCommand(
                    this.#organization.environment,
                    connection,
                    args,
                    this.#organization.orgId
                  )
              }).inspect()
            )
            redisObserve(this.#organization.environment, stages, 'afterLockInspect', value.length)
            return { status: 'committed' as const, value }
          } catch (error) {
            redisObserve(
              this.#organization.environment,
              stages,
              'onLockInspectError',
              error instanceof Error ? Reflect.get(error, 'code') : undefined
            )
            throw error
          }
        }
      }
    ).finally(finish)
  }

  subscribeChanges: IRedisOrgBaseShape['subscribeChanges'] = (listener) => {
    this.#organization.environment.controller.assertLive()
    return this.#organization.environment.controller.subscribe((change) => {
      if (this.#organization.allOrganizations || change.orgId === this.#organization.orgId)
        return listener(change)
    })
  }

  watch: IRedisOrgBaseShape['watch'] = (input, ctx) =>
    createBackendChangeIterator(this.#organization.environment.controller, {
      orgId: this.#organization.orgId,
      channel: 'value',
      key: redisTextKey(this.#organization, input),
      ctx,
      execute: (advance, context) =>
        redisOperate(this.#organization, RedisOperation.watch, {}, context, undefined, advance)
    })

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organization: IRedisOrganizationContext) {
    this.#organization = organization
    this[nativeFeaturePort] = createRedisNativePort(this.#organization)
    this.dispose = this.#organization.environment.controller.dispose
  }
}

/** Assemble the original base methods from explicit organization state. */
export function createRedisBase(
  organization: IRedisOrganizationContext
): IRedisNativeStore & { readonly [nativeFeaturePort]: IRedisNativeFeaturePort } {
  return new RedisOrgBase(organization)
}
