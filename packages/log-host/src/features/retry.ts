import { defineNativeLogFeature, type IRetryFeatureOptions } from '../feature-metadata.ts'
import { LogDeliveryPolicy, FeaturePhase } from '../state-constants.ts'
import { createLogError, invalidOption } from '../errors.ts'
import { LogHostErrorCode } from '../error-code.ts'
import { LogHostErrorText } from '../error-text.ts'
import type { ILogFeature } from '../typing.ts'

/** Total attempt count and delay policy are admitted once before output installation. */
export function retryFeature(options: IRetryFeatureOptions): ILogFeature {
  /** Total attempts are explicit, matching the canonical retry owner's required maxAttempts. */
  const attempts = options.attempts
  if (!Number.isSafeInteger(attempts) || attempts < 1)
    throw createLogError(LogHostErrorCode.invalidRetryCount, LogHostErrorText.invalidRetryCount)
  /** Numeric delays are validated locally; function results remain utils-owned runtime admission. */
  const backoff = options.backoff ?? 0
  if (typeof backoff !== 'function' && (!Number.isFinite(backoff) || backoff < 0))
    throw invalidOption()
  return defineNativeLogFeature(
    { policy: LogDeliveryPolicy.retry, phase: FeaturePhase.delivery },
    () => ({
      implementation: Object.freeze({
        policy: LogDeliveryPolicy.retry,
        phase: FeaturePhase.delivery,
        options: Object.freeze({ attempts, backoff })
      }),
      controls: Object.freeze({})
    })
  )
}
export default retryFeature
