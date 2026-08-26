import { createStoreLightRangeError, StoreLightErrorCode } from './errors.js'
import { StoreLightErrorText } from './error-text.js'

/** Maximum single delay accepted by Web/Node timers. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

export class ResourceCachePolicy {
  readonly #keepAliveMs: number
  /** Absolute eviction deadline retained so oversized delays can be segmented safely. */
  #evictionAt = 0
  #evictionTimer: ReturnType<typeof setTimeout> | undefined

  constructor(keepAliveMs: number) {
    if (!Number.isFinite(keepAliveMs) || keepAliveMs < 0)
      throw createStoreLightRangeError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.keepAlive
      )
    this.#keepAliveMs = keepAliveMs
  }

  scheduleEviction(evict: () => void): void {
    this.cancelEviction()
    this.#evictionAt = Date.now() + this.#keepAliveMs
    const arm = (): void => {
      const remaining = this.#evictionAt - Date.now()
      if (remaining <= 0) {
        this.#evictionTimer = undefined
        evict()
        return
      }
      this.#evictionTimer = setTimeout(arm, Math.min(MAX_TIMER_DELAY_MS, remaining))
    }
    arm()
  }

  cancelEviction(): void {
    if (this.#evictionTimer === undefined) return
    clearTimeout(this.#evictionTimer)
    this.#evictionTimer = undefined
    this.#evictionAt = 0
  }

  dispose(): void {
    this.cancelEviction()
  }
}
