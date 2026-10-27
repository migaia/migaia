import {
  createBackendChangeController,
  ConcurrencyPolicy,
  runWithConcurrency,
  provideCapabilities,
  createTransactionOwner,
  assertTransactionOwner,
  asyncDisposeKey,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import { RedisCommand } from './constants.js'
import { kv, records, ttl, counter, implement } from '@migaia/storage-contract'
import type { IStoragePluginCore } from '@migaia/storage-host'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisDraft } from './transaction.js'
import { createRedisJournalBinding } from './journal.js'
import { createRedisLayout } from './layout.js'
import {
  invalidArgument,
  unsupported,
  normalizeRedisTransactionFailure,
  redisError
} from './errors.js'
import { RedisText } from './constants.js'
import { decodeRedisChange } from './changes.js'
import type { IRedisOptions } from './types.js'
import {
  createRedisKeyValue,
  createRedisRecordApi,
  createRedisTtlApi,
  createRedisCounterApi
} from './store-apis.js'
import { redisNativeAttempt } from './store-native-attempt.js'
import { createRedisBase } from './store-org-base.js'
import {
  ttlApi,
  counterApi,
  recordsApi,
  redisConcurrencyStages,
  redisForOrg,
  redisAssertWrite
} from './store-state.js'
import type {
  IRedisEnvironment,
  IRedisOrganizationProjection,
  IRedisOrganizationContext,
  IRedisInternalScope,
  IRedisConstruction
} from './store-state.js'
import {
  createRedisNativeDriver,
  redisConfigureFeatures,
  redisReleaseFeatures,
  redisClear
} from './store-transaction.js'

/** Drain the original accepted resources and release org publication references once. */
async function disposeRedisEnvironment(environment: IRedisEnvironment): Promise<void> {
  const failures: unknown[] = []
  for (const resource of environment.resources) {
    try {
      await resource.dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  environment.resources.clear()
  if (environment.subscription) {
    try {
      await environment.subscription.dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  for (const projection of environment.projections.values()) {
    try {
      projection.releaseFeatures()
    } catch (error) {
      failures.push(error)
    }
  }
  environment.projections.clear()
  if (failures.length)
    throw redisError(
      RedisErrorCode.failed,
      new AggregateError(failures, RedisText.failed, { cause: failures[0] })
    )
}
/** Validate pure deployment metadata before publishing any organization or native port. */
function createRedisEnvironment(
  options: IRedisOptions,
  core: IStoragePluginCore
): IRedisEnvironment {
  const { driver, prefix = 'migaia', concurrency, owner, maxLockMs = 30000 } = options
  const label = owner?.label
  if (
    !driver ||
    typeof driver.command !== 'function' ||
    typeof driver.withConnection !== 'function' ||
    typeof driver.subscribe !== 'function' ||
    typeof prefix !== 'string' ||
    (label !== undefined && typeof label !== 'string') ||
    !Number.isSafeInteger(maxLockMs) ||
    maxLockMs < 1
  )
    throw invalidArgument()
  const environment: IRedisEnvironment = {
    driver,
    prefix,
    concurrency,
    label,
    maxLockMs,
    core,
    report: createStorageOperationReporter(),
    resources: new Set(),
    projections: new Map(),
    scopeDrafts: new WeakMap(),
    rootProjection: Symbol('redis-root-projection'),
    subscription: undefined,
    poison: undefined,
    durableMaxLen: undefined,
    durableFactory: undefined,
    vectorFactory: undefined,
    controller: undefined!
  }
  environment.controller = core.createChangeController(
    {
      backend: RedisText.backend,
      platform: driver,
      options,
      origin: crypto.randomUUID(),
      finalize: () => disposeRedisEnvironment(environment)
    },
    createBackendChangeController
  )
  return environment
}
/** Build one pure native organization projection without a second resource owner. */
export function createRedisOrganization(
  environment: IRedisEnvironment,
  orgId: string,
  allOrganizations: boolean
): IRedisOrganizationProjection {
  const organization: IRedisOrganizationContext = {
    environment,
    nativeDriver: undefined!,
    orgId,
    allOrganizations,
    ports: environment.core.getOrgContext(orgId),
    layout: createRedisLayout(environment.prefix, orgId),
    store: undefined!,
    installer: undefined!,
    transactionOwner: undefined!,
    symbolic: undefined,
    vectorBinding: undefined,
    vectorPublication: undefined,
    durablePublication: undefined
  }
  organization.nativeDriver = createRedisNativeDriver(organization)
  const base = createRedisBase(organization)
  const keyValue = createRedisKeyValue(organization, base)
  const recordApi = createRedisRecordApi(organization)
  const timeToLive = createRedisTtlApi(organization)
  const counters = createRedisCounterApi(organization)
  organization.store = provideCapabilities(
    base,
    [
      implement(kv, keyValue, { forTransaction: (scope) => scope }),
      implement(records, recordApi, {
        forTransaction: (scope) => (scope as IRedisInternalScope)[recordsApi]
      }),
      implement(ttl, timeToLive, {
        forTransaction: (scope) => (scope as IRedisInternalScope)[ttlApi]
      }),
      implement(counter, counters, {
        forTransaction: (scope) => (scope as IRedisInternalScope)[counterApi]
      })
    ] as const,
    {
      onInstaller: (value) => {
        organization.installer = value
      }
    }
  )
  organization.transactionOwner = createTransactionOwner<unknown, IRedisInternalScope>(
    organization.store,
    normalizeRedisTransactionFailure,
    {
      activityMode: 'managed',
      asyncDisposeKey,
      defaultPolicy: organization.environment.concurrency,
      concurrencyStages: redisConcurrencyStages(organization)
    }
  )
  const journal = createRedisJournalBinding({
    forOrg: (next) => redisForOrg(organization.environment, next).journal,
    assertLive: () => organization.environment.controller.assertLive(),
    controller: organization.environment.controller,
    report: (error) => reportCleanupError(organization.environment.report, error),
    run: <R>(work: (draft: RedisDraft) => Promise<R>): Promise<R> => {
      redisAssertWrite(organization.environment)
      const release = organization.environment.controller.beginMutation()
      return runWithConcurrency<R>(
        {
          store: organization.store,
          options: { signal: organization.environment.controller.closingSignal },
          policy: ConcurrencyPolicy.optimistic()
        },
        { attempt: (context) => redisNativeAttempt(organization, context, work, true, true) }
      )
        .catch((error) => {
          throw normalizeRedisTransactionFailure(error)
        })
        .finally(release)
    },
    state: (scope) => {
      const binding = organization.environment.scopeDrafts.get(scope),
        info = assertTransactionOwner(binding?.store ?? organization.store, scope)
      if (binding === undefined || binding.draft.layout.orgId !== organization.orgId)
        throw invalidArgument()
      return { draft: binding.draft, info }
    }
  })
  return {
    store: organization.store,
    installer: organization.installer,
    configureFeatures: (...args) => redisConfigureFeatures(organization, ...args),
    releaseFeatures: (...args) => redisReleaseFeatures(organization, ...args),
    journal,
    drop: () => redisClear(organization, true)
  }
}
/** Native detection and subscription stay in the original explicit host detection phase. */
async function detectRedisEnvironment(environment: IRedisEnvironment): Promise<void> {
  const info = await environment.driver.command([RedisCommand.info, RedisCommand.server])
  if (typeof info !== 'string') throw redisError(RedisErrorCode.decodeFailed, info)
  const valkey = /^valkey_version:(\d+)\.(\d+)\.(\d+)/m.exec(info),
    redis = /^redis_version:(\d+)\.(\d+)\.(\d+)/m.exec(info),
    version = valkey ?? redis
  if (
    !version ||
    Number(version[1]) < 7 ||
    (Number(version[1]) === 7 &&
      (Number(version[2]) < 2 || (valkey && Number(version[2]) === 2 && Number(version[3]) < 5)))
  )
    unsupported()
  if (!environment.subscription)
    environment.subscription = await environment.driver.subscribe(
      createRedisLayout(environment.prefix, environment.core.defaultOrgId).changes,
      (wire) => {
        try {
          const change = decodeRedisChange(wire)
          if (change.origin !== environment.controller.origin)
            environment.controller.publishExternal(change)
        } catch (error) {
          reportCleanupError(environment.report, error)
        }
      }
    )
}
/** Construct pure store projections first; original host detection owns all native setup I/O. */
export function createRedisStore(
  options: IRedisOptions,
  core: IStoragePluginCore
): IRedisConstruction {
  const environment = createRedisEnvironment(options, core)
  const root = redisForOrg(environment, core.defaultOrgId, true)
  return {
    ...root,
    controller: environment.controller,
    journalBinding: root.journal,
    orgBinding: {
      backend: (orgId) => redisForOrg(environment, orgId).store,
      drop: async (orgId) => {
        await redisForOrg(environment, orgId).drop()
      }
    },
    detect: () => detectRedisEnvironment(environment)
  }
}
export type { IRedisConstruction } from './store-state.js'
