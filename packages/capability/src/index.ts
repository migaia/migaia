/**
 * `@migaia/capability` —— 能力的运行时闸门。
 *
 * 「关闭一个能力」此前只有一个定义：**不 import 它**。于是能力粒度等于打包粒度， 同构建 A/B、按租户开关、线上不重新部署就回退，全都做不到。
 *
 * 需要先说清事实，否则会修错东西：本库每个增强都是**调用才启用** （`persist(store,
 * …)`、`bindStoreMiddleware(…)`、`workerComputed(…)`）， 所以「行为」层面的开关本来就在调用点上。真正缺的是三件：
 *
 * 1. **懒加载**——开关关着时代码不该被下载。这要 `await import()`，而动态 import 的时机、失败、重试、以及「加载完发现开关又关了」的竞态，不该让每个调用方 各写一遍。
 * 2. **启停生命周期**——启用给出 handle，关闭必须真释放（persist 有 I/O 连接、 worker 有端口）；激活失败必须留在关闭态而不是半开。
 * 3. **按租户隔离**——同一进程里两个租户的开关不同，两份闸门不能互相看见。
 *
 * 这一层**不能**给的东西也要写明：它不会让一个静态 import 进来的能力变免费。 体积只在 `activate` 用动态 import 时才真的省下来——闸门把那个写法变成一等公民，
 * 但省下体积的是打包器，不是闸门。
 */

import { CapabilityHost } from './host-runtime.js'
import { snapshotHostOptions } from './host-admission.js'
import { CapabilityEnableStatus, CapabilityState } from './state-constants.js'
export * from './state-constants.js'
export {
  GraphReadinessState,
  snapshotGraphReadiness,
  type ICapabilityReadinessSource,
  type IGraphReadinessSnapshot
} from './graph-readiness.js'

// Error codes are public API.
// Export constants and types from the main entry so callers can branch on `(source, code)`.
export { CapabilityErrorCode, type ICapabilityErrorCode } from './error-code.js'
export { CAPABILITY_SOURCE } from './errors.js'

/**
 * Activated resource whose release is owned by the host, including results that arrive after
 * cancellation.
 */
export type ICapabilityHandle = {
  /** Releases this activation; the host captures this method once and waits for returned cleanup. */
  dispose(): void | PromiseLike<void>
}

/**
 * The capability's current lifecycle state.
 *
 * `off` means the gate allows activation but the capability is not enabled. `gated` means a flag
 * denies activation, distinct from an activation that has not been attempted. This differs from
 * tray graph availability `blocked`, which has different recovery semantics.
 */
export type ICapabilityState = (typeof CapabilityState)[keyof typeof CapabilityState]

/** Settled activation outcome; ordinary activation failure is data rather than a rejected operation. */
export type ICapabilityEnableResult =
  /** A current handle is available through the host. */
  | { readonly status: typeof CapabilityEnableStatus.enabled }
  /** The flag denies activation, including a pending activation revoked by that flag. */
  | { readonly status: typeof CapabilityEnableStatus.gated }
  /** Disable, disposal, or a newer generation superseded this activation. */
  | { readonly status: typeof CapabilityEnableStatus.cancelled }
  /** Activation or handle admission failed; error retains the original failure. */
  | { readonly status: typeof CapabilityEnableStatus.failed; readonly error: unknown }

/**
 * Named activation recipe captured at registration without starting or importing its
 * implementation.
 */
export type ICapabilityDefinition<Context, Handle extends ICapabilityHandle = ICapabilityHandle> = {
  /** Unique, nonblank registration name; spelling is retained rather than trimmed. */
  readonly name: string
  /**
   * Activates this capability.
   *
   * Async activation supports loading enhancements such as persistence on demand. Dynamic imports
   * keep the disabled capability's chunk out of the initial bundle. Receives the host's original
   * context reference and must return a handle with a callable dispose method. A rejected start or
   * invalid handle becomes a failed enable result; a late valid handle is released, not adopted.
   */
  activate(context: Context): Handle | Promise<Handle>
}

/** Initial allowlist and optional diagnostic sink, read once when the host is created. */
export type ICapabilityHostOptions = {
  /**
   * Initial flag snapshot. The gate denies activation by default. Only own data properties whose
   * value is exactly `true` permit activation.
   *
   * The host copies this snapshot. Use `setFlag()` or `setFlags()` for later changes. Mutating the
   * input object cannot bypass the state machine. `setFlag(name, false)` atomically invalidates
   * pending activation and releases the current handle. A separate `disable()` call is
   * unnecessary.
   */
  readonly flags?: Readonly<Record<string, boolean>>
  /**
   * Reports activation or release failures; omitted by default. Reporter failures preserve gate
   * state and error(name) diagnostics and reach the shared terminal reporting channel.
   */
  readonly onError?: (name: string, error: unknown) => void
}

/** Independent flag and resource owner; read-only diagnostics remain available after disposal. */
export type ICapabilityHost<Context> = {
  /**
   * Captures a name and activation function without activating. Duplicate names, malformed recipes,
   * disposed hosts, and synchronous lifecycle reentry fail with the corresponding host code.
   */
  register<Handle extends ICapabilityHandle>(
    definition: ICapabilityDefinition<Context, Handle>
  ): void
  /** Fresh registration-order name array; it is a snapshot, not the mutable registry. */
  readonly names: readonly string[]
  /** Reads current lifecycle state; an unknown name throws NOT_REGISTERED, even after disposal. */
  state(name: string): ICapabilityState
  /** Returns the enabled handle or undefined; unknown names throw NOT_REGISTERED. */
  handle<Handle extends ICapabilityHandle>(name: string): Handle | undefined
  /**
   * Returns the retained activation or release failure, or undefined. Starting a new attempt or
   * deactivating clears the prior diagnostic; unknown names throw NOT_REGISTERED.
   */
  error(name: string): unknown
  /**
   * Updates one flag. Disabling synchronously invalidates pending activation and releases the
   * handle. Enabling does not activate. A name may be configured before it is registered; the
   * setter does not wait for asynchronous cleanup.
   */
  setFlag(name: string, enabled: boolean): void
  /**
   * Atomically replaces all flags. Missing capabilities are denied, so removed keys cannot retain
   * an earlier true value. An unreadable snapshot gates every entry before INVALID_OPTION is
   * thrown. Accessor flags are not evaluated, and this setter does not await cleanup.
   */
  setFlags(flags: Readonly<Record<string, boolean>>): void
  /**
   * Activates the capability and returns its structured activation outcome.
   *
   * Concurrent in-flight calls share the exact Promise and one activation. A denied flag resolves
   * gated without activation; an already enabled entry resolves enabled. Activation failures
   * resolve failed, while unknown names, disposed hosts, and transition reentry reject.
   */
  enable(name: string): Promise<ICapabilityEnableResult>
  /**
   * Synchronously invalidates activation and releases the current handle, then waits for this
   * entry's in-flight activation and cleanup, including late results. Resolves true only if the
   * entry was on; pending activation cancellation returns false. Cleanup failures are reported.
   */
  disable(name: string): Promise<boolean>
  /**
   * Makes the host terminal and releases handles in reverse activation-completion order, then waits
   * for every in-flight activation and release. Cleanup failures are reported without stopping
   * other releases. Later calls fail with HOST_TRANSITIONING until the first completion Promise
   * settles; after completion they return that original Promise by identity.
   */
  dispose(): Promise<void>
  /** Becomes true synchronously when final disposal begins, before pending cleanup settles. */
  readonly disposed: boolean
}

/**
 * Creates an isolated, runtime-neutral capability gate for the supplied context reference. Options
 * default to an empty record, with every capability denied until explicitly allowed. Registration
 * does not activate; use enable, disable, and final dispose to own resources. Invalid options or
 * failed option reads throw INVALID_OPTION before a host is returned.
 */
export function createCapabilityHost<Context>(
  context: Context,
  options: ICapabilityHostOptions = {}
): ICapabilityHost<Context> {
  return new CapabilityHost(context, snapshotHostOptions(options))
}
