import type { ILogFilter, IOff, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'
import { LoggerLevel, type ILoggerLevel } from '../plugin-constants.js'

/** Level/filter policy captured for this installation; core tags remain general labels. */
export type ILevelPluginConfig = {
  /** Minimum standard level, default debug; unknown tags bypass this threshold only. */
  level?: ILoggerLevel
  /** Initial predicates, copied into an installation-local list; defaults to empty. */
  filters?: ILogFilter[]
  /** Defers entries from this plugin until after the current synchronous stack. Defaults to `false`. */
  asyncOutput?: boolean
}

/** Methods added only when the level plugin is installed. */
export type ILevelPluginExt = {
  /** Dispatch a debug entry; string-first arguments preserve console placeholder semantics. */
  debug(...args: unknown[]): void
  /** Dispatch an info entry; nonstring-first values remain native arguments. */
  info(...args: unknown[]): void
  /** Dispatch a warn entry under the current threshold/filter policy. */
  warn(...args: unknown[]): void
  /** Dispatch an error entry without throwing it as a business exception. */
  error(...args: unknown[]): void
  /** Dispatch a fatal entry; this method does not itself exit the process. */
  fatal(...args: unknown[]): void
  /** Change this installation's live threshold without changing the host config snapshot. */
  setLevel(level: ILoggerLevel): void
  /** Adds a filter and returns an idempotent removal handle. */
  addFilter(filter: ILogFilter): IOff
  /** Remove all registrations of this exact predicate reference. */
  removeFilter(filter: ILogFilter): void
}

/**
 * Canonical level plugin name used by its `readonly name` property. The exported constant avoids
 * repeated name literals and keeps registration identity consistent.
 */
export const LEVEL_PLUGIN_NAME = 'level' as const

/**
 * 没有装这个插件时，Logger 实例上完全不存在 .info()/.warn() 这些方法—— 只能用核心的 core.log(tag, message) 通用接口。这正是"级别"作为一个
 * 可插拔概念而不是核心内置概念的直接体现。
 */
class LevelPlugin implements ILoggerPlugin<ILevelPluginExt, ILevelPluginConfig> {
  static readonly #LEVEL_ORDER: Record<ILoggerLevel, number> = {
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
    let minLevel: ILoggerLevel = config.level ?? LoggerLevel.debug
    let filters: ILogFilter[] = [...(config.filters ?? [])]

    core.usePipeline((entry, next) => {
      const order = LevelPlugin.#LEVEL_ORDER
      const lvl = entry.tag as ILoggerLevel
      // tag 不是标准级别名时（比如 reasoning 插件的 "thinking:start"），
      // 不受级别阈值约束，直接放行，只有真正的级别 tag 才会被拦截
      if (lvl in order && order[lvl] < order[minLevel]) return
      if (!filters.every((f) => f(entry))) return
      next(entry)
    })

    const call =
      (level: ILoggerLevel) =>
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

/**
 * Create standard level methods plus a filtering stage, defaulting to debug, no filters and
 * synchronous output. Every active predicate must pass; unknown tags skip only the level threshold.
 * PluginHost owns stage/extension removal, and output failures follow the Logger diagnostic path.
 */
export const level = (
  config: ILevelPluginConfig = {}
): ILoggerPlugin<ILevelPluginExt, ILevelPluginConfig> => new LevelPlugin(config)
