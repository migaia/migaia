/** Optional flow capabilities retain their own complete behavior and installation resources. */
export { typegen } from './typegen/index.ts'
export type { ITypegenOptions, ITypegenOutput } from './typegen/index.ts'
export { schemaFeature } from '../features/schema/index.ts'
export type {
  IRpcSchemaOptions,
  IRpcSchemaParser,
  IRpcMethodValidators
} from '../features/schema/types.ts'
export { authFeature } from '../features/auth/index.ts'
export { errorMapFeature } from '../features/error-map/index.ts'
export type { IRpcErrorMap } from '../features/error-map/types.ts'
export type {
  IRpcAuthenticationOptions,
  IRpcAuthenticationTransform,
  IRpcAuthenticationCredentials
} from '../features/auth/types.ts'
export { chunkFeature } from '../features/chunk/index.ts'
export type { IRpcChunkFeatureOptions } from '../features/chunk/index.ts'
export { batchFeature } from '../features/batch/index.ts'
export { probe, defineProbe } from './probe/index.ts'
export type {
  IRpcProbe,
  IRpcProbeDefinition,
  IRpcProbeEventView,
  IRpcProbeDescriptor
} from './probe/index.ts'
export type { IRpcBatchOptions } from '../features/batch/types.ts'
export { limitsFeature } from '../features/limits/index.ts'
export type {
  IRpcLimitsOptions,
  IRpcLimitsOverflow,
  IRpcProviderRejection
} from '../features/limits/types.ts'
export { linkPolicy } from './link-policy/index.ts'
export type { IRpcLinkPolicyOptions } from './link-policy/index.ts'
export { idempotencyFeature, createRpcIdempotencyStore } from '../features/idempotency/index.ts'
export type {
  IRpcIdempotencyOptions,
  IRpcOutcomeLookup,
  IRpcIdempotencyClaim,
  IRpcIdempotencyLookup,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore,
  IRpcIdempotencyStoreOptions
} from '../features/idempotency/index.ts'
