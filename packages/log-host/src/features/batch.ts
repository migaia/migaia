import { defineNativeLogFeature, type IBatchOptions } from '../feature-metadata.ts'
import { LogDeliveryPolicy, FeaturePhase } from '../state-constants.ts'
import { invalidOption } from '../errors.ts'
import type { ILogFeature } from '../typing.ts'

/** Batch state belongs to each installed output controller rather than the cold native feature. */
export function batchFeature(options: IBatchOptions = {}): ILogFeature {
  /** Established capacity and timer defaults are normalized before installation. */
  const normalized = {
    maxSize: options.maxSize ?? 20,
    maxWaitMs: options.maxWaitMs ?? 2000,
    maxConcurrentBatches: options.maxConcurrentBatches ?? 1,
    maxPendingBatches: options.maxPendingBatches ?? 1024,
    drainTimeoutMs: options.drainTimeoutMs ?? 3000
  }
  for (const value of [
    normalized.maxSize,
    normalized.maxConcurrentBatches,
    normalized.maxPendingBatches
  ])
    if (!Number.isSafeInteger(value) || value < 1) throw invalidOption()
  for (const value of [normalized.maxWaitMs, normalized.drainTimeoutMs])
    if (!Number.isFinite(value) || value < 0) throw invalidOption()
  return defineNativeLogFeature(
    { policy: LogDeliveryPolicy.batch, phase: FeaturePhase.delivery },
    () => ({
      implementation: Object.freeze({
        policy: LogDeliveryPolicy.batch,
        phase: FeaturePhase.delivery,
        options: Object.freeze({ ...normalized })
      }),
      controls: Object.freeze({})
    })
  )
}
export default batchFeature
