import type { ILogFilter, IOff, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'
import { LoggerLevel } from '../plugin-constants.js'

export type ILogLevel = (typeof LoggerLevel)[keyof typeof LoggerLevel]

export type ILevelPluginConfig = {
  level?: ILogLevel
  filters?: ILogFilter[]
  /** 是否把该插件发起的日志推迟到当前同步调用栈之后处理；默认 false。 */
  asyncOutput?: boolean
}

export type ILevelPluginExt = {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  fatal(...args: unknown[]): void
  setLevel(level: ILogLevel): void
  /** 添加过滤器；返回 off 句柄，重复调用安全。 */
  addFilter(filter: ILogFilter): IOff
  removeFilter(filter: ILogFilter): void
}

/**
 * 插件自己的名字，导出成常量而不是散落的字符串字面量——install() 里用 这个常量去 core.config.get()，也是构造插件对象时 `readonly name` 的来源，
 * 两处只要有一处打错字，TS 都会因为类型不匹配而报错，不会静默失配。
 */
export const LEVEL_PLUGIN_NAME = 'level' as const

/**
 * 没有装这个插件时，Logger 实例上完全不存在 .info()/.warn() 这些方法—— 只能用核心的 core.log(tag, message) 通用接口。这正是"级别"作为一个
 * 可插拔概念而不是核心内置概念的直接体现。
 */
class LevelPlugin implements ILoggerPlugin<ILevelPluginExt, ILevelPluginConfig> {
  static readonly #LEVEL_ORDER: Record<ILogLevel, number> = {
    [LoggerLevel.debug]: 0,
    [LoggerLevel.info]: 1,
    [LoggerLevel.warn]: 2,
    [LoggerLevel.error]: 3,
    [LoggerLevel.fatal]: 4
  }

  readonly name = LEVEL_PLUGIN_NAME
  /** 只是把构造时收到的配置原样交给框架登记，install() 自己不读这个字段，见下面 install() 里的说明。 */
  readonly config: ILevelPluginConfig

  constructor(config: ILevelPluginConfig) {
    this.config = config
  }

  install(core: ILoggerPluginCore): ILevelPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取。
    // 走的是同一层，好处是"这个插件当前配置是什么"这件事对 core 本身可见，
    // 不是被插件私下攥在手里。
    const config = core.config.get<ILevelPluginConfig>() ?? {}
    let minLevel: ILogLevel = config.level ?? LoggerLevel.debug
    let filters: ILogFilter[] = [...(config.filters ?? [])]

    core.usePipeline((entry, next) => {
      const order = LevelPlugin.#LEVEL_ORDER
      const lvl = entry.tag as ILogLevel
      // tag 不是标准级别名时（比如 reasoning 插件的 "thinking:start"），
      // 不受级别阈值约束，直接放行，只有真正的级别 tag 才会被拦截
      if (lvl in order && order[lvl] < order[minLevel]) return
      if (!filters.every((f) => f(entry))) return
      next(entry)
    })

    const call =
      (level: ILogLevel) =>
      (...args: unknown[]): void => {
        const [message, ...rest] = args
        // 字符串首参保留 console 的 %s/%d/%o 等占位符语义；其它类型移入
        // 附加参数，让带前缀的控制台 sink 仍能按原始类型交给 console 渲染。
        const input =
          typeof message === 'string'
            ? { tag: level, message, args: rest }
            : { tag: level, message: '', args }
        core.dispatchRaw(input, { asyncOutput: config.asyncOutput })
      }

    const removeFilter = (filter: ILogFilter) => {
      filters = filters.filter((f) => f !== filter)
    }

    return {
      debug: call(LoggerLevel.debug),
      info: call(LoggerLevel.info),
      warn: call(LoggerLevel.warn),
      error: call(LoggerLevel.error),
      fatal: call(LoggerLevel.fatal),
      setLevel: (level) => {
        minLevel = level
      },
      addFilter: (filter) => {
        filters.push(filter)
        return () => {
          return removeFilter(filter)
        }
      },
      removeFilter
    }
  }
}

export const level = (
  config: ILevelPluginConfig = {}
): ILoggerPlugin<ILevelPluginExt, ILevelPluginConfig> => new LevelPlugin(config)
