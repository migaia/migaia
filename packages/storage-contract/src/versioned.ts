import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  hostRethrowReporter,
  raceWithAbort,
  UtilsAbortError,
  type IAbortSignal,
  type IUtilsReporter
} from '@migaia/utils/promise'
import { isUtilsError, UtilsErrorCode } from '@migaia/utils/error'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'

/** Archive shape shared by persistence consumers; state remains caller-owned. */
export type IVersionedEnvelope<TState = unknown> = {
  readonly version: number
  readonly state: TState
}

/** One migration transition, with the caller's cooperative cancellation signal when supplied. */
export type IMigrationStepContext = {
  readonly fromVersion: number
  readonly toVersion: number
  readonly signal?: IAbortSignal
}

/** Historical data has no business schema; a step owns its input/output conversion. */
export type IMigrationStep = (previous: unknown, context: IMigrationStepContext) => unknown

/** Callable then properties identify migration results that need asynchronous execution. */
type IThenableMigrationResult = { readonly then: (...args: never[]) => unknown }
/** Known thenables are rejected statically; erased unknown results are checked at runtime. */
type ISyncMigrationCheck<TStep extends IMigrationStep> =
  Extract<ReturnType<TStep>, IThenableMigrationResult> extends never ? unknown : never

/** Reset creates one fresh state without expanding a potentially large version interval. */
export type IMigrationReset = { readonly reset: () => unknown }

/** Preserves step inference while excluding known asynchronous recovery callbacks. */
export type ISyncMigrationSteps<
  TSteps extends Readonly<Record<number, IMigrationStep>> | IMigrationReset
> = TSteps extends IMigrationReset
  ? { readonly reset: TSteps['reset'] & ISyncMigrationCheck<TSteps['reset']> }
  : {
      readonly [K in keyof TSteps]: TSteps[K] extends IMigrationStep
        ? TSteps[K] & ISyncMigrationCheck<TSteps[K]>
        : never
    }

/** Immutable migration snapshot; baseVersion is the oldest archive this plan can recover. */
export type IMigrationPlan<TStep extends IMigrationStep = IMigrationStep> = {
  readonly version: number
  readonly baseVersion: number
  readonly steps: Readonly<Record<number, TStep>>
  readonly reset?: () => ReturnType<TStep>
}

/** Optional observation only; callback failures never change migration execution. */
export type IMigrationStepObserver = {
  readonly beforeStep?: (context: IMigrationStepContext) => void | PromiseLike<void>
  readonly afterStep?: (context: IMigrationStepContext) => void | PromiseLike<void>
  readonly report?: (error: unknown) => undefined
}

/** Borrowed cancellation and reporting ports; this converter owns no resource lifetime. */
export type IMigrationRunOptions = {
  readonly observe?: IMigrationStepObserver
  readonly signal?: IAbortSignal
  readonly report?: IUtilsReporter
}

/** Validates the archive's fixed shape, reading each field once without copying state. */
export function assertVersionedEnvelope<TState>(
  value: IVersionedEnvelope<TState>
): IVersionedEnvelope<TState>
export function assertVersionedEnvelope(value: unknown): IVersionedEnvelope
export function assertVersionedEnvelope(value: unknown): IVersionedEnvelope {
  try {
    if (typeof value !== 'object' || value === null)
      throw new TypeError(StorageContractErrorText.envelopeInvalid)
    /** Only plain records represent the shared archive container. */
    const prototype: unknown = Object.getPrototypeOf(value)
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      !Object.hasOwn(value, 'version') ||
      !Object.hasOwn(value, 'state')
    )
      throw new TypeError(StorageContractErrorText.envelopeInvalid)
    /** Capture each getter exactly once before returning a fresh container. */
    const { version, state } = value as { readonly version: unknown; readonly state: unknown }
    if (
      !Number.isSafeInteger(version) ||
      (version as number) < 0 ||
      state === null ||
      state === undefined
    )
      throw new TypeError(StorageContractErrorText.envelopeInvalid)
    return { version: version as number, state }
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.envelopeInvalid,
      { cause },
      StorageContractErrorText.envelopeInvalid
    )
  }
}

/** Snapshots reset in constant space, or checks and copies a contiguous step range in one pass. */
export function createMigrationPlan<TReset extends () => unknown>(options: {
  readonly version: number
  readonly reset: TReset
}): IMigrationPlan<TReset>
export function createMigrationPlan<TStep extends IMigrationStep>(options: {
  readonly version: number
  readonly steps?: Readonly<Record<number, TStep>>
}): IMigrationPlan<TStep>
export function createMigrationPlan(options: {
  readonly version: number
  readonly steps?: Readonly<Record<number, IMigrationStep>>
  readonly reset?: () => unknown
}): IMigrationPlan {
  /** Snapshot errors are mapped after their category has been selected locally. */
  let code = StorageContractErrorCode.invalidArgument as
    | typeof StorageContractErrorCode.invalidArgument
    | typeof StorageContractErrorCode.migrationGap
  try {
    if (typeof options !== 'object' || options === null || Array.isArray(options))
      throw new TypeError(StorageContractErrorText.migrationOptions)
    /** Capture public configuration once; subsequent mutations cannot alter the plan. */
    const version = options.version
    if (!Number.isSafeInteger(version) || version < 0)
      throw new TypeError(StorageContractErrorText.migrationOptions)
    /** Fresh null-prototype storage has no inherited migration aliases. */
    const steps: Record<number, IMigrationStep> = Object.create(null)
    if (Object.hasOwn(options, 'reset')) {
      /** Reset and steps are distinct public plan forms. */
      const reset = options.reset
      if (typeof reset !== 'function' || Object.hasOwn(options, 'steps'))
        throw new TypeError(StorageContractErrorText.migrationOptions)
      return Object.freeze({ version, baseVersion: 0, steps: Object.freeze(steps), reset })
    }
    /** Missing steps support only the current version; no version-range enumeration occurs. */
    const source = options.steps
    if (source === undefined)
      return Object.freeze({ version, baseVersion: version, steps: Object.freeze(steps) })
    if (typeof source !== 'object' || source === null || Array.isArray(source))
      throw new TypeError(StorageContractErrorText.migrationOptions)
    /** A minimum plus count proves contiguity after canonical integer-key validation. */
    let minimum = version
    /** Counts only enumerable own steps, so ignored properties cannot fill a gap. */
    let count = 0
    for (const key of Reflect.ownKeys(source)) {
      if (!Object.getOwnPropertyDescriptor(source, key)?.enumerable) continue
      /** Canonical spelling rejects numeric aliases before they affect the range proof. */
      const target = typeof key === 'string' ? Number(key) : NaN
      if (
        typeof key !== 'string' ||
        String(target) !== key ||
        !Number.isSafeInteger(target) ||
        target < 1 ||
        target > version
      ) {
        code = StorageContractErrorCode.migrationGap
        throw new TypeError(StorageContractErrorText.migrationGap)
      }
      /** One getter read freezes the original callback identity into this plan. */
      const step = source[target]
      if (typeof step !== 'function') throw new TypeError(StorageContractErrorText.migrationStep)
      steps[target] = step
      minimum = Math.min(minimum, target)
      count += 1
    }
    if (count !== 0 && version - minimum + 1 !== count) {
      code = StorageContractErrorCode.migrationGap
      throw new TypeError(StorageContractErrorText.migrationGap)
    }
    return Object.freeze({
      version,
      baseVersion: count === 0 ? version : minimum - 1,
      steps: Object.freeze(steps)
    })
  } catch (cause) {
    throw new StorageContractError(
      code,
      { cause },
      code === StorageContractErrorCode.migrationGap
        ? StorageContractErrorText.migrationGap
        : StorageContractErrorText.migrationOptions
    )
  }
}

/** Rejects archives outside this immutable plan's supported interval before executing callbacks. */
function checkVersion(plan: IMigrationPlan, envelope: IVersionedEnvelope): void {
  if (envelope.version > plan.version || envelope.version < plan.baseVersion)
    throw new StorageContractError(
      StorageContractErrorCode.versionUnsupported,
      {},
      StorageContractErrorText.versionUnsupported
    )
}

/** Lets the existing thenable observer route an absent or failed reporter to the host queue. */
function rethrowObservation(error: unknown): undefined {
  throw error
}

/** Calls one observer without waiting; shared utilities own thenable and reporter failure handling. */
function observeStep(
  observer: IMigrationStepObserver | undefined,
  phase: 'beforeStep' | 'afterStep',
  context: IMigrationStepContext
): void {
  /** Without a listener, no observer result or event payload is allocated. */
  const callback = observer?.[phase]
  if (!callback) return
  /** The observer reports synchronously; asynchronous sinks belong to its external adapter. */
  const report = observer?.report ?? rethrowObservation
  try {
    /** The then getter is inspected once and shared with rejection observation. */
    const result = callback(context)
    observeThenableRejection(result, inspectThenable(result), report)
  } catch (error) {
    observeThenableRejection(undefined, { error }, report)
  }
}

/** Preserves the failed transition and original error without changing its native identity or stack. */
function migrationFailure(
  cause: unknown,
  fromVersion: number,
  toVersion: number
): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.migrationFailed,
    { cause, fromVersion, toVersion },
    StorageContractErrorText.migrationFailed
  )
}

/** Enforces synchronous recovery while consuming any rejected migration thenable. */
function synchronousResult(result: unknown, observer: IMigrationStepObserver | undefined): unknown {
  /** The result's then getter is read once, including a possible getter failure. */
  const inspection = inspectThenable(result)
  if ('error' in inspection) throw inspection.error
  if (inspection.then !== undefined) {
    observeThenableRejection(result, inspection, observer?.report ?? rethrowObservation)
    throw new TypeError(StorageContractErrorText.migrationSyncThenable)
  }
  return result
}

/** Executes an immutable plan synchronously; user state mutations and external side effects remain. */
export function migrateEnvelopeSync<TStep extends IMigrationStep>(
  plan: IMigrationPlan<TStep> & ISyncMigrationCheck<NoInfer<TStep>>,
  envelope: IVersionedEnvelope,
  options?: { readonly observe?: IMigrationStepObserver }
): unknown {
  checkVersion(plan, envelope)
  if (envelope.version === plan.version) return envelope.state
  if (plan.reset) {
    try {
      return synchronousResult(plan.reset(), options?.observe)
    } catch (cause) {
      throw migrationFailure(cause, envelope.version, plan.version)
    }
  }
  /** Holds only this invocation's current state; the plan has no mutable execution state. */
  let current = envelope.state
  for (let version = envelope.version + 1; version <= plan.version; version += 1) {
    /** A real step already needs this context; observation borrows the same object. */
    const context = { fromVersion: version - 1, toVersion: version }
    observeStep(options?.observe, 'beforeStep', context)
    try {
      current = synchronousResult(plan.steps[version]!(current, context), options?.observe)
    } catch (cause) {
      throw migrationFailure(cause, version - 1, version)
    }
    observeStep(options?.observe, 'afterStep', context)
  }
  return current
}

/** Executes asynchronous steps with borrowed cancellation, one immutable plan and no storage writes. */
export async function migrateEnvelope(
  plan: IMigrationPlan,
  envelope: IVersionedEnvelope,
  options?: IMigrationRunOptions
): Promise<unknown> {
  /** Track a user failure without wrapping it before the utility can observe a late rejection. */
  let failed:
    | { readonly cause: unknown; readonly fromVersion: number; readonly toVersion: number }
    | undefined
  try {
    return await raceWithAbort(
      async ({ signal }) => {
        checkVersion(plan, envelope)
        if (envelope.version === plan.version) return envelope.state
        if (plan.reset) {
          try {
            return await plan.reset()
          } catch (cause) {
            failed = { cause, fromVersion: envelope.version, toVersion: plan.version }
            throw cause
          }
        }
        /** All execution state is local, so one plan can recover archives concurrently. */
        let current = envelope.state
        for (let version = envelope.version + 1; version <= plan.version; version += 1) {
          if (signal.aborted) throw signal.reason
          /** User steps borrow the original signal; the shared utility owns its listener lifetime. */
          const context: IMigrationStepContext = options?.signal
            ? { fromVersion: version - 1, toVersion: version, signal: options.signal }
            : { fromVersion: version - 1, toVersion: version }
          observeStep(options?.observe, 'beforeStep', context)
          if (signal.aborted) throw signal.reason
          try {
            current = await plan.steps[version]!(current, context)
          } catch (cause) {
            failed = { cause, fromVersion: version - 1, toVersion: version }
            throw cause
          }
          if (signal.aborted) throw signal.reason
          observeStep(options?.observe, 'afterStep', context)
        }
        return current
      },
      {
        signal: options?.signal,
        report: options?.report ?? hostRethrowReporter,
        cleanupPolicy: 'report'
      }
    )
  } catch (cause) {
    if (failed && Object.is(failed.cause, cause))
      throw migrationFailure(cause, failed.fromVersion, failed.toVersion)
    if (cause instanceof UtilsAbortError)
      throw new StorageContractError(StorageContractErrorCode.aborted, { cause: cause.cause })
    if (isUtilsError(cause) && cause.code === UtilsErrorCode.invalidArgument)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
    throw cause
  }
}
