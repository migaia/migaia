import type { IAbortSignal, IUtilsReporter } from '@migaia/utils/promise'
import { StorageContractError, StorageContractErrorCode } from './errors.ts'
import { StorageContractErrorText } from './error-text.ts'

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
export type ISyncMigrationCheck<TStep extends IMigrationStep> =
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

/** Migration plan contract; baseVersion is the oldest archive this plan can recover. */
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

/** Validate the public envelope shape without copying caller-owned state or metadata. */
export function assertVersionedEnvelope<TState>(
  value: IVersionedEnvelope<TState>
): IVersionedEnvelope<TState>
export function assertVersionedEnvelope(value: unknown): IVersionedEnvelope
export function assertVersionedEnvelope(value: unknown): IVersionedEnvelope {
  if (typeof value !== 'object' || value === null) return invalidEnvelope()
  /** Plain records are the supported persisted archive container. */
  const prototype: unknown = Object.getPrototypeOf(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    !Object.hasOwn(value, 'version') ||
    !Object.hasOwn(value, 'state')
  )
    return invalidEnvelope()
  /** Input validation does not start migration or take ownership of the state. */
  const candidate = value as { readonly version: unknown; readonly state: unknown }
  if (
    !Number.isSafeInteger(candidate.version) ||
    (candidate.version as number) < 0 ||
    candidate.state === null ||
    candidate.state === undefined
  )
    return invalidEnvelope()
  return value as IVersionedEnvelope
}

/** Malformed real envelope fields retain the registered code and native cause category. */
function invalidEnvelope(): never {
  throw new StorageContractError(
    StorageContractErrorCode.envelopeInvalid,
    { cause: new TypeError(StorageContractErrorText.envelopeInvalid) },
    StorageContractErrorText.envelopeInvalid
  )
}
