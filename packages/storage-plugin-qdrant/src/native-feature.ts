import type { IOperationContext, IWhere } from '@migaia/storage-contract'
import type {
  IQdrantHttp,
  IQdrantOperationName,
  IQdrantStore,
  IQdrantUpdateResult
} from './types.js'
import type { IQdrantRescorePoint, IQdrantRescoreResult } from './feature-types.js'
/** Only the exact installed store lends this finite original execution port to its Features. */
export const nativeFeaturePort = Symbol('qdrant-native-feature')
export type IQdrantNativeFeaturePort = {
  updateRescoreVectors(
    collection: string,
    points: readonly IQdrantRescorePoint[],
    ctx?: IOperationContext
  ): Promise<IQdrantRescoreResult>
  run<K extends IQdrantOperationName>(
    operation: K,
    args: readonly unknown[],
    ctx: IOperationContext | undefined,
    write: boolean,
    validate?: (info: Awaited<ReturnType<IQdrantHttp['getCollection']>>) => void
  ): Promise<Awaited<ReturnType<IQdrantHttp[K]>>>
  managedDelete<TPayload>(
    collection: string,
    where: IWhere<TPayload> | undefined,
    options:
      | { readonly wait?: boolean; readonly ordering?: 'weak' | 'medium' | 'strong' }
      | undefined,
    ctx: IOperationContext | undefined,
    purge: boolean
  ): Promise<IQdrantUpdateResult>
}
/** No separate provider table or native client handle is introduced. */
export function readNativeFeaturePort(store: IQdrantStore): IQdrantNativeFeaturePort {
  return (store as IQdrantStore & { readonly [nativeFeaturePort]: IQdrantNativeFeaturePort })[
    nativeFeaturePort
  ]
}
