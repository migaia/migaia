import { RpcCoreErrorText } from '../error-text.js'
import { VariationAdmissionRegistry } from './variation-admission.js'
import type { IRpcProviderController } from './plugin-shared-keys.js'

/** Private handler port for one verified variation subkind. */
export type IVariationHandler = (message: unknown, peerKey: string) => void | Promise<void>

/** Canonical variation route, replay, admission, and subkind dispatch owner. */
export class RpcVariationCoordinator {
  /** Shared replay/admission owner for all variation subkinds. */
  readonly #admission: VariationAdmissionRegistry
  /** Abort-before-request tombstones retained by the canonical variation owner. */
  readonly #pendingAborts = new Map<
    string,
    { readonly expiresAt: number; readonly reason: unknown; readonly association?: string }
  >()
  /** Single-provider typed variation handlers. */
  readonly #handlers = new Map<string, IVariationHandler>()

  /**
   * Canonical clock read; sourced from the endpoint-local time port, never the host wall-clock
   * directly.
   */
  readonly #now: () => number
  /**
   * Unobserved monotonic clock read for the admission window; preserves time-port observer events.
   * Named for admission so `timestamp` in rpc core only ever means the diagnostic wall clock.
   */
  readonly #admissionNow: () => number

  /** Creates one coordinator; feature handlers are registered before kernel activation. */
  constructor(
    now: () => number,
    admissionNow: () => number,
    admission?: VariationAdmissionRegistry
  ) {
    this.#now = now
    this.#admissionNow = admissionNow
    this.#admission = admission ?? new VariationAdmissionRegistry()
  }

  /** Reports whether a variation handler is currently admitted without changing ownership. */
  admit(key: string): boolean {
    return this.#handlers.has(key)
  }

  /** Registers one handler and rejects duplicate subkind ownership. */
  register(variation: string, handler: IVariationHandler): () => void {
    if (this.#handlers.has(variation))
      throw new TypeError(RpcCoreErrorText.variationHandlerDuplicate(variation))
    this.#handlers.set(variation, handler)
    return () => {
      if (this.#handlers.get(variation) === handler) this.#handlers.delete(variation)
    }
  }

  /** Admits and dispatches one variation after shared identity verification. */
  async dispatch(
    variation: string,
    key: string,
    message: unknown,
    peerKey: string
  ): Promise<'dispatched' | 'unknown' | 'rejected'> {
    const handler = this.#handlers.get(variation)
    if (!handler) return 'unknown'
    if (!this.#admission.admit(peerKey, key, this.#admissionNow())) return 'rejected'
    await handler(message, peerKey)
    return 'dispatched'
  }

  /** Aborts an active provider task or records a bounded early-abort tombstone. */
  abort(
    key: string,
    controller: Pick<IRpcProviderController, 'abort'> | undefined,
    expiresAt: number,
    reason: unknown,
    association?: string
  ): boolean {
    if (controller) {
      controller.abort(reason)
      return true
    }
    this.#purgeAborts()
    if (this.#pendingAborts.has(key))
      return this.#pendingAborts.get(key)!.association === association
    if (this.#pendingAborts.size >= 4096) return false
    this.#pendingAborts.set(
      key,
      Object.freeze({ expiresAt, reason, ...(association === undefined ? {} : { association }) })
    )
    return true
  }

  /** Consumes one early-abort tombstone when provider execution creates its controller. */
  consumeAbort(
    key: string,
    association?: string
  ): { readonly found: boolean; readonly reason: unknown } {
    this.#purgeAborts()
    const pending = this.#pendingAborts.get(key)
    if (!pending) return Object.freeze({ found: false, reason: undefined })
    this.#pendingAborts.delete(key)
    if (pending.association !== association)
      return Object.freeze({ found: false, reason: undefined })
    return Object.freeze({ found: true, reason: pending.reason })
  }

  /** Clears replay/admission and handler state during endpoint disposal. */
  clear(): void {
    this.#handlers.clear()
    this.#admission.clear()
    this.#pendingAborts.clear()
  }

  /** Removes expired early-abort tombstones without touching handler ownership. */
  #purgeAborts(): void {
    const now = this.#now()
    for (const [key, pending] of this.#pendingAborts)
      if (pending.expiresAt <= now) this.#pendingAborts.delete(key)
  }
}
