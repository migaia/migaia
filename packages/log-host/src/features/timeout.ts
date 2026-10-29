import { defineNativeLogFeature } from '../feature-metadata.ts'
import { LogDeliveryPolicy, FeaturePhase } from '../state-constants.ts'
import { invalidOption } from '../errors.ts'
import type { ILogFeature } from '../typing.ts'

/** A per-attempt timeout delegates scheduling, cancellation and late rejection to utils. */
export function timeoutFeature(options: { ms: number }): ILogFeature {
  /** Capture caller-owned options before the native definition can be installed later. */
  const ms = options.ms
  if (!Number.isFinite(ms) || ms < 0) throw invalidOption()
  return defineNativeLogFeature(
    { policy: LogDeliveryPolicy.timeout, phase: FeaturePhase.delivery },
    () => ({
      implementation: Object.freeze({
        policy: LogDeliveryPolicy.timeout,
        phase: FeaturePhase.delivery,
        ms
      }),
      controls: Object.freeze({})
    })
  )
}
export default timeoutFeature
