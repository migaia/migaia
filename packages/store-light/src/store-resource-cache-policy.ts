import { systemScheduler, type IScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { createStoreLightRangeError, StoreLightErrorCode } from './errors.js'
import { StoreLightErrorText } from './error-text.js'

/** Owns a cache expiry task; the canonical scheduler owns host timers and long-delay segmentation. */
export class ResourceCachePolicy {
  /** Cache duration admitted before any timer or value is owned. */
  readonly #keepAliveMs: number
  /** The resource factory already admitted and captured these scheduler methods. */
  readonly #scheduler: IScheduler
  /** One cancelable expiry, cleared before user eviction can reenter this policy. */
  #evictionTimer: IScheduledTask | undefined

  /** Accepts one finite TTL and the resource factory's admitted timer owner. */
  constructor(keepAliveMs: number, scheduler: IScheduler = systemScheduler) {
    if (!Number.isFinite(keepAliveMs) || keepAliveMs < 0)
      throw createStoreLightRangeError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.keepAlive
      )
    this.#keepAliveMs = keepAliveMs
    this.#scheduler = scheduler
  }

  /** Replaces the previous expiry while retaining the existing synchronous zero-TTL boundary. */
  scheduleEviction(evict: () => void): void {
    this.cancelEviction()
    if (this.#keepAliveMs === 0) {
      evict()
      return
    }
    this.#evictionTimer = this.#scheduler.schedule(() => {
      this.#evictionTimer = undefined
      evict()
    }, this.#keepAliveMs)
  }

  /** Cancels only this resource's pending cache expiry. */
  cancelEviction(): void {
    this.#evictionTimer?.cancel()
    this.#evictionTimer = undefined
  }

  /** Ends cache housekeeping without owning the cached value's disposal. */
  dispose(): void {
    this.cancelEviction()
  }
}
