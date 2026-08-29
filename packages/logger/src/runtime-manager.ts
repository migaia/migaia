export type ILoggerProcess = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdout: {
    readonly isTTY?: boolean
    write(value: string): unknown
  }
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  exit: (code?: number) => never
}

export type ILoggerRuntimeManager = {
  readonly process?: ILoggerProcess
  /** Optional Logger-owned AbortController factory for hostile-realm and cancellation tests. */
  readonly createAbortController?: () => AbortController
  randomUUID(): string
  defer(task: () => void): void
  write(text: string): void
  readonly console?: {
    log(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
  fetch?: (
    input: string,
    init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
  ) => Promise<{
    readonly ok: boolean
    readonly status: number
    readonly headers: { get(name: string): string | null }
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
      // 仅用于 log 唯一 ID 的 fallback，不是 deadline/计时，不参与任何时间域契约（R-9）。
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
const runtimeLayers: IRuntimeLayer[] = []
let runtimeManager: ILoggerRuntimeManager = createDefaultRuntimeManager()

/** Returns the active host capability manager. */
export const getLoggerRuntimeManager = (): ILoggerRuntimeManager => runtimeManager

/** Replaces host capabilities and returns a restoration callback. */
export function setLoggerRuntimeManager(manager: ILoggerRuntimeManager): () => void {
  const layer: IRuntimeLayer = { manager, active: true }
  runtimeLayers.push(layer)
  runtimeManager = manager
  return () => {
    if (!layer.active) return
    layer.active = false
    while (runtimeLayers.length > 0 && !runtimeLayers[runtimeLayers.length - 1]!.active)
      runtimeLayers.pop()
    runtimeManager = runtimeLayers.at(-1)?.manager ?? createDefaultRuntimeManager()
  }
}
