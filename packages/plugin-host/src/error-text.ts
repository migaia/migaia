import type { IPluginHostErrorCode, IPluginHostErrorDetail } from './typing.js'
import { PLUGIN_HOST_SOURCE, PluginHostErrorCode } from './error-code.js'
import { readHostIdentity } from './host-identity.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export type ILocaleKey = 'en' | 'zh'

export class PluginHostError<TDetail = IPluginHostErrorDetail> extends Error {
  /**
   * The `source` component of `(source, code)`, always `'@migaia/plugin-host'`
   * (`docs/contracts/error-codes.md` §2).
   */
  readonly source: string
  readonly code: IPluginHostErrorCode
  /**
   * Structured diagnostics, such as queue timeout `owner` and `waitedMs`, kept separate from
   * `cause`.
   */
  readonly detail?: TDetail
  constructor(
    code: IPluginHostErrorCode,
    message: string,
    options?: ErrorOptions & { readonly detail?: TDetail }
  ) {
    super(message, options)
    this.name = 'PluginHostError'
    this.source = PLUGIN_HOST_SOURCE
    this.code = code
    if (options?.detail !== undefined) this.detail = options.detail
  }
}

/** Adds the issuing Host identity to a package error without replacing its detail object. */
export function attachPluginHostIdentity<TError extends PluginHostError>(
  error: TError,
  target: object
): TError {
  const identity = readHostIdentity(target)
  if (!identity) return error
  if (error.detail === undefined) {
    Object.defineProperty(error, 'detail', {
      value: { host: identity },
      enumerable: true,
      configurable: true
    })
    return error
  }
  if (
    error.detail !== null &&
    (typeof error.detail === 'object' || typeof error.detail === 'function') &&
    Object.isExtensible(error.detail) &&
    !Object.hasOwn(error.detail, 'host')
  )
    Object.defineProperty(error.detail, 'host', { value: identity, enumerable: true })
  return error
}

/** Prefixes one diagnostic with the identity issued for its exact Host target. */
export function formatPluginHostDiagnostic(target: object, message: string): string {
  const identity = readHostIdentity(target)
  if (!identity) return message
  const body = message.startsWith(PREFIX) ? message.slice(PREFIX.length) : message
  return `[plugin-host:${identity.id}] ${body}`
}

/**
 * Attaches `(source, code)` to an existing error without changing `message`, `name`, `stack`, or
 * other fields. Use this for input validation that retains a native type for checks such as
 * `instanceof TypeError`. The return type exposes `source` and `code` while preserving the original
 * error type. See `docs/contracts/error-codes.md` §2.
 */
export function tagPluginHostError<E extends Error>(
  error: E,
  code: IPluginHostErrorCode
): E & { readonly source: string; readonly code: IPluginHostErrorCode } {
  return attachErrorIdentity(error, { source: PLUGIN_HOST_SOURCE, code }) as E & {
    readonly source: string
    readonly code: IPluginHostErrorCode
  }
}

/**
 * Creates a native input-validation `TypeError` tagged with `INVALID_OPTION`
 * (`docs/contracts/error-codes.md` §7).
 */
export function createPluginHostTypeError(
  message: string,
  options?: { readonly cause?: unknown }
): TypeError & { readonly source: string; readonly code: IPluginHostErrorCode } {
  return tagPluginHostError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    PluginHostErrorCode.invalidOption
  )
}

/** Removed definition fields fail with their dedicated public admission code. */
export function createPluginDefinitionTypeError(): TypeError & {
  readonly source: string
  readonly code: IPluginHostErrorCode
} {
  return tagPluginHostError(
    new TypeError(ERROR_TEXT.PLUGIN_DEFINITION_INVALID),
    PluginHostErrorCode.pluginDefinitionInvalid
  )
}

const PREFIX = '[plugin-host] '

/** Uses stable English package text; consumers localize by `(source, code)` at their boundary. */
const prefixed = (en: string): string => `${PREFIX}${en}`

/** PluginHost 错误与诊断文本集中维护处，便于调用方和维护者查找。 */
const ERROR_TEXT = {
  /** Host node identity requires cryptographic entropy; no process id or weak fallback is admitted. */
  HOST_IDENTITY_ENTROPY: prefixed('host node identity requires secure randomness'),
  /** Stable validation text for the optional human-readable Host identity name. */
  HOST_IDENTITY_NAME: prefixed('host identity name must be a non-empty string'),
  HOST_DISPOSED: prefixed('host is disposed'),
  HOST_DISPOSING: prefixed('host is disposing'),
  /** Stable text for a composition target this package never registered as a managed host. */
  COMPOSITION_TARGET_UNMANAGED: prefixed('target is not a managed host of this package'),
  INVALID_PIPELINE_MODE: prefixed('invalid pipeline mode'),
  /** Stable text distinguishing a temporarily disabled Feature prerequisite owner. */
  PREREQUISITE_DISABLED: (key: PropertyKey, owner: string) =>
    prefixed(`feature prerequisite ${String(key)} is disabled with owner ${owner}`),
  /** Stable text distinguishing a permanently removed Feature prerequisite owner. */
  PREREQUISITE_REMOVED: (key: PropertyKey, owner: string) =>
    prefixed(`feature prerequisite ${String(key)} was removed with owner ${owner}`),
  /** Stable diagnostic for an enablement notification failure that never rolls state back. */
  ENABLEMENT_HOOK_FAILED: (name: string, hook: string, error: unknown) =>
    prefixed(`plugin ${name} ${hook} notification failed: ${String(error)}`),
  /** Admission 读取 plugin/resource getter 失败时使用，原始异常挂在 cause。 */
  INVALID_OPTION: prefixed('plugin-host option read failed'),
  /** Rejects an invalid release hook during definition or admission, before Host mutation. */
  PLUGIN_BEFORE_RELEASE_FUNCTION: prefixed('plugin beforeRelease must be a function'),
  /** Names the bounded pre-release cleanup step in errors and diagnostics. */
  BEFORE_RELEASE_PHASE: prefixed('plugin beforeRelease hook'),
  /** Stable config-domain failure text; config.ts appends the rejected path and grammar reason. */
  INVALID_CONFIG_VALUE: (path: string, reason: string) =>
    prefixed(`invalid config value: ${path} (${reason})`),
  /** Stable cycle diagnostic for config graphs that cannot be owned safely. */
  CONFIG_CYCLE_REJECTED: (path: string) => prefixed(`config contains a cycle: ${path}`),
  /** Feature definition validation uses these stable boundary messages under `INVALID_OPTION`. */
  FEATURE_FACTORY_REQUIRED: prefixed('feature factory must be a function'),
  FEATURE_DEPENDENCIES_RECORD: prefixed('feature dependencies must be a plain record'),
  FEATURE_DEPENDENCIES_DATA: prefixed(
    'feature dependencies must contain enumerable string data properties'
  ),
  FEATURE_DEPENDENCIES_DEFINED: prefixed('feature dependencies must contain defined features'),
  FEATURE_DEPENDENCIES_CYCLE: prefixed('feature dependencies must not cycle'),
  FEATURE_FACTORY_OUTPUT: prefixed('feature factory must return a synchronous object'),
  PLUGIN_FEATURE_EXPOSE: prefixed('plugin featureExpose must be an object or function'),
  PLUGIN_FEATURE_EXPOSE_OUTPUT: prefixed('plugin featureExpose must return an object'),
  PLUGIN_FEATURE_EXPOSE_DATA: prefixed(
    'plugin featureExpose must contain enumerable method data properties'
  ),
  /**
   * Descriptor factories are a synchronous registration contract and cannot publish values
   * directly.
   */
  PLUGIN_DESCRIPTOR_OUTPUT: prefixed('plugin descriptor factory must return an object'),
  /** Only descriptor lifecycle hooks are admitted so callbacks cannot smuggle arbitrary state. */
  PLUGIN_DESCRIPTOR_HOOK: prefixed('plugin descriptor contains an unknown hook'),
  /** Descriptor hooks are captured as data properties to prevent delayed getter side effects. */
  PLUGIN_DESCRIPTOR_HOOK_DATA: prefixed('plugin descriptor hooks must be data-property functions'),
  /** Factories cannot observe Feature values until the Host finishes the registration-local plan. */
  PLUGIN_FEATURE_CORE_PENDING: prefixed('Feature core is not ready'),
  /** Public definition dispatch accepts only the canonical string or object forms. */
  PLUGIN_DEFINITION: prefixed('plugin definition must be an object'),
  /** Identifies a lifecycle scheduler whose getters cannot be read during Host construction. */
  SCHEDULER_GETTER_FAILED: prefixed('scheduler getter failed'),
  /** Adds disposal-phase context while retaining the original failure through `cause`. */
  DISPOSER_FAILED: (phase: string, detail: string) => prefixed(`${phase}: ${detail}`),
  /** Composition admission batches must be concrete arrays before Host preparation starts. */
  ADMISSION_REQUESTS_ARRAY: prefixed('admission requests must be an array'),
  /** Composition admissions must carry an opaque snapshot produced by this Host. */
  ADMISSION_REQUIRED: prefixed('admission request must provide an admission'),
  /** Rejects admission objects that were not created by the receiving Host. */
  ADMISSION_FOREIGN: prefixed('admission must be created by this Host'),
  /** Rejects ordering lanes that do not own the exact Host definition being prepared. */
  ADMISSION_SLOT_FOREIGN: prefixed('admission slot does not belong to this Host definition'),
  /** Retired ordering lanes cannot be revived by a later definition generation. */
  ADMISSION_SLOT_RETIRED: prefixed('admission slot is retired'),
  /** A publication batch may bind an opaque definition lane only once. */
  ADMISSION_SLOT_DUPLICATE: prefixed('admission slot is already bound in this batch'),
  /** A live same-name definition lane must be reused instead of allocating a parallel lane. */
  DATA_ORDER_SLOT_LIVE: (name: string) =>
    prefixed(`definition "${name}" already has a live data-order slot`),
  /** Ordering lanes require the same canonical plugin-name grammar as admissions. */
  DATA_ORDER_SLOT_NAME_INVALID: prefixed('plugin name must be a non-empty string without "."'),
  /** Prepared publication lost authority because another Host mutation committed first. */
  PREPARED_ADMISSION_DRIFT: prefixed(
    'prepared admission lost authority after the Host revision changed'
  ),
  /** Config callable admission rejects shapes whose function/proxy invariants cannot be preserved. */
  CONFIG_CALLABLE_UNSUPPORTED: (reason: string) =>
    prefixed(`config callable is unsupported: ${reason}`),
  /** Public readonly facades use this stable text for every attempted object mutation. */
  CONFIG_READONLY: prefixed('config is readonly'),
  PIPELINE_MODE_MISMATCH: (hostMode: string, stageMode: string) =>
    prefixed(`host is in ${hostMode} mode and cannot register a ${stageMode} stage`),
  /** Pipeline stage 对同一次 step 重复调用了 next()。 */
  PIPELINE_NEXT_ALREADY_CALLED: prefixed(
    'pipeline stage called next() more than once for the same invocation'
  ),
  /** Stage 返回或调用完成后才调用 next()，该值已无法安全进入 pipeline。 */
  PIPELINE_NEXT_CALLED_LATE: prefixed(
    'pipeline stage called next() after returning or completing; the call was ignored'
  ),
  PIPELINE_EXECUTING: prefixed('pipeline stages cannot be registered during pipeline execution'),
  /** `pipeline.ts#runAsyncPipeline` 同时观测到 stage 与 downstream 失败时使用。 */
  PIPELINE_STAGE_AND_DOWNSTREAM_FAILED: 'pipeline stage and downstream failed',
  /** 插件不存在。 */
  PLUGIN_NOT_INSTALLED: (name: string) => prefixed(`plugin "${name}" is not installed`),
  /** Handle access is rejected while the named registration is disabled. */
  PLUGIN_DISABLED: (name: string) => prefixed(`plugin "${name}" is disabled`),
  /** Handle access uses this stable text while dependency policy has suspended a registration. */
  PLUGIN_SUSPENDED: (name: string) => prefixed(`plugin "${name}" is suspended`),
  /** Lazy registration requires explicit activation before synchronous access. */
  PLUGIN_NOT_ACTIVATED: (name: string) => prefixed(`plugin "${name}" is not activated`),
  /** Plugin definition requested a feature outside its declared feature record. */
  FEATURE_NOT_DECLARED: (plugin: string, feature: string) =>
    prefixed(`plugin "${plugin}" does not declare feature "${feature}"`),
  /** Required cross-plugin feature provider is absent. */
  PREREQUISITE_MISSING: (plugin: string, feature: string) =>
    prefixed(`required feature provider ${plugin}.${feature} is not installed`),
  /** Cross-plugin feature dependency graph is cyclic. */
  DEPENDENCY_CYCLE: prefixed('plugin feature dependency cycle detected'),
  /** Required dependents prevent a non-cascading mutation. */
  DEPENDENCY_BLOCKED: (name: string) => prefixed(`plugin "${name}" still has required dependents`),
  /** Replacement target and candidate names must remain identical. */
  REPLACE_NAME_MISMATCH: (name: string, next: string) =>
    prefixed(`replacement plugin name mismatch: ${name} / ${next}`),
  /** Constructor option validation for the diagnostic outlet. */
  DIAGNOSTIC_OPTION: prefixed('diagnostic must be a function'),
  /** Constructor option validation for the diagnostic failure sink. */
  DIAGNOSTIC_FAILURE_OPTION: prefixed('onDiagnosticFailure must be a function'),
  /** A Feature rejection could not be delivered because the diagnostic reporter itself failed. */
  FEATURE_REJECTION_REPORT_FAILED: prefixed(
    'feature rejection diagnostic failed; the rejection and reporter failure are attached'
  ),
  /** Replacement committed but some dependents could not be restarted against it. */
  DEPENDENT_RESTART_FAILED: (name: string, dependents: readonly string[]) =>
    prefixed(
      `dependents failed to restart after replacing plugin "${name}": ${dependents.join(', ')}`
    ),
  /** Cleanup of a registration left by replacement failed; reported, never thrown. */
  REPLACE_CLEANUP_FAILED: (name: string) =>
    prefixed(`cleanup failed while replacing plugin "${name}"`),
  /** Dependent rebind hook failed; the dependent restarts instead. */
  DEPENDENCY_REBIND_FAILED: (dependent: string, provider: string) =>
    prefixed(`plugin "${dependent}" failed to rebind "${provider}" and will restart`),
  /** Removed plugin definition fields fail at definition admission. */
  PLUGIN_DEFINITION_INVALID: prefixed('plugin definition contains unsupported fields'),
  /** 插件卸载存在清理失败。 */
  PLUGIN_DISPOSE_FAILED: (name: string) => prefixed(`plugin "${name}" failed to dispose`),
  PLUGIN_INSTALL_FAILED: (name: string) => prefixed(`plugin "${name}" failed to install`),
  /** `useSync` rejects a setup plugin before any hook runs; callers use the async path. */
  SETUP_REQUIRES_ASYNC_INSTALL: (name: string) =>
    prefixed(`plugin "${name}" setup requires async installation`),
  /** Definition admission requires the known setup key to contain a function. */
  PLUGIN_SETUP_FUNCTION: prefixed('plugin setup must be a function'),
  /** Reports a setup rejection that arrived after its installation attempt closed. */
  SETUP_LATE_REJECTION: (name: string) => prefixed(`plugin "${name}" setup rejected late`),
  /** Reports failure to release a resource registered after setup closed. */
  SETUP_LATE_RELEASE_FAILED: (name: string) =>
    prefixed(`plugin "${name}" late setup resource release failed`),
  PLUGIN_ROLLBACK_FAILED: (name: string) => prefixed(`plugin "${name}" install rollback failed`),
  /** 资源注册不在 install 生命周期内。 */
  RESOURCE_OUTSIDE_INSTALL: prefixed('resources can only be registered during plugin install()'),
  /** A plugin resource must expose a disposer for install and late setup cleanup. */
  PLUGIN_RESOURCE_DISPOSER: 'plugin resource must provide a disposer',
  LIFECYCLE_MUTATION: prefixed('Host mutations are forbidden during plugin lifecycle callbacks'),
  /** 插件名称重复。 */
  PLUGIN_DUPLICATE: (name: string) => prefixed(`plugin "${name}" is already installed`),
  /** 插件扩展属性冲突。 */
  EXTENSION_DUPLICATE: (name: string, key: PropertyKey) =>
    prefixed(`plugin "${name}" extension "${String(key)}" is already occupied`),
  EXTENSION_OBJECT_PROTOTYPE: (name: string, key: PropertyKey) =>
    prefixed(`plugin "${name}" extension "${String(key)}" conflicts with the Object prototype`),
  EXTENSION_RESERVED: (name: string, key: PropertyKey) =>
    prefixed(`plugin "${name}" extension "${String(key)}" is reserved`),
  /** 正式 SLA：mutation 在 FIFO 队列中等待超过阈值。 */
  MUTATION_QUEUE_TIMEOUT: (waitedMs: number) =>
    prefixed(`mutation waited in the queue for more than ${waitedMs}ms and was rejected`),
  /** 诊断：install() 返回值上一个非枚举键被跳过挂载（不是错误，是有意的行为，但必须可观测）。 */
  EXTENSION_NON_ENUMERABLE_IGNORED: (name: string, key: PropertyKey) =>
    prefixed(
      `plugin "${name}"'s non-enumerable extension property "${String(key)}" was not mounted ` +
        `on the host — non-enumerable keys are intentionally ignored; make it enumerable to ` +
        `expose it`
    ),
  /**
   * 正式 SLA：单个 disposer（pipeline disposer / 插件 dispose 钩子 / resource disposer） 等待超过阈值仍未 settle，包括该
   * disposer 反过来 await 了同一次 dispose() 调用自身这种 循环等待。不会中断 disposer 的执行（JS 无法安全撤销已经在跑的 Promise 链），只是停止
   * 等待并把这一步计为失败，让整个 dispose 事务仍能收敛到 disposed。
   */
  DISPOSE_STEP_TIMEOUT: (phase: string, waitedMs: number) =>
    prefixed(
      `${phase} did not settle within ${waitedMs}ms and was abandoned as a failure — if that ` +
        `disposer awaits the very host.dispose() call that triggered it, this wait can never ` +
        `complete on its own`
    ),
  /** Stable text for an admitted hook that exceeded its operation deadline. */
  MUTATION_EXECUTION_TIMEOUT: (waitedMs: number) =>
    prefixed(`mutation exceeded its ${waitedMs}ms execution budget and lost commit authority`),
  /** Stable text for a callable captured from a logically revoked registration. */
  REGISTRATION_REVOKED: prefixed('plugin registration has been revoked'),
  /** Stable install-result contract text shared by synchronous and asynchronous rejection paths. */
  INSTALL_RESULT_THENABLE: (name: string) =>
    prefixed(`plugin ${name} install() result must not contain then`),
  /** Diagnostic text preserves failed secondary attachment without replacing the primary error. */
  CAUSE_ATTACH_FAILED: (failure: string) => prefixed(`failed to attach error cause: ${failure}`),
  /** Stable diagnostic text for an active pipeline that missed the disposal drain budget. */
  PIPELINE_DRAIN_TIMEOUT: (waitedMs: number) =>
    prefixed(`pipeline drain exceeded its ${waitedMs}ms budget and entered logical terminal`),
  /** A composition fence rejection is reported while cleanup still proceeds after settlement. */
  CLEANUP_FENCE_REJECTED: prefixed('prepared cleanup fence rejected'),
  /** Composition cleanup fences accept PromiseLike values from any JavaScript realm. */
  BEFORE_CLEANUP_THENABLE: prefixed(
    'beforeCleanup must be a PromiseLike with a readable then method'
  )
} as const

export default ERROR_TEXT
