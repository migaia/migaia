/** Borrowed process surface; the process plugin owns its listeners, not the host process. */
export type ILoggerProcess = {
  /** Environment values used by output detection and process policy. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Borrowed output stream used for host detection and raw writes. */
  readonly stdout: {
    /** Optional terminal flag; absence behaves as a non-TTY host. */
    readonly isTTY?: boolean
    /** Write raw text using the host's own buffering/error policy. */
    write(value: string): unknown
  }
  /** Attach a process event listener; failed installation participates in plugin rollback. */
  on(event: string, listener: (...args: any[]) => void): unknown
  /** Detach the exact owned event listener during rollback or final plugin release. */
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  /** Original terminal host operation; interception is opt-in and changes its timing. */
  exit: (code?: number) => never
}

/** Host capabilities captured by reference per Logger; the Logger does not dispose this manager. */
export type ILoggerRuntimeManager = {
  /** Optional process surface; absent hosts make the process plugin inert. */
  readonly process?: ILoggerProcess
  /** Optional injected file sink; absent by default in every runtime. */
  readonly fs?: {
    /** Append one newline-delimited JSON batch; rejection is reported as file delivery failure. */
    append(path: string, text: string): Promise<void>
    /** Optional rotation after the current batch crosses a configured threshold. */
    rotate?(path: string): Promise<void>
  }
  /**
   * Optional host cancellation factory for alternate AbortSignal implementations; native fallback
   * when absent.
   */
  readonly createAbortController?: () => AbortController
  /**
   * Generate Logger context and UUID-plugin identities; this does not establish cryptographic
   * trust.
   */
  randomUUID(): string
  /** Schedule a callback outside the current stack; Logger tracks its actual completion separately. */
  defer(task: () => void): void
  /** Write raw text; synchronous failures can propagate from Logger.raw(). */
  write(text: string): void
  /** Optional console surface; an absent console uses the manager's write fallback. */
  readonly console?: {
    /** Receive ordinary/debug/info output without reconstructing native arguments. */
    log(...args: unknown[]): void
    /** Receive warn-tag output from the color sink. */
    warn(...args: unknown[]): void
    /** Receive error/fatal output and terminal Logger diagnostics. */
    error(...args: unknown[]): void
  }
  /** Optional HTTP capability; absence makes attempted HTTP delivery fail TRANSPORT_UNAVAILABLE. */
  fetch?: (
    input: string,
    init: {
      /** HTTP verb chosen by the delivery plugin. */
      method: string
      /** Resolved request headers, including optional bearer authentication. */
      headers: Record<string, string>
      /** Serialized complete entry batch. */
      body: string
      /** Optional plugin-owned request/shutdown cancellation signal. */
      signal?: AbortSignal
    }
  ) => Promise<{
    /** Host success classification; failed responses follow retry/delivery policy. */
    readonly ok: boolean
    /** HTTP status used to select retryable responses. */
    readonly status: number
    /** Response metadata used for Retry-After policy. */
    readonly headers: {
      /** Return the response header value or null when absent. */
      get(name: string): string | null
    }
  }>
}

type IRuntimeGlobals = {
  readonly process?: ILoggerProcess
  readonly crypto?: { randomUUID?: () => string }
  readonly console?: { log(value: string): void }
  readonly setImmediate?: (task: () => void) => unknown
  readonly setTimeout?: (task: () => void, delay: number) => unknown
  readonly fetch?: ILoggerRuntimeManager['fetch']
}

const globals = globalThis as IRuntimeGlobals

/** Builds runtime capabilities from globals shared by Node, Bun, and browsers. */
function createDefaultRuntimeManager(): ILoggerRuntimeManager {
  const runtimeProcess = globals.process
  return {
    process: runtimeProcess,
    randomUUID: () =>
      globals.crypto?.randomUUID?.() ??
      // 仅用于 log 唯一 ID 的 fallback，不是 deadline/计时，不参与任何时间域契约。
      `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    defer: (task) => {
      if (globals.setImmediate) globals.setImmediate(task)
      else if (globals.setTimeout) globals.setTimeout(task, 0)
      else queueMicrotask(task)
    },
    write: (text) => {
      if (runtimeProcess) runtimeProcess.stdout.write(text)
      else globals.console?.log(text)
    },
    console: globals.console as ILoggerRuntimeManager['console'],
    fetch: globals.fetch
  }
}

type IRuntimeLayer = { manager: ILoggerRuntimeManager; active: boolean }
/** The default capability owner is captured once and reused after the final override is restored. */
const defaultRuntimeManager = createDefaultRuntimeManager()
const runtimeLayers: IRuntimeLayer[] = []
let runtimeManager: ILoggerRuntimeManager = defaultRuntimeManager

/** Return the current default manager by reference; existing Loggers retain their earlier owner. */
export const getLoggerRuntimeManager = (): ILoggerRuntimeManager => runtimeManager

/**
 * Layer the default for future Logger instances and return idempotent restoration. Overrides can be
 * restored out of order without reviving an already-restored layer. Existing Loggers/plugins keep
 * their captured manager; restoration does not dispose either manager or cancel its work.
 */
export function setLoggerRuntimeManager(manager: ILoggerRuntimeManager): () => void {
  const layer: IRuntimeLayer = { manager, active: true }
  runtimeLayers.push(layer)
  runtimeManager = manager
  return () => {
    if (!layer.active) return
    layer.active = false
    while (runtimeLayers.length > 0 && !runtimeLayers[runtimeLayers.length - 1]!.active)
      runtimeLayers.pop()
    runtimeManager = runtimeLayers.at(-1)?.manager ?? defaultRuntimeManager
  }
}

/** Creates host cancellation through the injected owner, with the existing native fallback. */
export function createLoggerAbortController(
  runtime: ILoggerRuntimeManager
): AbortController | undefined {
  if (runtime.createAbortController) return runtime.createAbortController()
  return typeof AbortController === 'function' ? new AbortController() : undefined
}
