import type { IWebRpcVariation } from '../protocol-constants.js'
import { VariationAdmissionRegistry } from './variation-admission.js'

/** Private handler port for one verified variation subkind. */
export type IVariationHandler = (message: unknown, peerKey: string) => void | Promise<void>

/** Canonical variation route, replay, admission, and subkind dispatch owner. */
export class WebRpcVariationCoordinator {
  /** Shared replay/admission owner for all variation subkinds. */
  readonly #admission: VariationAdmissionRegistry
  /** Abort-before-request tombstones retained by the canonical variation owner. */
  readonly #pendingAborts = new Map<string, number>()
  /** Single-provider typed variation handlers. */
  readonly #handlers = new Map<IWebRpcVariation, IVariationHandler>()

  /**
   * Canonical clock read; sourced from the endpoint-local time port, never the host wall-clock
   * directly.
   */
  readonly #now: () => number

  /** Creates one coordinator; feature handlers are registered before kernel activation. */
  constructor(now: () => number, admission?: VariationAdmissionRegistry) {
    this.#now = now
    this.#admission = admission ?? new VariationAdmissionRegistry()
  }

  /** Reports whether a variation handler is currently admitted without changing ownership. */
  admit(key: string): boolean {
    return this.#handlers.has(key as IWebRpcVariation)
  }

  /** Registers one handler and rejects duplicate subkind ownership. */
  register(variation: IWebRpcVariation, handler: IVariationHandler): () => void {
    if (this.#handlers.has(variation))
      throw new TypeError(`variation handler already registered: ${variation}`)
    this.#handlers.set(variation, handler)
    return () => {
      if (this.#handlers.get(variation) === handler) this.#handlers.delete(variation)
    }
  }

  /** Admits and dispatches one variation after shared identity verification. */
  async dispatch(
    variation: IWebRpcVariation,
    key: string,
    message: unknown,
    peerKey: string
  ): Promise<boolean> {
    const handler = this.#handlers.get(variation)
    if (!handler || !this.#admission.admit(peerKey, key)) return false
    await handler(message, peerKey)
    return true
  }

  /** Aborts an active provider task or records a bounded early-abort tombstone. */
  abort(key: string, controller: AbortController | undefined, expiresAt: number): boolean {
    if (controller) {
      controller.abort()
      return true
    }
    this.#purgeAborts()
    if (this.#pendingAborts.has(key)) return true
    if (this.#pendingAborts.size >= 4096) return false
    this.#pendingAborts.set(key, expiresAt)
    return true
  }

  /** Consumes one early-abort tombstone when provider execution creates its controller. */
  consumeAbort(key: string): boolean {
    this.#purgeAborts()
    if (!this.#pendingAborts.has(key)) return false
    this.#pendingAborts.delete(key)
    return true
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
    for (const [key, expiresAt] of this.#pendingAborts)
      if (expiresAt <= now) this.#pendingAborts.delete(key)
  }
}
