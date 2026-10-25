import type {
  IOperationContext,
  IStorageResource,
  IDurableChangeFeedApi,
  IVectorApi,
  ITtlTarget,
  ILockKey,
  IConcurrencyPolicy,
  IStorageIterator,
  IStorageChange
} from '@migaia/storage-contract'
import type { RedisDraft } from './transaction.js'
import type { IRedisConnection, IRedisDriver } from './driver.js'
import type { createRedisLayout } from './layout.js'
import type { IRedisStore } from './types.js'
/** Only the exact installed store lends native Features its original pipeline and resource owner. */
export const nativeFeaturePort = Symbol('redis-native-feature')
/** Only the selected vector module supplies these finite original-draft operations. */
export type IRedisVectorBinding = {
  readonly api: IVectorApi<false, true>
  expire(
    draft: RedisDraft,
    target: Extract<ITtlTarget, { channel: 'vector' }>,
    ms?: number
  ): Promise<boolean>
  remaining(
    draft: RedisDraft,
    target: Extract<ITtlTarget, { channel: 'vector' }>
  ): Promise<number | undefined>
  remainingRoot(
    target: Extract<ITtlTarget, { channel: 'vector' }>,
    ctx?: IOperationContext
  ): Promise<number | undefined>
}
/**
 * Finite native endpoints remain outside interactive WATCH drafts and never acquire close
 * authority.
 */
export type IRedisNativeFeaturePort = {
  run<I, R>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    write: boolean,
    run: (
      input: I,
      connection: IRedisConnection,
      layout: ReturnType<typeof createRedisLayout>,
      signal: AbortSignal | undefined
    ) => Promise<R>,
    pipeline?: boolean
  ): Promise<R>
  /** The selected factory configures only existing provider projections. */
  enableVector(create: (store: IRedisStore) => IRedisVectorBinding): void
  readonly layout: ReturnType<typeof createRedisLayout>
  assertLive(): void
  /** A selected client rerank borrows this same controller's existing accepted-work lease. */
  beginOperation(): () => void
  own(resource: IStorageResource): () => void
  chain(): Record<never, never> | undefined
  watch(ctx?: IOperationContext): IStorageIterator<IStorageChange>
  mutate<I, P, R>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    capture: (input: I) => P,
    keys: (input: P) => readonly ILockKey[],
    run: (draft: RedisDraft, input: P) => Promise<R>,
    policy?: IConcurrencyPolicy
  ): Promise<R>
  enableDurable(maxLen: number, create: (store: IRedisStore) => IDurableChangeFeedApi): void
  resource<I>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    run: (
      input: I,
      layout: ReturnType<typeof createRedisLayout>,
      signal: AbortSignal | undefined
    ) => Promise<IStorageResource>,
    pipeline?: boolean
  ): Promise<IStorageResource>
  now(): number
  readonly closingSignal: AbortSignal
  readonly allOrganizations: boolean
  readonly driver: IRedisDriver
  report(error: unknown): void
}
/** No second provider map or lifecycle is introduced. */
export function readNativeFeaturePort(store: IRedisStore): IRedisNativeFeaturePort {
  return (store as IRedisStore & { readonly [nativeFeaturePort]: IRedisNativeFeaturePort })[
    nativeFeaturePort
  ]
}
