import { Ansis } from 'ansis'
import type { IPipelineMode } from '@migaia/plugin-host'

import type {
  IEmptyPluginExt,
  IDimFn,
  ILogEntry,
  ILoggerPluginCore,
  ILoggerPlugin,
  IPaintFn
} from '../typing.js'
import { getLoggerRuntimeManager } from '../runtime-manager.js'
import { LoggerConsoleTag } from '../plugin-constants.js'
import { LoggerColorMode } from '../plugin-constants.js'

export type IColorMode = (typeof LoggerColorMode)[keyof typeof LoggerColorMode]
export type IOutputFormat = 'auto' | 'pretty' | 'json'

export type IColorPluginConfig = {
  color?: IColorMode
  format?: IOutputFormat
  timestamp?: boolean
  /** Message 参数着色范围；默认 none，只染色级别标签。 */
  colorMessage?: 'head' | 'tail' | 'head-tail' | 'all' | 'none'
  /** 自定义 tag -> 染色函数映射，未命中的 tag 走原样输出， 方便非 level 场景（比如 reasoning 插件的 tag）也能按需上色 */
  colorMap?: Record<string, (text: string) => string>
}

export type IColorShared = { paint: IPaintFn; dim: IDimFn }

// IPaintFn / IDimFn 这两个类型定义在 typing.ts（公共约定），这里只是使用方之一，
// 不是定义方——其它插件（比如 reasoning）要用同样的能力，也从 typing.ts 导入
// 这两个类型，而不是从这个文件导入，避免插件之间产生直接的文件依赖。

export const ANSIS_PLUGIN_NAME = 'ansis' as const

class ColorPlugin implements ILoggerPlugin<
  IEmptyPluginExt,
  IColorPluginConfig,
  IPipelineMode,
  IColorShared
> {
  readonly name = ANSIS_PLUGIN_NAME
  /**
   * 只是把构造时收到的配置原样交给框架登记，下面所有方法都不读这个字段，统一读 install() 里从 core.config.get() 拿到、 存进 #resolvedConfig
   * 的那份——见 install() 里的说明。
   */
  readonly config: IColorPluginConfig

  // 这几个字段的真正初始化发生在 install() 里（因为要先拿到 core 才能
  // core.config.get()），构造函数阶段还没有值，用 "!" 告诉 TS 这是"稍后一定
  // 会被赋值"，不是遗漏初始化。
  #resolvedConfig!: IColorPluginConfig
  /**
   * 关键点：ansis 库自己内部也有一套颜色支持等级检测（ansis.level）， 不能只判断"要不要调用染色函数"，还必须把底层这个 Ansis 实例的 level
   * 显式设成跟我们自己的判断一致，否则哪怕我们判断"该上色"， ansis 库在它自己认为不支持颜色的环境下依然会静默不出转义符—— 这正是"color: always
   * 没有真正生效"这类颜色异常的根因。 用一个显式构造的 Ansis 实例（而不是默认单例）来彻底避免这个不一致。
   */
  #instance!: Ansis
  #colorMap!: Record<string, (text: string) => string>
  #paint!: IPaintFn
  #dim!: IDimFn

  constructor(config: IColorPluginConfig) {
    this.config = config
  }

  shared(core: ILoggerPluginCore): IColorShared {
    // 不读 this.config——统一通过 core.config.get() 读取
    this.#resolvedConfig = core.config.get<IColorPluginConfig>() ?? {}
    this.#instance = new Ansis(this.#isColorEnabled() ? 3 : 0)
    this.#colorMap = {
      debug: (t) => this.#instance.green(t),
      info: (t) => this.#instance.cyan(t),
      warn: (t) => this.#instance.yellow(t),
      error: (t) => this.#instance.red(t),
      // fatal 使用高亮红 + 粗体，和普通 error 拉开危险等级差异。
      fatal: (t) => this.#instance.bold.redBright(t),
      ...this.#resolvedConfig.colorMap
    }

    this.#paint = (tag, text) => {
      const fn = this.#colorMap[tag] ?? ((t: string) => t)
      return fn(text)
    }
    this.#dim = (text) => this.#instance.dim(text)
    return { paint: this.#paint, dim: this.#dim }
  }

  install(core: ILoggerPluginCore): IEmptyPluginExt {
    const off = core.useSink((entry) => {
      // data.silent 是给"只想进 http/batch 之类下游 sink，不想在控制台重复打印"的
      // entry 用的标记（reasoning 插件会用到），约定由 ansis 这个控制台 sink 负责识别
      if (entry.data.silent) return
      this.#render(entry, this.#paint, this.#dim)
    })
    core.onDispose(off)

    return {}
  }

  #isColorEnabled(): boolean {
    const mode = this.#resolvedConfig.color ?? LoggerColorMode.auto
    if (mode === LoggerColorMode.always) return true
    if (mode === LoggerColorMode.never) return false
    const runtimeProcess = getLoggerRuntimeManager().process
    if (runtimeProcess?.env.NO_COLOR) return false
    if (runtimeProcess?.env.FORCE_COLOR && runtimeProcess.env.FORCE_COLOR !== '0') return true
    if (runtimeProcess?.stdout.isTTY) return true
    // 关键点：CI 环境 isTTY 通常是 false，但绝大多数 CI 日志面板渲染 ANSI 没问题，
    // 所以 CI 下默认仍然上色，而不是像纯管道重定向那样关闭
    if (runtimeProcess?.env.CI) return true
    return false
  }

  #resolveFormat(): 'pretty' | 'json' {
    const configured = this.#resolvedConfig.format ?? 'auto'
    if (configured !== 'auto') return configured
    const runtimeProcess = getLoggerRuntimeManager().process
    const envFormat = runtimeProcess?.env.LOG_FORMAT
    if (envFormat === 'json' || envFormat === 'pretty') return envFormat
    if (runtimeProcess?.env.CI) return 'pretty' // CI 场景是人在看，优先可读性
    if (runtimeProcess?.stdout.isTTY) return 'pretty'
    return 'json' // 被重定向到文件 / 被容器日志采集器抓取
  }

  #render(entry: ILogEntry, paint: IPaintFn, dim: IDimFn): void {
    if (this.#resolveFormat() === 'json') this.#writeJson(entry)
    else this.#writePretty(entry, paint, dim)
  }

  #writeJson(entry: ILogEntry): void {
    const payload = {
      tag: entry.tag,
      time: entry.time.toISOString(),
      context: entry.context.length ? entry.context.join('.') : undefined,
      // uuid/topics 是否出现在渲染结果里，交给各自插件的 display 开关决定——
      // ansis 只负责按约定读取 entry.data 里这两个字段，不关心是谁写进去的
      id: entry.data.uuidDisplay ? (entry.data.uuid as string | undefined) : undefined,
      topics: this.#formatTopicChain(entry),
      message: entry.message,
      meta: entry.meta,
      error: entry.error
    }
    this.#sink(entry.tag)(JSON.stringify(payload))
  }

  #writePretty(entry: ILogEntry, paint: IPaintFn, dim: IDimFn): void {
    const useTimestamp = this.#resolvedConfig.timestamp ?? true
    const ts = useTimestamp ? dim(`[${entry.time.toISOString()}] `) : ''
    const tag = paint(entry.tag, `[${entry.tag.toUpperCase()}]`)
    const ctx = entry.context.length ? dim(`(${entry.context.join('.')}) `) : ''

    const idPrefix = entry.data.uuidDisplay ? dim(`{${entry.data.uuid}} `) : ''
    const topicChain = this.#formatTopicChain(entry)
    const topicPrefix = topicChain ? `${dim(`[${topicChain}]`)}: ` : ''
    const colorMessage = this.#resolvedConfig.colorMessage ?? 'none'
    const message =
      colorMessage === 'head' ||
      colorMessage === 'head-tail' ||
      colorMessage === 'all' ||
      (colorMessage === 'tail' && entry.args.length === 0)
        ? paint(entry.tag, entry.message)
        : entry.message
    const args =
      colorMessage === 'all'
        ? entry.args.map((arg) => this.#paintPrimitive(entry.tag, arg, paint))
        : colorMessage === 'tail' || colorMessage === 'head-tail'
          ? entry.args.map((arg, index) =>
              index === entry.args.length - 1 ? this.#paintPrimitive(entry.tag, arg, paint) : arg
            )
          : entry.args

    const parts: unknown[] = [`${ts}${tag} ${idPrefix}${ctx}${topicPrefix}${message}`, ...args]
    if (entry.meta && !entry.args.includes(entry.meta)) parts.push(entry.meta)
    if (entry.error) {
      // 关键点：直接把原始 Error 对象作为独立参数传给 console.error，而不是把
      // stack 拼进一个字符串里。console/util.inspect 对真正的 Error 实例有原生的
      // 堆栈渲染能力，终端（比如 VS Code 集成终端）也会按 "file:line:col" 模式识别
      // 出可点击的跳转链接，跳转的是错误真正抛出的位置，不是这里拼字符串的代码。
      // 如果改成手动拼接字符串，等于自己把这条能力废掉了。
      parts.push(entry.error.raw)
    }
    this.#sink(entry.tag)(...parts)
  }

  /** 保留对象和 Error 引用给 console 原生 inspect；只文本化并染色 primitive。 */
  #paintPrimitive(tag: string, value: unknown, paint: IPaintFn): unknown {
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') return value
    return paint(tag, String(value))
  }

  /**
   * TopicChain 是 extends() 组合多个 logger 时追加进 entry.data 的链路信息， 跟 uuid 一样是"其它机制往 data 里写、ansis
   * 按约定读"的松耦合协作方式
   */
  #formatTopicChain(entry: ILogEntry): string | undefined {
    const chain = entry.data.topicChain as string[] | undefined
    if (!chain || chain.length === 0) return undefined
    return chain.join(' -> ')
  }

  #sink(tag: string): (...args: unknown[]) => void {
    const runtime = getLoggerRuntimeManager()
    if (runtime.console) {
      if (tag === LoggerConsoleTag.error || tag === LoggerConsoleTag.fatal)
        return runtime.console.error
      if (tag === LoggerConsoleTag.warn) return runtime.console.warn
      return runtime.console.log
    }
    return (...args) =>
      runtime.write(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '))
  }
}

export const color = (
  config: IColorPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IColorPluginConfig, IPipelineMode, IColorShared> =>
  new ColorPlugin(config)
