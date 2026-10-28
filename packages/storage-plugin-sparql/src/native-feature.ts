import type { IOperationContext } from '@migaia/storage-contract'
import type { ISparqlEndpoint, ISparqlAbortSignal, IRdfGraphTarget } from './endpoint.ts'
import type { ISparqlStore } from './types.ts'
/** The installed native store lends only its existing operation/organization boundary to Features. */
export const nativeFeaturePort = Symbol('sparql-native-feature')
export type ISparqlNativeFeaturePort = {
  run<T>(
    operation: string,
    ctx: IOperationContext | undefined,
    write: boolean,
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
    invoke: (
      endpoint: ISparqlEndpoint,
      signal: ISparqlAbortSignal | undefined,
      map: (target: IRdfGraphTarget) => IRdfGraphTarget
    ) => Promise<T>
  ): Promise<T>
}
/**
 * Exact original store identity contains this finite author callback; no new provider registry
 * exists.
 */
export function readNativeFeaturePort(store: ISparqlStore): ISparqlNativeFeaturePort {
  return (store as ISparqlStore & { readonly [nativeFeaturePort]: ISparqlNativeFeaturePort })[
    nativeFeaturePort
  ]
}
