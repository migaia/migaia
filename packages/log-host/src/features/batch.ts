import { issueFeature, type IBatchOptions } from '../feature-registry.ts'
import { FeatureKind, FeaturePhase } from '../state-constants.ts'
import { invalidOption } from '../errors.ts'
import type { ILogFeature } from '../typing.ts'

/** Batch state belongs to each installed output controller rather than this reusable descriptor. */
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
  return issueFeature(
    { kind: FeatureKind.batch, phase: FeaturePhase.delivery },
    { kind: FeatureKind.batch, phase: FeaturePhase.delivery, options: Object.freeze(normalized) }
  )
}
export default batchFeature
