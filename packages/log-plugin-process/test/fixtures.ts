import type { ILogPluginCore } from '@migaia/log-host/plugin'

/** Event ownership is observable separately for every injected process object. */
export class MemoryProcess {
  /** The structural process contract always exposes its own environment snapshot. */
  readonly env: Record<string, string | undefined> = {}
  /** Every event contains the live listeners owned by the plugin group. */
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  /** Signal-driven exit codes are recorded without ending the test process. */
  readonly exits: Array<number | undefined> = []
  /** Original exit receivers remain observable across interception and restoration. */
  readonly exitReceivers: unknown[] = []
  /** Register the original callback identity. */
  on(event: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }
  /** Remove only the matching registration. */
  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener)
  }
  /** Record an exit with the original receiver. */
  exit(code?: number): void {
    this.exitReceivers.push(this)
    this.exits.push(code)
  }
  /** Signal every currently registered listener once. */
  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

/** Fixed peer timeouts are disabled when the case targets only process-owned timing. */
export const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

/** Listener admission and cleanup can independently fail without hiding their original identities. */
export class FailureProcess extends MemoryProcess {
  /** A failing event can throw before or after its listener was stored. */
  installEvent: string | undefined
  /** The original installation primary remains first when rollback also fails. */
  installFailure: unknown
  /** Partial-registration fixtures deliberately store the listener before throwing. */
  storeBeforeFailure = false
  /** Each selected removal throws its corresponding original value. */
  readonly removalFailures = new Map<string, unknown>()
  /** Every cleanup attempt remains observable even when the callback throws. */
  readonly removalAttempts: string[] = []
  /** Partial-cleanup fixtures can remove native ownership before reporting their failure. */
  removeBeforeFailure = false
  /** One exact exit failure can be retained under a shutdown cleanup wrapper. */
  exitFailure: Error | undefined
  /** Store or reject an original listener at the requested failure boundary. */
  override on(event: string, listener: (...args: unknown[]) => void): void {
    if (event === this.installEvent && !this.storeBeforeFailure) throw this.installFailure
    super.on(event, listener)
    if (event === this.installEvent) throw this.installFailure
  }
  /** Attempt every removal and leave the chosen failure unchanged. */
  override removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.removalAttempts.push(event)
    if (this.removeBeforeFailure) super.removeListener(event, listener)
    if (this.removalFailures.has(event)) throw this.removalFailures.get(event)
    if (!this.removeBeforeFailure) super.removeListener(event, listener)
  }
  /** Preserve the exit failure or record the original receiver's exit call. */
  override exit(code?: number): void {
    if (this.exitFailure) throw this.exitFailure
    super.exit(code)
  }
}

/** Exit setters can commit a wrapper and still throw, exercising restoration ownership. */
export class SetterProcess extends FailureProcess {
  /** The original method identity must be restored after interception or rollback. */
  readonly originalExit: (code?: number) => void
  /** The actual callable slot is exposed through the hostile accessor. */
  #exitValue: (code?: number) => void
  /** Failure thrown after a wrapper has already been committed. */
  wrapFailure: Error | undefined
  /** Failure thrown when cleanup attempts to restore the original method. */
  restoreFailure: Error | undefined
  /** One-shot wrap failure allows rollback to restore normally. */
  failWrapOnce = false
  /** Install the accessor without adding a second process capability or changing identity. */
  constructor() {
    super()
    this.originalExit = this.exit
    this.#exitValue = this.originalExit
    Object.defineProperty(this, 'exit', {
      configurable: true,
      get: () => this.#exitValue,
      set: (value: (code?: number) => void) => this.setExit(value)
    })
  }
  /** Commit before throwing, exactly like the original hostile setter fixtures. */
  setExit(value: (code?: number) => void): void {
    this.#exitValue = value
    if (value === this.originalExit && this.restoreFailure) throw this.restoreFailure
    if (value !== this.originalExit && this.wrapFailure) {
      /** Preserve the chosen original failure while clearing only a one-shot injection. */
      const failure = this.wrapFailure
      if (this.failWrapOnce) this.wrapFailure = undefined
      throw failure
    }
  }
}

/** Find a semantic error through cleanup receipts, causes and aggregate branches without reordering. */
export function findProcessError(value: unknown, code: string): Error & { cause?: unknown } {
  /** Cursor traversal keeps the helper linear in the reachable error graph. */
  const pending: unknown[] = [value]
  /** Cyclic causes cannot make a malformed fixture loop forever. */
  const visited = new Set<unknown>()
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** Each original object is visited at most once. */
    const candidate = pending[cursor]
    if (visited.has(candidate)) continue
    visited.add(candidate)
    if (Array.isArray(candidate)) {
      pending.push(...candidate)
      continue
    }
    if (candidate instanceof Error) {
      if ((candidate as { code?: unknown }).code === code) return candidate
      pending.push(candidate.cause)
      if (candidate instanceof AggregateError) pending.push(...candidate.errors)
    }
    if (candidate && typeof candidate === 'object') {
      /** Canonical peer removal/disposal receipts keep errors in these owned lists. */
      const record = candidate as { cleanupErrors?: unknown; errors?: unknown; error?: unknown }
      if (Array.isArray(record.cleanupErrors)) pending.push(...record.cleanupErrors)
      if (Array.isArray(record.errors)) pending.push(...record.errors)
      if (record.error !== undefined) pending.push(record.error)
    }
  }
  throw new Error(`process semantic error not found: ${code}`)
}

/** Let event-driven shutdown settle before reading diagnostic calls. */
export function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** A real plugin counts flush callbacks without reintroducing removed host facade methods. */
export class FlushObserver {
  /** The peer owns one distinct observer registration. */
  readonly name = 'process-flush-observer'
  /** Actual callback count detects duplicate beforeExit work. */
  count = 0
  /** Register the observation during the supported install window. */
  install(core: ILogPluginCore): Record<string, never> {
    core.onFlush(() => this.increment())
    return {}
  }
  /** Increment without returning a numeric hook result. */
  increment(): void {
    this.count++
  }
}
