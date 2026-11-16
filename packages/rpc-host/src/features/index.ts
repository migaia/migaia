/** Publishes every Feature factory: the two call policies and the seven flow capabilities. */
export { retryFeature, type IRetryFeatureOptions } from './retry.ts'
export { timeoutFeature, type ITimeoutFeatureOptions } from './timeout.ts'
export { schemaFeature } from './schema/index.ts'
export type { IRpcSchemaOptions, IRpcSchemaParser, IRpcMethodValidators } from './schema/types.ts'
export { authFeature } from './auth/index.ts'
export type {
  IRpcAuthenticationOptions,
  IRpcAuthenticationTransform,
  IRpcAuthenticationCredentials
} from './auth/types.ts'
export { errorMapFeature } from './error-map/index.ts'
export type { IRpcErrorMap } from './error-map/types.ts'
export { chunkFeature } from './chunk/index.ts'
export type { IRpcChunkFeatureOptions } from './chunk/index.ts'
export { batchFeature } from './batch/index.ts'
export type { IRpcBatchOptions } from './batch/types.ts'
export { limitsFeature } from './limits/index.ts'
export type {
  IRpcLimitsOptions,
  IRpcLimitsOverflow,
  IRpcProviderRejection
} from './limits/types.ts'
export { idempotencyFeature, createRpcIdempotencyStore } from './idempotency/index.ts'
export type {
  IRpcIdempotencyOptions,
  IRpcOutcomeLookup,
  IRpcIdempotencyClaim,
  IRpcIdempotencyLookup,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore,
  IRpcIdempotencyStoreOptions
} from './idempotency/index.ts'
