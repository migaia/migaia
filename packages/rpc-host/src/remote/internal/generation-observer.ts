import { deferTask } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRemoteBinding } from '../types.js'
import type { IRemoteGenerationHolder, IRemoteRuntimeRegistration } from '../proxy.js'

/** One actual managed registration coalesces native observations into its original rebind owner. */
class RemoteGenerationObserver<TUnit, TSpec> {
  /** Current, departure and readiness remain owned by this original registration holder. */
  #holder: IRemoteGenerationHolder<IRemoteRuntimeRegistration>
  /** The original native supervisor supplies both lifecycle observations and the one clock. */
  #binding: IRemoteBinding<TUnit, TSpec>
  /** Disposal cancels observation before an in-progress rebind can publish another generation. */
  #signal: IAbortSignal
  /** The original reporter receives unexpected asynchronous observer failures. */
  #report: (error: unknown) => void
  /** Closing this receipt prevents any later supervisor observation from preparing resources. */
  #subscribed = true
  /** One existing scheduler task drains all coalesced observations; no second queue is created. */
  #running = false
  /** A new observation during preparation requests one subsequent state reconciliation. */
  #pending = false
  /** Exact native subscription cleanup remains independent of the registration's resource cleanup. */
  #unsubscribe: () => void

  /** Subscribe to native transitions without preparing a generation or copying supervisor state. */
  constructor(
    holder: IRemoteGenerationHolder<IRemoteRuntimeRegistration>,
    binding: IRemoteBinding<TUnit, TSpec>,
    signal: IAbortSignal,
    report: (error: unknown) => void
  ) {
    this.#holder = holder
    this.#binding = binding
    this.#signal = signal
    this.#report = report
    this.#unsubscribe = binding.supervisor.subscribe((event) => {
      if (event.type === 'exit' || event.type === 'switched') this.#schedule()
      if (event.type === 'state' && event.to === 'ready') this.#schedule()
    })
  }

  /** Prepare only a genuinely ready native generation through its exact original holder. */
  async #reconcile(): Promise<void> {
    if (!this.#subscribed || this.#signal.aborted) return
    if (this.#holder.registration.events.current().active) return
    if (this.#binding.supervisor.state !== 'ready') return
    try {
      await this.#holder.prepareRebind(this.#signal)
      if (!this.#subscribed || this.#signal.aborted) return
    } catch {
      return // The original holder reports failed replacement and keeps its registration revoked.
    }
  }

  /** Coalesce native transitions into the original single pending reconciliation loop. */
  #schedule(): void {
    this.#pending = true
    if (this.#running) return
    this.#running = true
    deferTask(this.#binding.scheduler, this.#drain)
  }

  /** Start the original asynchronous drain and report its late failure without receiver changes. */
  #drain = (): void => {
    void this.#run().catch(this.#report)
  }

  /** Reconcile each observed transition once while the original receipt remains subscribed. */
  async #run(): Promise<void> {
    try {
      while (this.#pending && this.#subscribed) {
        this.#pending = false
        await this.#reconcile()
      }
    } finally {
      this.#running = false
    }
  }

  /** Release this observer alone, retaining the original repeated unsubscribe behavior. */
  close = (): void => {
    this.#subscribed = false
    ;(0, this.#unsubscribe)()
  }
}

/** Retain native generation observation without the retired Plugin visibility facade. */
export function observeRemoteGenerations<TUnit, TSpec>(
  holder: IRemoteGenerationHolder<IRemoteRuntimeRegistration>,
  binding: IRemoteBinding<TUnit, TSpec>,
  signal: IAbortSignal,
  report: (error: unknown) => void
): () => void {
  return new RemoteGenerationObserver(holder, binding, signal, report).close
}
