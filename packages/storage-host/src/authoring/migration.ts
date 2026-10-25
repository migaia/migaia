import { observeThenableRejection } from '@migaia/utils/function'
import {
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IVersionedEnvelope,
  type IMigrationStepContext,
  type IMigrationStep,
  type IMigrationPlan,
  type IMigrationStepObserver,
  type IMigrationRunOptions,
  type ISyncMigrationCheck
} from '@migaia/storage-contract'
import {
  hostRethrowReporter,
  raceWithAbort,
  UtilsAbortError,
  type IAbortSignal
} from '@migaia/utils/promise'
import { isUtilsError, UtilsErrorCode } from '@migaia/utils/error'

/** Construct one registered plan-input failure without changing error messages. */
function invalidPlan(gap = false, text: string = StorageContractErrorText.migrationOptions): never {
  throw new StorageContractError(
    gap ? StorageContractErrorCode.migrationGap : StorageContractErrorCode.invalidArgument,
    { cause: new TypeError(text) },
    gap ? StorageContractErrorText.migrationGap : StorageContractErrorText.migrationOptions
  )
}

/** Own the version interval and callback table shared by repeated or concurrent migrations. */
class MigrationPlan implements IMigrationPlan {
  /** Public target version remains the same persisted archive contract. */
  readonly version: number
  /** The oldest supported archive follows from contiguous target steps. */
  readonly baseVersion: number
  /** The plan owns its callback table so later source edits cannot change an awaiting migration. */
  readonly steps: Readonly<Record<number, IMigrationStep>>
  /** Reset is present only on the reset form, preserving the original optional member shape. */
  declare readonly reset?: () => unknown

  /** Admit a reset or a contiguous callback range before any migration can execute. */
  constructor(options: {
    readonly version: number
    readonly steps?: Readonly<Record<number, IMigrationStep>>
    readonly reset?: () => unknown
  }) {
    if (
      typeof options !== 'object' ||
      options === null ||
      Array.isArray(options) ||
      !Number.isSafeInteger(options.version) ||
      options.version < 0
    )
      invalidPlan()
    this.version = options.version
    /** This retained snapshot spans each asynchronous step and future reuse of the same plan. */
    const steps: Record<number, IMigrationStep> = Object.create(null)
    this.steps = steps
    if (Object.hasOwn(options, 'reset')) {
      if (typeof options.reset !== 'function' || Object.hasOwn(options, 'steps')) invalidPlan()
      this.reset = options.reset
      this.baseVersion = 0
      return
    }
    if (options.steps === undefined) {
      this.baseVersion = this.version
      return
    }
    if (typeof options.steps !== 'object' || options.steps === null || Array.isArray(options.steps))
      invalidPlan()
    /** Minimum and count establish contiguity without enumerating absent version numbers. */
    let minimum = this.version
    /** Only enumerable own callbacks participate in the declared recovery range. */
    let count = 0
    for (const key of Reflect.ownKeys(options.steps)) {
      if (!Object.getOwnPropertyDescriptor(options.steps, key)?.enumerable) continue
      /** Canonical integer spelling excludes aliases of a target version. */
      const target = typeof key === 'string' ? Number(key) : NaN
      if (
        typeof key !== 'string' ||
        String(target) !== key ||
        !Number.isSafeInteger(target) ||
        target < 1 ||
        target > this.version
      )
        invalidPlan(true, StorageContractErrorText.migrationGap)
      if (typeof options.steps[target] !== 'function')
        invalidPlan(false, StorageContractErrorText.migrationStep)
      steps[target] = options.steps[target]!
      minimum = Math.min(minimum, target)
      count += 1
    }
    if (count !== 0 && this.version - minimum + 1 !== count)
      invalidPlan(true, StorageContractErrorText.migrationGap)
    this.baseVersion = count === 0 ? this.version : minimum - 1
  }
}

/** Snapshot one supported callback range before that plan crosses asynchronous execution. */
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
  return new MigrationPlan(options)
}

/** A missing observation sink keeps the original host exception policy. */
function rethrowObservation(error: unknown): never {
  throw error
}

/**
 * Reuse the existing reporter-failure route without inspecting a callback result or its then
 * getter.
 */
function reportObservation(observer: IMigrationStepObserver | undefined, error: unknown): void {
  observeThenableRejection(undefined, { error }, observer?.report ?? rethrowObservation)
}

/** Observe actual callback completion using ordinary Promise assimilation. */
function observeStep(
  observer: IMigrationStepObserver | undefined,
  phase: 'beforeStep' | 'afterStep',
  context: IMigrationStepContext
): void {
  if (!observer?.[phase]) return
  try {
    /** Observer work remains detached; no migration step waits for this notification. */
    const result = observer[phase](context)
    if (result !== undefined)
      void Promise.resolve(result).catch((error) => reportObservation(observer, error))
  } catch (error) {
    reportObservation(observer, error)
  }
}

/** Preserve the failed transition and the exact original cause. */
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

/** Reject genuine asynchronous work at a synchronous entry while observing its rejection. */
function synchronousResult(result: unknown, observer: IMigrationStepObserver | undefined): unknown {
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    void Promise.resolve(result).catch((error) => reportObservation(observer, error))
    throw new TypeError(StorageContractErrorText.migrationSyncThenable)
  }
  return result
}

/** Each migration invocation owns its current state and failure attribution. */
class MigrationRunner {
  /** The callback plan can be reused; execution state stays on this one runner. */
  readonly #plan: IMigrationPlan
  /** The entry supplies only the archive view needed by this execution mode. */
  readonly #envelope: IVersionedEnvelope
  /** The caller owns cancellation/reporting; this runner borrows the original ports. */
  readonly #options: IMigrationRunOptions | undefined
  /** A native step failure remains primary when the utility reports its actual settlement. */
  #failure:
    | { readonly cause: unknown; readonly fromVersion: number; readonly toVersion: number }
    | undefined

  /** Retain the admitted plan, archive view and borrowed callback ports. */
  constructor(plan: IMigrationPlan, envelope: IVersionedEnvelope, options?: IMigrationRunOptions) {
    this.#plan = plan
    this.#envelope = envelope
    this.#options = options
  }

  /** Reject an unsupported starting version before user callbacks execute. */
  #checkVersion(): void {
    if (
      this.#envelope.version > this.#plan.version ||
      this.#envelope.version < this.#plan.baseVersion
    )
      throw new StorageContractError(
        StorageContractErrorCode.versionUnsupported,
        {},
        StorageContractErrorText.versionUnsupported
      )
  }

  /** Run synchronous conversion without allowing PromiseLike results to escape as state. */
  runSync(): unknown {
    this.#checkVersion()
    if (this.#envelope.version === this.#plan.version) return this.#envelope.state
    if (this.#plan.reset) {
      try {
        return synchronousResult(this.#plan.reset(), this.#options?.observe)
      } catch (cause) {
        throw migrationFailure(cause, this.#envelope.version, this.#plan.version)
      }
    }
    /** Only this call mutates the transition accumulator. */
    let current = this.#envelope.state
    for (let version = this.#envelope.version + 1; version <= this.#plan.version; version += 1) {
      /** Both observation callbacks borrow the same real transition context. */
      const context = { fromVersion: version - 1, toVersion: version }
      observeStep(this.#options?.observe, 'beforeStep', context)
      try {
        current = synchronousResult(
          this.#plan.steps[version]!(current, context),
          this.#options?.observe
        )
      } catch (cause) {
        throw migrationFailure(cause, version - 1, version)
      }
      observeStep(this.#options?.observe, 'afterStep', context)
    }
    return current
  }

  /** The shared cancellation owner observes late rejections and releases its original listeners. */
  async run(): Promise<unknown> {
    try {
      return await raceWithAbort(({ signal }) => this.#execute(signal), {
        signal: this.#options?.signal,
        report: this.#options?.report ?? hostRethrowReporter,
        cleanupPolicy: 'report'
      })
    } catch (cause) {
      if (this.#failure && Object.is(this.#failure.cause, cause))
        throw migrationFailure(cause, this.#failure.fromVersion, this.#failure.toVersion)
      if (cause instanceof UtilsAbortError)
        throw new StorageContractError(StorageContractErrorCode.aborted, { cause: cause.cause })
      if (isUtilsError(cause) && cause.code === UtilsErrorCode.invalidArgument)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
      throw cause
    }
  }

  /** Execute one original plan in order, preserving the caller's signal on step contexts. */
  async #execute(signal: IAbortSignal): Promise<unknown> {
    this.#checkVersion()
    if (this.#envelope.version === this.#plan.version) return this.#envelope.state
    if (this.#plan.reset) {
      try {
        return await this.#plan.reset()
      } catch (cause) {
        this.#failure = {
          cause,
          fromVersion: this.#envelope.version,
          toVersion: this.#plan.version
        }
        throw cause
      }
    }
    /** State mutations made by user callbacks remain caller-owned and are never cloned here. */
    let current = this.#envelope.state
    for (let version = this.#envelope.version + 1; version <= this.#plan.version; version += 1) {
      if (signal.aborted) throw signal.reason
      /** Preserve the exact caller signal rather than the utility's borrowed cancellation view. */
      const context: IMigrationStepContext = this.#options?.signal
        ? { fromVersion: version - 1, toVersion: version, signal: this.#options.signal }
        : { fromVersion: version - 1, toVersion: version }
      observeStep(this.#options?.observe, 'beforeStep', context)
      if (signal.aborted) throw signal.reason
      try {
        current = await this.#plan.steps[version]!(current, context)
      } catch (cause) {
        this.#failure = { cause, fromVersion: version - 1, toVersion: version }
        throw cause
      }
      if (signal.aborted) throw signal.reason
      observeStep(this.#options?.observe, 'afterStep', context)
    }
    return current
  }
}

/** Recover an envelope synchronously with the same public static async-step exclusion. */
export function migrateEnvelopeSync<TStep extends IMigrationStep>(
  plan: IMigrationPlan<TStep> & ISyncMigrationCheck<NoInfer<TStep>>,
  envelope: IVersionedEnvelope,
  options?: { readonly observe?: IMigrationStepObserver }
): unknown {
  return new MigrationRunner(plan, envelope, options).runSync()
}

/** Recover an envelope asynchronously using the original cancellation and report channels. */
export function migrateEnvelope(
  plan: IMigrationPlan,
  envelope: IVersionedEnvelope,
  options?: IMigrationRunOptions
): Promise<unknown> {
  /** Capture only metadata that must remain stable while user migration callbacks await. */
  const archive = { version: envelope.version, state: envelope.state }
  return new MigrationRunner(plan, archive, options).run()
}
