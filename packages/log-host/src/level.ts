import type { ILogPlugin, ILogPluginCore, ILevelPluginExt, IRawEntryInput } from './typing.ts'
import { LogLevel, LogPluginName, explicitLevel } from './state-constants.ts'

/** One installation owns its core reference; extension callables only forward to named methods. */
class LevelMethods {
  /** The peer registration revokes these capabilities when the plugin is removed. */
  #core: ILogPluginCore
  /** Capture the real installation core without reading global runtime state. */
  constructor(core: ILogPluginCore) {
    this.#core = core
  }
  /** String-first arguments preserve placeholders; other values remain native argument identities. */
  write(level: LogLevel, args: readonly unknown[]): void {
    /** Only the first string is treated as a message; the rest retain console argument semantics. */
    const [message, ...rest] = args
    this.#core.dispatchRaw(
      typeof message === 'string'
        ? { tag: level, message, args: rest }
        : { tag: level, message: '', args }
    )
  }
  /** A category retains its own tag while carrying an explicit standard threshold level privately. */
  atLevel(level: LogLevel, input: IRawEntryInput): void {
    this.#core.dispatchRaw({ ...input, data: { ...input.data, [explicitLevel]: level } })
  }
  /** Publish only the six authorized standard logging methods as plain extension descriptors. */
  extensions(): ILevelPluginExt {
    return {
      debug: (...args) => this.write(LogLevel.debug, args),
      info: (...args) => this.write(LogLevel.info, args),
      warn: (...args) => this.write(LogLevel.warn, args),
      error: (...args) => this.write(LogLevel.error, args),
      fatal: (...args) => this.write(LogLevel.fatal, args),
      atLevel: (level, input) => this.atLevel(level, input)
    }
  }
}

/** Level policy is separate from filtering, so installing methods never silently drops entries. */
class LevelPlugin implements ILogPlugin<ILevelPluginExt> {
  /** Registration identity remains independent of a particular host. */
  readonly name = LogPluginName.level
  /** Return methods owned by this exact plugin registration. */
  install(core: ILogPluginCore): ILevelPluginExt {
    return new LevelMethods(core).extensions()
  }
}

/** Add standard severity methods without adding threshold or filtering state to the host. */
export function levelPlugin(): ILogPlugin<ILevelPluginExt> {
  return new LevelPlugin()
}
