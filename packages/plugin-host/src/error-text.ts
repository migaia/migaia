import type { IPluginHostErrorCode, IPluginHostErrorDetail } from './typing.js'
import { PLUGIN_HOST_SOURCE, PluginHostErrorCode } from './error-code.js'

export type ILocaleKey = 'en' | 'zh'

export class PluginHostError<TDetail = IPluginHostErrorDetail> extends Error {
  /** `(source, code)` 二元组的 source 部分，恒为 `'@migaia/plugin-host'`（`docs/contracts/error-codes.md` §2）。 */
  readonly source: string
  readonly code: IPluginHostErrorCode
  /** 结构化诊断（如 queue timeout 的 `owner`/`waitedMs`）；不与 `cause` 混用。 */
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

/**
 * 给已经构造好的错误对象（`TypeError` 等）补上 `(source, code)`，不触碰 `message`/`name`/`stack`/构造函数带来的其它字段——
 * 用于入参校验这类必须保持原生类型（调用方按 `instanceof TypeError` 分支）的场景。返回类型把 `source`/`code` 交叉进原类型，
 * 使类型层面可访问（`docs/contracts/error-codes.md` §2）。
 */
export function tagPluginHostError<E extends Error>(
  error: E,
  code: IPluginHostErrorCode
): E & { readonly source: string; readonly code: IPluginHostErrorCode } {
  Object.defineProperty(error, 'source', { value: PLUGIN_HOST_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error as E & { readonly source: string; readonly code: IPluginHostErrorCode }
}

/** 入参校验错误：原生 `TypeError` + `INVALID_OPTION`（`docs/contracts/error-codes.md` §7 裸抛扫描门禁）。 */
export function createPluginHostTypeError(
  message: string,
  options?: { readonly cause?: unknown }
): TypeError & { readonly source: string; readonly code: IPluginHostErrorCode } {
  return tagPluginHostError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    PluginHostErrorCode.invalidOption
  )
}

const PREFIX = '[plugin-host] '

/** Uses stable English package text; consumers localize by `(source, code)` at their boundary. */
const localize = (_zh: string, en: string): string => `${PREFIX}${en}`

/** PluginHost 错误与诊断文本集中维护处，便于调用方和维护者查找。 */
const ERROR_TEXT = {
  get HOST_DISPOSED() {
    return localize('宿主已关闭', 'host is disposed')
  },
  get HOST_DISPOSING() {
    return localize('宿主正在关闭', 'host is disposing')
  },
  get INVALID_PIPELINE_MODE() {
    return localize('无效的 pipeline mode', 'invalid pipeline mode')
  },
  /** Admission 读取 plugin/resource getter 失败时使用，原始异常挂在 cause。 */
  get INVALID_OPTION() {
    return localize('plugin-host 选项读取失败', 'plugin-host option read failed')
  },
  /** Feature definition validation uses these stable boundary messages under `INVALID_OPTION`. */
  get FEATURE_FACTORY_REQUIRED() {
    return localize('Feature factory 必须是函数', 'feature factory must be a function')
  },
  get FEATURE_DEPENDENCIES_RECORD() {
    return localize(
      'Feature dependencies 必须是 plain record',
      'feature dependencies must be a plain record'
    )
  },
  get FEATURE_DEPENDENCIES_DATA() {
    return localize(
      'Feature dependencies 必须包含 enumerable string data properties',
      'feature dependencies must contain enumerable string data properties'
    )
  },
  get FEATURE_DEPENDENCIES_DEFINED() {
    return localize(
      'Feature dependencies 必须包含已定义 Feature',
      'feature dependencies must contain defined features'
    )
  },
  get FEATURE_DEPENDENCIES_CYCLE() {
    return localize('Feature dependencies 不得成环', 'feature dependencies must not cycle')
  },
  get FEATURE_FACTORY_OUTPUT() {
    return localize(
      'Feature factory 必须同步返回对象',
      'feature factory must return a synchronous object'
    )
  },
  get PLUGIN_FEATURES_RECORD() {
    return localize('plugin features 必须是 record', 'plugin features must be a record')
  },
  get PLUGIN_FEATURES_DEFINED() {
    return localize(
      'plugin features 必须包含已定义 Feature',
      'plugin features must contain defined features'
    )
  },
  get PLUGIN_FEATURE_EXPOSE() {
    return localize(
      'plugin featureExpose 必须是对象或函数',
      'plugin featureExpose must be an object or function'
    )
  },
  get PLUGIN_FEATURE_EXPOSE_OUTPUT() {
    return localize(
      'plugin featureExpose 必须返回对象',
      'plugin featureExpose must return an object'
    )
  },
  get PLUGIN_FEATURE_EXPOSE_DATA() {
    return localize(
      'plugin featureExpose 必须包含 enumerable method data properties',
      'plugin featureExpose must contain enumerable method data properties'
    )
  },
  /**
   * Descriptor factories are a synchronous registration contract and cannot publish values
   * directly.
   */
  get PLUGIN_DESCRIPTOR_OUTPUT() {
    return localize(
      'plugin descriptor factory 必须返回对象',
      'plugin descriptor factory must return an object'
    )
  },
  /** Only descriptor lifecycle hooks are admitted so callbacks cannot smuggle arbitrary state. */
  get PLUGIN_DESCRIPTOR_HOOK() {
    return localize('plugin descriptor 包含未知 hook', 'plugin descriptor contains an unknown hook')
  },
  /** Descriptor hooks are captured as data properties to prevent delayed getter side effects. */
  get PLUGIN_DESCRIPTOR_HOOK_DATA() {
    return localize(
      'plugin descriptor hook 必须是数据属性函数',
      'plugin descriptor hooks must be data-property functions'
    )
  },
  /** Factories cannot observe Feature values until the Host finishes the registration-local plan. */
  get PLUGIN_FEATURE_CORE_PENDING() {
    return localize('Feature core 尚未就绪', 'Feature core is not ready')
  },
  /** Public definition dispatch accepts only the canonical string or object forms. */
  get PLUGIN_DEFINITION() {
    return localize('plugin definition 必须是对象', 'plugin definition must be an object')
  },
  /** Identifies a lifecycle scheduler whose getters cannot be read during Host construction. */
  get SCHEDULER_GETTER_FAILED() {
    return localize('scheduler getter 读取失败', 'scheduler getter failed')
  },
  /** Adds disposal-phase context while retaining the original failure through `cause`. */
  DISPOSER_FAILED: (phase: string, detail: string) =>
    localize(`${phase}: ${detail}`, `${phase}: ${detail}`),
  /** Composition admission batches must be concrete arrays before Host preparation starts. */
  get ADMISSION_REQUESTS_ARRAY() {
    return localize('admission requests 必须是数组', 'admission requests must be an array')
  },
  /** Composition admissions must carry an opaque snapshot produced by this Host. */
  get ADMISSION_REQUIRED() {
    return localize(
      'admission request 缺少 admission',
      'admission request must provide an admission'
    )
  },
  /** Rejects admission objects that were not created by the receiving Host. */
  get ADMISSION_FOREIGN() {
    return localize('admission 不是由当前 Host 创建', 'admission must be created by this Host')
  },
  /** Rejects ordering lanes that do not own the exact Host definition being prepared. */
  get ADMISSION_SLOT_FOREIGN() {
    return localize(
      'admission slot 不属于当前 Host definition',
      'admission slot does not belong to this Host definition'
    )
  },
  /** Retired ordering lanes cannot be revived by a later definition generation. */
  get ADMISSION_SLOT_RETIRED() {
    return localize('admission slot 已退休', 'admission slot is retired')
  },
  /** A publication batch may bind an opaque definition lane only once. */
  get ADMISSION_SLOT_DUPLICATE() {
    return localize(
      'admission slot 已在当前 batch 中绑定',
      'admission slot is already bound in this batch'
    )
  },
  /** A live same-name definition lane must be reused instead of allocating a parallel lane. */
  DATA_ORDER_SLOT_LIVE: (name: string) =>
    localize(
      `definition "${name}" 已有 live data-order slot`,
      `definition "${name}" already has a live data-order slot`
    ),
  /** Ordering lanes require the same canonical plugin-name grammar as admissions. */
  get DATA_ORDER_SLOT_NAME_INVALID() {
    return localize(
      'plugin name 必须是非空且不含 "." 的字符串',
      'plugin name must be a non-empty string without "."'
    )
  },
  /** Prepared publication lost authority because another Host mutation committed first. */
  get PREPARED_ADMISSION_DRIFT() {
    return localize(
      'prepared admission 因 Host revision 变化而失效',
      'prepared admission lost authority after the Host revision changed'
    )
  },
  /** Config callable admission rejects shapes whose function/proxy invariants cannot be preserved. */
  CONFIG_CALLABLE_UNSUPPORTED: (reason: string) =>
    localize(`config callable 不支持：${reason}`, `config callable is unsupported: ${reason}`),
  /** Public readonly facades use this stable text for every attempted object mutation. */
  get CONFIG_READONLY() {
    return localize('config is readonly', 'config is readonly')
  },
  PIPELINE_MODE_MISMATCH: (hostMode: string, stageMode: string) =>
    localize(
      `host 处于 ${hostMode} 模式，不能注册 ${stageMode} stage`,
      `host is in ${hostMode} mode and cannot register a ${stageMode} stage`
    ),
  /** Pipeline stage 对同一次 step 重复调用了 next()。 */
  get PIPELINE_NEXT_ALREADY_CALLED() {
    return localize(
      'pipeline stage 对同一次调用重复触发了 next()',
      'pipeline stage called next() more than once for the same invocation'
    )
  },
  /** Stage 返回或调用完成后才调用 next()，该值已无法安全进入 pipeline。 */
  get PIPELINE_NEXT_CALLED_LATE() {
    return localize(
      'pipeline stage 在返回或调用完成后触发了 next()，该次调用已被忽略',
      'pipeline stage called next() after returning or completing; the call was ignored'
    )
  },
  get PIPELINE_EXECUTING() {
    return localize(
      'pipeline 执行期间不能注册 stage',
      'pipeline stages cannot be registered during pipeline execution'
    )
  },
  /** `pipeline.ts#registerStage` 拒绝非函数 stage 时使用，保持公开 INVALID_OPTION 文案集中可追踪。 */
  get PIPELINE_STAGE_MUST_BE_FUNCTION() {
    return 'pipeline stage must be a function'
  },
  /** `pipeline.ts#runAsyncPipeline` 同时观测到 stage 与 downstream 失败时使用。 */
  get PIPELINE_STAGE_AND_DOWNSTREAM_FAILED() {
    return 'pipeline stage and downstream failed'
  },
  /** 插件不存在。 */
  get PLUGIN_NOT_INSTALLED() {
    return (name: string) => localize(`插件 "${name}" 未安装`, `plugin "${name}" is not installed`)
  },
  /** 插件卸载存在清理失败。 */
  get PLUGIN_DISPOSE_FAILED() {
    return (name: string) =>
      localize(`插件 "${name}" 卸载失败`, `plugin "${name}" failed to dispose`)
  },
  get HOST_DISPOSE_FAILED() {
    return localize('宿主卸载失败', 'host failed to dispose')
  },
  get PLUGIN_INSTALL_FAILED() {
    return (name: string) =>
      localize(`插件 "${name}" 安装失败`, `plugin "${name}" failed to install`)
  },
  get PLUGIN_ROLLBACK_FAILED() {
    return (name: string) =>
      localize(`插件 "${name}" 安装失败且回滚失败`, `plugin "${name}" install rollback failed`)
  },
  /** Shared key 重复。 */
  get SHARED_DUPLICATE() {
    return (key: PropertyKey) =>
      localize(
        `shared key "${String(key)}" 已经注册`,
        `shared key "${String(key)}" is already registered`
      )
  },
  /** 资源注册不在 install 生命周期内。 */
  get RESOURCE_OUTSIDE_INSTALL() {
    return localize(
      '资源只能在插件 install() 执行期间注册',
      'resources can only be registered during plugin install()'
    )
  },
  LIFECYCLE_MUTATION: localize(
    '插件生命周期内禁止调用 Host mutation',
    'Host mutations are forbidden during plugin lifecycle callbacks'
  ),
  /** 插件名称重复。 */
  get PLUGIN_DUPLICATE() {
    return (name: string) =>
      localize(`插件 "${name}" 已经安装`, `plugin "${name}" is already installed`)
  },
  /** 插件扩展属性冲突。 */
  get EXTENSION_DUPLICATE() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 扩展属性 "${String(key)}" 已被占用`,
        `plugin "${name}" extension "${String(key)}" is already occupied`
      )
  },
  get EXTENSION_OBJECT_PROTOTYPE() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 扩展属性 "${String(key)}" 与 Object 原型冲突`,
        `plugin "${name}" extension "${String(key)}" conflicts with the Object prototype`
      )
  },
  get EXTENSION_RESERVED() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 扩展属性 "${String(key)}" 是保留键`,
        `plugin "${name}" extension "${String(key)}" is reserved`
      )
  },
  /** 正式 SLA：mutation 在 FIFO 队列中等待超过阈值。 */
  get MUTATION_QUEUE_TIMEOUT() {
    return (waitedMs: number) =>
      localize(
        `mutation 在队列中等待超过 ${waitedMs}ms，已拒绝执行`,
        `mutation waited in the queue for more than ${waitedMs}ms and was rejected`
      )
  },
  /** 诊断：install() 返回值上一个非枚举键被跳过挂载（不是错误，是有意的行为，但必须可观测）。 */
  get EXTENSION_NON_ENUMERABLE_IGNORED() {
    return (name: string, key: PropertyKey) =>
      localize(
        `插件 "${name}" 的非枚举扩展属性 "${String(key)}" 未挂载到 host——` +
          `非枚举键被有意忽略，如需暴露请改成枚举属性`,
        `plugin "${name}"'s non-enumerable extension property "${String(key)}" was not mounted ` +
          `on the host — non-enumerable keys are intentionally ignored; make it enumerable to ` +
          `expose it`
      )
  },
  /**
   * 正式 SLA：单个 disposer（pipeline disposer / 插件 dispose 钩子 / resource disposer） 等待超过阈值仍未 settle，包括该
   * disposer 反过来 await 了同一次 dispose() 调用自身这种 循环等待。不会中断 disposer 的执行（JS 无法安全撤销已经在跑的 Promise 链），只是停止
   * 等待并把这一步计为失败，让整个 dispose 事务仍能收敛到 disposed。
   */
  get DISPOSE_STEP_TIMEOUT() {
    return (phase: string, waitedMs: number) =>
      localize(
        `${phase} 等待超过 ${waitedMs}ms 仍未完成，已放弃等待并计为失败——如果该 disposer ` +
          `反过来 await 了触发它的这次 host.dispose() 调用，这个等待永远无法完成`,
        `${phase} did not settle within ${waitedMs}ms and was abandoned as a failure — if that ` +
          `disposer awaits the very host.dispose() call that triggered it, this wait can never ` +
          `complete on its own`
      )
  },
  /** Stable text for an admitted hook that exceeded its operation deadline. */
  MUTATION_EXECUTION_TIMEOUT: (waitedMs: number) =>
    localize(
      `mutation 执行超过 ${waitedMs}ms，已撤销提交资格`,
      `mutation exceeded its ${waitedMs}ms execution budget and lost commit authority`
    ),
  /** Stable text for access through a logically revoked immutable view. */
  get VIEW_REVOKED() {
    return localize('宿主视图已撤销', 'plugin-host view has been revoked')
  },
  /** Stable diagnostic text for an active pipeline that missed the disposal drain budget. */
  PIPELINE_DRAIN_TIMEOUT: (waitedMs: number) =>
    localize(
      `pipeline drain 超过 ${waitedMs}ms，已进入逻辑终态`,
      `pipeline drain exceeded its ${waitedMs}ms budget and entered logical terminal`
    ),
  /** Stable text for logical cleanup that still has physical work outstanding. */
  get CLEANUP_INCOMPLETE() {
    return localize('清理尚未物理完成', 'physical cleanup is incomplete')
  },
  get HOST_CORE_SETUP_FAILED() {
    return localize('Core 构造失败', 'Core setup failed')
  },
  get HOST_SETUP_TIMEOUT() {
    return localize('setup 超时', 'setup timed out')
  },
  get HOST_SETUP_ABORTED() {
    return localize('setup 已取消', 'setup was aborted')
  },
  get HOST_SETUP_ROLLBACK_FAILED() {
    return localize('setup 回滚失败', 'setup rollback failed')
  },
  /** A composition fence rejection is reported while cleanup still proceeds after settlement. */
  get CLEANUP_FENCE_REJECTED() {
    return localize('prepared cleanup fence rejected', 'prepared cleanup fence rejected')
  },
  /** Composition cleanup fences accept PromiseLike values from any JavaScript realm. */
  get BEFORE_CLEANUP_THENABLE() {
    return localize(
      'beforeCleanup 必须是可安全读取 then 的 PromiseLike',
      'beforeCleanup must be a PromiseLike with a readable then method'
    )
  }
} as const

export default ERROR_TEXT
