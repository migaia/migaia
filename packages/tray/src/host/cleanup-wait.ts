/**
 * Owns one logical cleanup deadline and its first settlement. The original physical Promise
 * continues after expiry; no extra cancellation, rejection wrapper or scheduler is introduced.
 */
/** Logical expiry never substitutes for the separately retained physical cleanup receipt. */
type ILogicalCleanupResult<T> =
  | { readonly complete: true; readonly value: T }
  | { readonly complete: false }

/** Owns the original single logical deadline and its first settlement, without cancelling cleanup. */
export class LogicalCleanupWait<T> {
  /** The first deadline or original Promise reaction alone may publish the logical outcome. */
  #settled = false
  /** This same host timer is cancelled only when physical settlement wins before expiry. */
  #timer: unknown
  /** The sole returned Promise receives the original complete/expired result shape. */
  #resolve!: (value: ILogicalCleanupResult<T>) => void
  /** Physical rejection retains its exact reason when it wins the logical wait. */
  #reject!: (reason?: unknown) => void
  /** Callers retain this same native Promise without an additional asynchronous wrapper. */
  readonly promise: Promise<ILogicalCleanupResult<T>>

  /** Install the original timer before subscribing to the unchanged physical Promise. */
  constructor(value: Promise<T>, budgetMs: number) {
    this.promise = new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#timer = scheduleTimer(this.#expire, budgetMs)
      value.then(this.#complete, this.#fail)
    })
  }

  /** Expiry publishes only logical incompleteness; the original physical work keeps running. */
  #expire = (): void => {
    if (this.#settled) return
    this.#settled = true
    this.#resolve({ complete: false })
  }

  /** A winning physical result clears the original timer before resolving with that exact value. */
  #complete = (result: T): void => {
    if (this.#settled) return
    this.#settled = true
    cancelTimer(this.#timer)
    this.#resolve({ complete: true, value: result })
  }

  /** A winning physical failure clears the same timer and rejects with its original identity. */
  #fail = (error: unknown): void => {
    if (this.#settled) return
    this.#settled = true
    cancelTimer(this.#timer)
    this.#reject(error)
  }
}

/** Reads the host timer capability without coupling Tray's declarations to DOM or Node libs. */
function scheduleTimer(callback: () => void, delayMs: number): unknown {
  /** Read the optional native timer capability without introducing a platform dependency. */
  const timerHost = globalThis as unknown as {
    readonly setTimeout?: (handler: () => void, timeout: number) => unknown
  }
  return timerHost.setTimeout ? timerHost.setTimeout(callback, delayMs) : undefined
}

/** Cancels a timer returned by the host platform when one is available. */
function cancelTimer(timer: unknown): void {
  /** Read the optional native timer capability without introducing a platform dependency. */
  const timerHost = globalThis as unknown as {
    readonly clearTimeout?: (handle: unknown) => void
  }
  if (timer !== undefined) timerHost.clearTimeout?.(timer)
}
