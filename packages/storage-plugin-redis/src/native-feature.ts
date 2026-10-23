import type { IOperationContext, IStorageResource } from '@migaia/storage-contract'
import type { IRedisConnection, IRedisDriver } from './driver.js'
import type { createRedisLayout } from './layout.js'
import type { IRedisStore } from './types.js'
/** Only the exact installed store lends native Features its original pipeline and resource owner. */
export const nativeFeaturePort = Symbol('redis-native-feature')
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
    ) => Promise<R>
  ): Promise<R>
  resource<I>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    run: (input: I, layout: ReturnType<typeof createRedisLayout>) => Promise<IStorageResource>
  ): Promise<IStorageResource>
  readonly driver: IRedisDriver
  own(resource: IStorageResource): void
  report(error: unknown): void
}
/** No second provider map or lifecycle is introduced. */
export function readNativeFeaturePort(store: IRedisStore): IRedisNativeFeaturePort {
  return (store as IRedisStore & { readonly [nativeFeaturePort]: IRedisNativeFeaturePort })[
    nativeFeaturePort
  ]
}
