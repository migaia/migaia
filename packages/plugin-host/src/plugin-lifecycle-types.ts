/**
 * Defines registration resources, immutable configuration and hook contexts. Runtime lifecycle
 * ownership remains with the existing lifecycle package.
 */
import type { asyncDisposeKey } from './symbols.ts'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { ICleanupResult } from '@migaia/lifecycle'

/** Values accepted at every asynchronous plugin lifecycle boundary. */
export type IPluginAwaitable<T> = T | PromiseLike<T>

/** Plugin resource cleanup callback; a thenable is assimilated by the owning lifecycle scope. */
export type IPluginDisposer = () => IPluginAwaitable<void>

/** One owned release capability; callbacks or supported disposal symbols are captured at admission. */
export type IPluginResource =
  | IPluginDisposer
  | { [asyncDisposeKey](): IPluginAwaitable<void> }
  | { [Symbol.dispose](): void }

/** String-keyed plugin configuration; runtime admission owns and freezes supported data containers. */
export type IPluginConfig = Record<string, unknown>

/** Recursive readonly view exposed by the lazy configuration proxy. */
export type IReadonlyConfig<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: IReadonlyConfig<T[K]> }
    : T

/** Registration-local read capability, without the Host's configuration mutation authority. */
export type IPluginLifecycleConfig<TConfig extends IPluginConfig = IPluginConfig> = {
  /** Reads the current immutable configuration snapshot; retained older snapshots do not change. */
  get(): IReadonlyConfig<TConfig>
}

/** Operation-scoped cancellation and deadline exposed to one plugin hook invocation. */
export type IPluginOperationContext = {
  /** Cooperative cancellation for this hook attempt; expiry also removes commit authority. */
  readonly signal: INativeAbortSignal
  /** Absolute scheduler-clock deadline, or undefined for an explicitly unbounded mutation. */
  readonly deadlineAt: number | undefined
}

/** Registration-scoped lifetime signal that remains valid until logical revocation. */
export type IPluginRegistrationContext = {
  /** Lifetime of the registration rather than one operation; logical revocation aborts it. */
  readonly signal: INativeAbortSignal
}

/** Disposal context passed to a V2 plugin dispose hook. */
export type IPluginDisposalContext = Readonly<{
  /** Registration lifetime signal, which may already be aborted when physical cleanup runs. */
  readonly signal: INativeAbortSignal
  /** Shared cleanup deadline when one was selected, otherwise undefined. */
  readonly deadlineAt: number | undefined
}>

/** Gives a pre-release hook the Host clock's remaining relative cleanup budget. */
export type IPluginBeforeReleaseContext = Readonly<
  IPluginDisposalContext & {
    /** Nonnegative budget remaining on the Host clock, or undefined for unbounded release. */
    remainingMs(): number | undefined
  }
>

/** Plugin-facing config capability; TConfig is fixed by the plugin declaration. */
export type IPluginLifecycleCore<TConfig extends IPluginConfig = IPluginConfig> = {
  /** Reads this registration's immutable configuration, without a mutation method. */
  readonly config: IPluginLifecycleConfig<TConfig>
  /** Current hook attempt's cancellation and deadline; capture it for that invocation only. */
  readonly operation: IPluginOperationContext
  /** Registration lifetime, distinct from an individual timed operation. */
  readonly lifecycle: IPluginRegistrationContext
}

/** Attempt-scoped cancellation and deadline for setup, independent of later Host mutations. */
export type IPluginSetupOperation = Readonly<{
  /** Setup-attempt cancellation; late settlement cannot regain publication authority. */
  readonly signal: INativeAbortSignal
  /** Absolute deadline in the Host scheduler clock, or undefined without a mutation timeout. */
  readonly deadlineAt: number | undefined
  /** Reads the Host scheduler clock used for the deadline. */
  now(): number
}>

/** Setup sees lifecycle capabilities but no Feature or pipeline output. */
export type IPluginSetupContext<TConfig extends IPluginConfig = IPluginConfig> = Readonly<{
  /** Read-only configuration for this registration's setup attempt. */
  readonly config: IPluginLifecycleConfig<TConfig>
  /** Setup-owned signal, deadline and clock, independent of subsequent mutations. */
  readonly operation: IPluginSetupOperation
  /** Registration lifetime signal retained after successful setup. */
  readonly lifecycle: IPluginRegistrationContext
  /** Owns a setup resource; late registration releases it before reporting RESOURCE_OUTSIDE_INSTALL. */
  onDispose(resource: IPluginResource): void
}>

/** Produces one registration's setup output before Feature construction. */
export type IPluginSetup<TConfig extends IPluginConfig, TSetup> = (
  context: IPluginSetupContext<TConfig>
) => TSetup | PromiseLike<TSetup>

/** Physical completion detail for work that outlives bounded logical disposal. */
export type IPluginHostPhysicalCleanupResult = ICleanupResult

/** Default runtime's logical terminal outcome; collected cleanup failures never reopen the Host. */
export type IPluginHostDisposalResult = ICleanupResult &
  Readonly<{
    /** True once the default runtime has closed admission and committed its terminal state. */
    readonly logicalTerminal: true
    /** Whether tracked cleanup/leases physically settled; cleanupErrors may still be nonempty. */
    readonly cleanupComplete: boolean
  }>
