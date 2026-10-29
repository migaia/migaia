import { detectServerRuntime } from '@migaia/utils'
import { LogEntryDataKey, type ILogPlugin, type ILogPluginCore } from '@migaia/log-host/plugin'
import {
  DEFAULT_THINKING_LABEL,
  REASONING_PLUGIN_NAME,
  ReasoningPhase,
  ReasoningTag
} from './state-constants.ts'
import type { IReasoningExtension, IReasoningPluginConfig } from './typing.ts'

/** The peer's configured core retains labels, writer and scheduling option types without casts. */
type IReasoningCore = Parameters<
  ILogPlugin<IReasoningExtension, IReasoningPluginConfig>['install']
>[0]

/** Token writers need no Node type declarations and remain borrowed capabilities. */
type IStdout = { write(text: string): unknown }

/** A named writer preserves an injected callback's plain receiver and native stdout's own receiver. */
class TokenWriter {
  /** A supplied callback takes precedence over every host default. */
  #write: ((text: string) => void) | undefined
  /** The recognized server's stdout is borrowed without taking ownership. */
  #stdout: IStdout | undefined

  /** Select the original capability once for this installation. */
  constructor(write: ((text: string) => void) | undefined) {
    this.#write = write
    this.#stdout =
      detectServerRuntime() === undefined
        ? undefined
        : (globalThis as unknown as { process?: { stdout?: IStdout } }).process?.stdout
  }

  /** Write original text without ANSI, added newlines or an alternative structured-log path. */
  write(text: string): void {
    /** Calling the function as a local preserves its standalone injection contract. */
    const write = this.#write
    if (write) write(text)
    else if (this.#stdout) this.#stdout.write(text)
    else globalThis.console?.log(text)
  }
}

/** Each installation owns its phase state even when the same plugin definition is reused. */
class ReasoningInstallation {
  /** The real core owns scheduling, failure reporting and completed entry admission. */
  #core: ILogPluginCore
  /** Only a deliberate end/switch publishes the accumulated phase. */
  #phase: ReasoningPhase = ReasoningPhase.idle
  /** Delta chunks avoid repeatedly copying a growing string on every token. */
  #chunks: string[] = []
  /** Labels and scheduling use the peer-owned immutable configuration snapshot. */
  #options: IReasoningPluginConfig
  /** Stream output remains distinct from ordinary entry delivery. */
  #writer: TokenWriter
  /** Revocation discards unfinished text instead of publishing it implicitly. */
  #active = true

  /** Capture one installation's independent buffer, configuration and borrowed writer. */
  constructor(core: ILogPluginCore, options: IReasoningPluginConfig) {
    this.#core = core
    this.#options = options
    this.#writer = new TokenWriter(options.write)
    core.onDispose(() => this.close())
  }

  /** Starting thinking completes an unfinished response, then resets the thinking buffer. */
  startThinking(label?: string): void {
    if (!this.#active) return
    if (this.#phase !== ReasoningPhase.idle && this.#phase !== ReasoningPhase.thinking)
      this.#complete(ReasoningTag.response, ReasoningPhase.responding)
    this.#phase = ReasoningPhase.thinking
    this.#chunks = []
    /** An empty explicit label preserves the original empty-heading behavior. */
    const text = label ?? this.#options.labels?.thinking ?? DEFAULT_THINKING_LABEL
    this.#emit(`${text}\n\n`)
  }

  /** Thinking deltas start the phase automatically and remain byte-for-byte raw text. */
  thinking(delta: string): void {
    if (!this.#active) return
    if (this.#phase !== ReasoningPhase.thinking) this.startThinking()
    this.#chunks.push(delta)
    this.#emit(delta)
  }

  /** Finish thinking explicitly; any other phase keeps its buffer for its own end call. */
  endThinking(): void {
    if (!this.#active || this.#phase !== ReasoningPhase.thinking) return
    this.#emit('\n\n')
    this.#complete(ReasoningTag.thinking, ReasoningPhase.thinking)
  }

  /** Starting a response completes unfinished thinking before selecting the new label. */
  startResponse(label?: string): void {
    if (!this.#active) return
    if (this.#phase !== ReasoningPhase.idle && this.#phase !== ReasoningPhase.responding)
      this.#complete(ReasoningTag.thinking, ReasoningPhase.thinking)
    this.#phase = ReasoningPhase.responding
    this.#chunks = []
    /** Responses have no default heading when both label sources are absent. */
    const text = label ?? this.#options.labels?.response
    if (text) this.#emit(`${text}\n\n`)
  }

  /** Response deltas start their phase automatically and preserve the old output order. */
  response(delta: string): void {
    if (!this.#active) return
    if (this.#phase !== ReasoningPhase.responding) this.startResponse()
    this.#chunks.push(delta)
    this.#emit(delta)
  }

  /** End a response with one newline and one audit entry; other phases are left untouched. */
  endResponse(): void {
    if (!this.#active || this.#phase !== ReasoningPhase.responding) return
    this.#emit('\n')
    this.#complete(ReasoningTag.response, ReasoningPhase.responding)
  }

  /** Snapshot completed text once, then clear state before dispatch can run or reenter. */
  #complete(tag: (typeof ReasoningTag)[keyof typeof ReasoningTag], phase: ReasoningPhase): void {
    /** One final join keeps total accumulation work linear in the phase text. */
    const text = this.#chunks.join('')
    this.#phase = ReasoningPhase.idle
    this.#chunks = []
    if (!text) return
    if (this.#options.asyncOutput) this.#core.defer(() => this.#dispatch(tag, phase, text))
    else this.#dispatch(tag, phase, text)
  }

  /** Publish ordinary structured data; silent suppresses only console's duplicate display. */
  #dispatch(
    tag: (typeof ReasoningTag)[keyof typeof ReasoningTag],
    phase: ReasoningPhase,
    text: string
  ): void {
    this.#core.dispatchRaw({
      tag,
      message: text,
      data: { reasoningPhase: phase, [LogEntryDataKey.silent]: true }
    })
  }

  /** Defer only when explicitly requested, using the host's existing tracked-work capability. */
  #emit(text: string): void {
    if (this.#options.asyncOutput) this.#core.defer(() => this.#write(text))
    else this.#write(text)
  }

  /** Writer failure remains the original error and never leaves a phase method. */
  #write(text: string): void {
    try {
      this.#writer.write(text)
    } catch (error) {
      this.#core.reportFailure({ source: 'sink', error })
    }
  }

  /** Discard unfinished buffer state; a borrowed stdout or writer is never closed. */
  close(): void {
    this.#active = false
    this.#chunks = []
    this.#phase = ReasoningPhase.idle
  }

  /** Publish only the six established methods from this installation owner. */
  extensions(): IReasoningExtension {
    return {
      startThinking: (label) => this.startThinking(label),
      thinking: (delta) => this.thinking(delta),
      endThinking: () => this.endThinking(),
      startResponse: (label) => this.startResponse(label),
      response: (delta) => this.response(delta),
      endResponse: () => this.endResponse()
    }
  }
}

/** The reusable definition stores only config; mutable phase state belongs to each installation. */
class ReasoningPlugin implements ILogPlugin<IReasoningExtension, IReasoningPluginConfig> {
  /** The canonical peer owns this stable registration identity. */
  readonly name = REASONING_PLUGIN_NAME
  /** Config callbacks retain their original identity through the peer's config owner. */
  readonly config: IReasoningPluginConfig
  /** Capture the public factory input before peer installation. */
  constructor(options: IReasoningPluginConfig) {
    this.config = options
  }
  /** Create one independent phase owner from the peer-owned config snapshot. */
  install(core: IReasoningCore): IReasoningExtension {
    return new ReasoningInstallation(core, core.config.get()).extensions()
  }
}

/** Create streaming phase methods with original text output and separate silent completed entries. */
export function reasoningPlugin(
  options: IReasoningPluginConfig = {}
): ILogPlugin<IReasoningExtension, IReasoningPluginConfig> {
  return new ReasoningPlugin(options)
}
