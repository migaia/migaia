import type { IDimFn, ILoggerPluginCore, ILoggerPlugin, IPaintFn } from '../typing.js'
import { defineFeature, type IMiddlewarePipelineMode } from '@migaia/plugin-host'
import { optionalColorFeature, type IColorShared } from './color.js'
import { LoggerReasoningPhase } from '../plugin-constants.js'

export type IReasoningPluginConfig = {
  labels?: { thinking?: string; response?: string }
  /** 是否把该插件发起的流式及完整 entry 输出异步调度；默认 false。 */
  asyncOutput?: boolean
}

export type IReasoningPluginExt = {
  startThinking(label?: string): void
  thinking(delta: string): void
  endThinking(): void
  startResponse(label?: string): void
  response(delta: string): void
  endResponse(): void
}

type IPhase = (typeof LoggerReasoningPhase)[keyof typeof LoggerReasoningPhase]

export const REASONING_PLUGIN_NAME = 'reasoning' as const

/** Resolved optional color capability captured once during reasoning installation. */
type IReasoningFeatureDependencies = Readonly<{ readonly color: IColorShared | undefined }>

/** Bridges the optional cross-plugin reference into this plugin's feature core. */
const reasoningDependenciesFeature = defineFeature<
  Record<never, never>,
  { readonly color: typeof optionalColorFeature },
  IReasoningFeatureDependencies
>((_core, dependencies) => ({ color: dependencies.color }), {
  color: optionalColorFeature
})

/**
 * 设计要点： - 逐 token 的可视化输出完全走 core.raw()，不经过 pipeline/sink；是否异步 由 reasoning 插件自己的 asyncOutput 配置决定，
 * 这样才能实现"没有换行、没有每条都带时间戳前缀"的流式效果。 - 但一整段 thinking/response 结束时，会把累积的完整文本通过 core.dispatchRaw({ ...,
 * data: { silent: true } }) 补发一条正式 entry—— data.silent 是跟 ansis 插件约定好的标记，控制台 sink 看到它会跳过打印
 * （避免和已经流式打印过的内容重复），但 http/batch 这类 sink 完全不关心 这个标记，照样会收到这条 entry，从而让"完整回答内容"依然能被审计/上报。 - 没装 ansis
 * 插件时，可选 color Feature 为 undefined，这里直接输出原始文本，不强依赖 ansis 插件存在。
 */
class ReasoningPlugin implements ILoggerPlugin<
  IReasoningPluginExt,
  IReasoningPluginConfig,
  IMiddlewarePipelineMode,
  { readonly dependencies: typeof reasoningDependenciesFeature }
> {
  readonly name = REASONING_PLUGIN_NAME
  readonly config: IReasoningPluginConfig
  /** Declares the optional color dependency independently of installation order. */
  readonly features = Object.freeze({ dependencies: reasoningDependenciesFeature })

  #phase: IPhase = LoggerReasoningPhase.idle
  #buffer = ''
  #resolvedConfig!: IReasoningPluginConfig

  constructor(config: IReasoningPluginConfig) {
    this.config = config
  }

  install(
    core: ILoggerPluginCore<IMiddlewarePipelineMode> &
      Readonly<{ readonly features: { readonly dependencies: IReasoningFeatureDependencies } }>
  ): IReasoningPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取
    this.#resolvedConfig = core.config.get<IReasoningPluginConfig>() ?? {}

    const paint = core.features.dependencies.color?.paint ?? ((_tag: string, text: string) => text)
    const dim = core.features.dependencies.color?.dim ?? ((text: string) => text)

    return {
      startThinking: (label) => this.#startThinking(core, paint, label),
      thinking: (delta) => this.#appendThinking(core, dim, delta),
      endThinking: () => this.#endThinking(core),
      startResponse: (label) => this.#startResponse(core, paint, label),
      response: (delta) => this.#appendResponse(core, delta),
      endResponse: () => this.#endResponse(core)
    }
  }

  #startThinking(
    core: ILoggerPluginCore<IMiddlewarePipelineMode>,
    paint: IPaintFn,
    label?: string
  ): void {
    if (this.#phase !== LoggerReasoningPhase.idle && this.#phase !== LoggerReasoningPhase.thinking)
      this.#flushBuffer(core, 'response')
    this.#phase = LoggerReasoningPhase.thinking
    this.#buffer = ''
    const text = label ?? this.#resolvedConfig.labels?.thinking ?? 'Thinking...'
    this.#raw(core, `${paint('debug', text)}\n\n`)
  }

  #appendThinking(
    core: ILoggerPluginCore<IMiddlewarePipelineMode>,
    dim: IDimFn,
    delta: string
  ): void {
    if (this.#phase !== LoggerReasoningPhase.thinking) this.#startThinking(core, (_t, s) => s)
    this.#buffer += delta
    this.#raw(core, dim(delta))
  }

  #endThinking(core: ILoggerPluginCore<IMiddlewarePipelineMode>): void {
    if (this.#phase === LoggerReasoningPhase.thinking) this.#raw(core, '\n\n')
    this.#flushBuffer(core, 'thinking')
  }

  #startResponse(
    core: ILoggerPluginCore<IMiddlewarePipelineMode>,
    paint: IPaintFn,
    label?: string
  ): void {
    if (
      this.#phase !== LoggerReasoningPhase.idle &&
      this.#phase !== LoggerReasoningPhase.responding
    )
      this.#flushBuffer(core, 'thinking')
    this.#phase = LoggerReasoningPhase.responding
    this.#buffer = ''
    const text = label ?? this.#resolvedConfig.labels?.response
    if (text) this.#raw(core, `${paint('info', text)}\n\n`)
  }

  #appendResponse(core: ILoggerPluginCore<IMiddlewarePipelineMode>, delta: string): void {
    if (this.#phase !== LoggerReasoningPhase.responding) this.#startResponse(core, (_t, s) => s)
    this.#buffer += delta
    this.#raw(core, delta)
  }

  #endResponse(core: ILoggerPluginCore<IMiddlewarePipelineMode>): void {
    if (this.#phase === LoggerReasoningPhase.responding) this.#raw(core, '\n')
    this.#flushBuffer(core, 'response')
  }

  #flushBuffer(
    core: ILoggerPluginCore<IMiddlewarePipelineMode>,
    tag: 'thinking' | 'response'
  ): void {
    const text = this.#buffer
    this.#phase = LoggerReasoningPhase.idle
    this.#buffer = ''
    if (!text) return
    core.dispatchRaw(
      { tag, message: text, data: { silent: true } },
      { asyncOutput: this.#resolvedConfig.asyncOutput }
    )
  }

  /** 对 reasoning 产生的裸输出统一应用当前插件的调度策略。 */
  #raw(core: ILoggerPluginCore<IMiddlewarePipelineMode>, text: string): void {
    core.raw(text, { asyncOutput: this.#resolvedConfig.asyncOutput })
  }
}

export const reasoning = (
  config: IReasoningPluginConfig = {}
): ILoggerPlugin<
  IReasoningPluginExt,
  IReasoningPluginConfig,
  IMiddlewarePipelineMode,
  { readonly dependencies: typeof reasoningDependenciesFeature }
> => new ReasoningPlugin(config)
