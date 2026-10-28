import { LogLevel } from '@migaia/log-host'
import {
  defineOutputPlugin,
  type ILogFeature,
  type ILogOutputRecord,
  type ILogPlugin,
  type ILogPluginCore
} from '@migaia/log-host/plugin'
import { consoleProcess } from './environment.ts'
import { prettyFeature, prettyRenderers } from './pretty.ts'
import {
  CONSOLE_PLUGIN_NAME,
  ConsoleFormat,
  ConsoleEnvironmentKey,
  SILENT_DATA_KEY
} from './state-constants.ts'
import type {
  IConsoleExtension,
  IConsoleOptions,
  IConsoleStdout,
  IConsoleTarget
} from './typing.ts'

/** One output owner borrows console/stdout and receives only the host-selected format descriptor. */
class ConsoleOutput {
  /** Console methods are borrowed and retain their original receiver. */
  #console: IConsoleTarget
  /** Raw text and TTY detection use the same captured output capability. */
  #stdout: IConsoleStdout | undefined
  /** Automatic output is only a fallback; the host owns explicit-format precedence. */
  readonly defaultFormat: 'json' | Extract<ILogFeature, { phase: 'format' }>

  /** Capture capabilities and the existing automatic format policy before installation. */
  constructor(options: IConsoleOptions) {
    /** Default capabilities come only from the recognized host's process object. */
    const process = consoleProcess()
    this.#console = options.console ?? globalThis.console
    this.#stdout = options.stdout ?? process?.stdout
    /** Only json/pretty are admitted environment overrides; plain always requires explicit policy. */
    const format = process?.env?.[ConsoleEnvironmentKey.format]
    this.defaultFormat =
      format === ConsoleFormat.json
        ? ConsoleFormat.json
        : format === ConsoleFormat.pretty ||
            process?.env?.[ConsoleEnvironmentKey.ci] ||
            this.#stdout?.isTTY
          ? prettyFeature()
          : ConsoleFormat.json
  }

  /** Publish the raw extension after registering its real peer-owned revocation. */
  install(core: ILogPluginCore): IConsoleExtension {
    /** Reusing an output definition must not share raw-handle lifetime or failure ownership. */
    const raw = new ConsoleRaw(core, this.#console, this.#stdout)
    core.onDispose(() => raw.close())
    return { raw: (text) => raw.write(text) }
  }

  /** Native pretty delivery is selected by opaque identity; every other format writes only text. */
  deliver(
    records: readonly ILogOutputRecord[],
    format: Extract<ILogFeature, { phase: 'format' }>
  ): void {
    /** Only this package's factory-issued descriptor can select the native-argument path. */
    const pretty = prettyRenderers.get(format)
    for (const record of records) {
      if (record.entry.data[SILENT_DATA_KEY]) continue
      /** Original message, args, meta and Error remain distinct values on the pretty path. */
      const args = pretty
        ? pretty.arguments(record.entry, Boolean(this.#stdout?.isTTY))
        : [record.text]
      if (record.entry.tag === LogLevel.error || record.entry.tag === LogLevel.fatal)
        this.#console.error(...args)
      else if (record.entry.tag === LogLevel.warn) this.#console.warn(...args)
      else this.#console.log(...args)
    }
  }
}

/** Each installation independently owns its raw handle while borrowing the shared capabilities. */
class ConsoleRaw {
  /** Failures belong to this host rather than the last host to reuse a plugin definition. */
  #core: ILogPluginCore | undefined
  /** The supplied console remains usable by other installations after this one closes. */
  #console: IConsoleTarget
  /** Optional stdout preserves exact raw output and its original receiver. */
  #stdout: IConsoleStdout | undefined
  /** Capture independent registration authority and borrowed output capabilities. */
  constructor(core: ILogPluginCore, console: IConsoleTarget, stdout: IConsoleStdout | undefined) {
    this.#core = core
    this.#console = console
    this.#stdout = stdout
  }
  /** Contain the original writer failure without introducing a second structured-output path. */
  write(text: string): void {
    if (!this.#core) return
    try {
      if (this.#stdout) this.#stdout.write(text)
      else this.#console.log(text)
    } catch (error) {
      this.#core.reportFailure({ source: 'sink', error })
    }
  }
  /** Revocation releases only the host reference and leaves borrowed capabilities untouched. */
  close(): void {
    this.#core = undefined
  }
}

/** Create an optional console output with native pretty arguments and host-owned delivery policies. */
export function consolePlugin(options: IConsoleOptions = {}): ILogPlugin<IConsoleExtension> {
  /** The named owner holds capability and rendering state; SDK callbacks only forward to methods. */
  const output = new ConsoleOutput(options)
  return defineOutputPlugin({
    name: CONSOLE_PLUGIN_NAME,
    batchable: false,
    defaultFormat: output.defaultFormat,
    features: options.features,
    install: (core) => output.install(core),
    deliver: (records, context) => output.deliver(records, context.format)
  })
}
