import { Ansis } from 'ansis'
import { LogLevel } from '@migaia/log-host'
import { defineLogFeature, type ILogEntry, type ILogFeature } from '@migaia/log-host/plugin'
import { consoleProcess } from './environment.ts'
import { ConsoleColorMode, ConsoleEnvironmentKey, TOPIC_CHAIN_DATA_KEY } from './state-constants.ts'
import type { IPrettyOptions } from './typing.ts'

/** The format owner retains policy while every console delivery preserves native arguments. */
export class PrettyRenderer {
  /** Explicit color and timestamp options belong to this descriptor's immutable snapshot. */
  #options: Readonly<IPrettyOptions>
  /** Environment flags are captured from the same host used for default format selection. */
  #environment: Readonly<Record<string, string | undefined>>
  /** The host default supplies TTY only when another consumer has no output-specific capability. */
  #isTTY: boolean
  /** Explicit ANSI level prevents Ansis's independent environment detection from undoing policy. */
  #colored = new Ansis(3)
  /** A zero-level instance preserves exactly the same render path without ANSI. */
  #plain = new Ansis(0)

  /** Capture descriptor policy without borrowing caller-mutable configuration objects. */
  constructor(options: IPrettyOptions) {
    this.#options = Object.freeze({ ...options })
    /** Only process environment and stdout are read from the recognized server runtime. */
    const process = consoleProcess()
    this.#environment = Object.freeze({ ...process?.env })
    this.#isTTY = Boolean(process?.stdout?.isTTY)
  }

  /** Color a standard tag with the existing severity palette; custom tags remain unchanged. */
  paint(tag: string, text: string, isTTY = this.#isTTY): string {
    /** One of two fixed renderer instances implements the resolved policy. */
    const instance = this.#instance(isTTY)
    if (tag === LogLevel.debug) return instance.green(text)
    if (tag === LogLevel.info) return instance.cyan(text)
    if (tag === LogLevel.warn) return instance.yellow(text)
    if (tag === LogLevel.error) return instance.red(text)
    if (tag === LogLevel.fatal) return instance.bold.redBright(text)
    return text
  }

  /** Dim display metadata with the same ANSI policy as the tag painter. */
  dim(text: string, isTTY = this.#isTTY): string {
    return this.#instance(isTTY).dim(text)
  }

  /**
   * Create native console arguments while leaving message placeholders and payload identities
   * intact.
   */
  arguments(entry: ILogEntry, isTTY = this.#isTTY): unknown[] {
    /** Original native payloads never pass through string conversion while the host formats text. */
    const parts: unknown[] = [this.#prefix(entry, isTTY), ...entry.args]
    if (entry.meta && !entry.args.includes(entry.meta)) parts.push(entry.meta)
    if (entry.error) parts.push(entry.error.raw)
    return parts
  }

  /** The inert text record must not coerce native objects or Errors before console inspection. */
  format(entry: ILogEntry): string {
    return this.#prefix(entry, this.#isTTY)
  }

  /** Render only canonical prefix/message fields; native arguments remain outside this text path. */
  #prefix(entry: ILogEntry, isTTY: boolean): string {
    /** Timestamps remain optional only in human-readable formatting. */
    const timestamp =
      this.#options.timestamp === false ? '' : this.dim(`[${entry.time.toISOString()}] `, isTTY)
    /** Standard and custom tags retain the established uppercase bracket prefix. */
    const tag = this.paint(entry.tag, `[${entry.tag.toUpperCase()}]`, isTTY)
    /** Context is display data and never participates in forwarding-cycle authority. */
    const context = entry.context.length ? this.dim(`(${entry.context.join('.')}) `, isTTY) : ''
    /** UUID generation is host-owned; pretty only consumes its display marker. */
    const uuid = entry.data.uuidDisplay ? this.dim(`{${entry.data.uuid}} `, isTTY) : ''
    /** A forwarded topic chain retains declaration order and the established separator. */
    const topics = entry.data[TOPIC_CHAIN_DATA_KEY] as readonly string[] | undefined
    /** Empty chains contribute no display prefix. */
    const topic = topics?.length ? `${this.dim(`[${topics.join(' -> ')}]`, isTTY)}: ` : ''
    return `${timestamp}${tag} ${uuid}${context}${topic}${entry.message}`
  }

  /** Resolve explicit policy before the existing environment/TTY/CI precedence. */
  #instance(isTTY: boolean): Ansis {
    if (this.#options.color === ConsoleColorMode.always) return this.#colored
    if (this.#options.color === ConsoleColorMode.never) return this.#plain
    if (this.#environment[ConsoleEnvironmentKey.noColor]) return this.#plain
    /** Zero force-color explicitly does not force the automatic branch. */
    const force = this.#environment[ConsoleEnvironmentKey.forceColor]
    if (force && force !== '0') return this.#colored
    return isTTY || this.#environment[ConsoleEnvironmentKey.ci] ? this.#colored : this.#plain
  }
}

/** Return a native format feature whose installed formatter preserves native console arguments. */
export function prettyFeature(options: IPrettyOptions = {}): ILogFeature {
  /** Named state owns rendering rather than factory closures owning the component. */
  const renderer = new PrettyRenderer(options)
  /** Native installation carries these formatter callbacks; the token has no public fields. */
  return defineLogFeature({
    phase: 'format',
    format: (entry) => renderer.format(entry),
    paint: (tag, text) => renderer.paint(tag, text),
    dim: (text) => renderer.dim(text),
    arguments: (entry: ILogEntry, isTTY: boolean) => renderer.arguments(entry, isTTY)
  })
}
