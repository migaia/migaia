import { issueFeature } from '../feature-registry.ts'
import { FeatureKind, FeaturePhase } from '../state-constants.ts'
import { invalidOption } from '../errors.ts'
import type { ILogFeature } from '../typing.ts'

/** A per-attempt timeout delegates scheduling, cancellation and late rejection to utils. */
export function timeoutFeature(options: { ms: number }): ILogFeature {
  if (!Number.isFinite(options.ms) || options.ms < 0) throw invalidOption()
  return issueFeature(
    { kind: FeatureKind.timeout, phase: FeaturePhase.delivery },
    { kind: FeatureKind.timeout, phase: FeaturePhase.delivery, ms: options.ms }
  )
}
export default timeoutFeature
