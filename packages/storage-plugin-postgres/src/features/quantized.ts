import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import {
  refineStorageVectorQuery,
  type IVectorQuery,
  type IVectorNativeQuery
} from '@migaia/storage-contract'
import { postgresBackendKind } from '../plugin.js'
import { PgQuantizedMode } from '../constants.js'
import { capture, invalidArgument } from '../errors.js'

/** The selected expression layout preserves the original full-precision vector column. */
export type IPgQuantizedOptions = {
  readonly mode: (typeof PgQuantizedMode)[keyof typeof PgQuantizedMode]
}
/** Native topN is resolved once against the original immutable topK bound. */
export type IPgQuantizedRescoreOptions = { readonly topN?: number }
/** Only an original bounded vector query can acquire this read-only native stage. */
export type IPgQuantizedQueryMethods = {
  rescore<P, G extends boolean, V extends boolean, M extends object>(
    this: IVectorQuery<P, G, V, M>,
    options?: IPgQuantizedRescoreOptions
  ): IVectorNativeQuery<P, G, V, M>
}
/** Select quantized recall and exact native rescoring without publishing another capability. */
export function pgQuantizedFeature(options: IPgQuantizedOptions) {
  /** Only captured finite modes reach native schema preparation or execution. */
  const mode = capture(() => {
    const { mode } = options
    if (mode !== PgQuantizedMode.halfvec && mode !== PgQuantizedMode.binary) throw invalidArgument()
    return mode
  })
  return defineFeature<
    typeof postgresBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      { readonly vector: IPgQuantizedQueryMethods },
      { readonly store: {}; readonly transaction: {} }
    >
  >(postgresBackendKind, ({ featureExpose }) => {
    featureExpose.selectQuantized(mode)
    /** The canonical refiner owns topology, safe bounds and the original source identity. */
    const methods: IPgQuantizedQueryMethods = {
      rescore(options) {
        const topN = capture(() => {
          if (options === undefined) return undefined
          if (options === null || typeof options !== 'object') throw invalidArgument()
          return options.topN
        })
        return refineStorageVectorQuery(this, (topK) => {
          const resolved = topN === undefined ? topK : topN
          return { native: Object.freeze({ mode, topN: resolved }), topN: resolved }
        })
      }
    }
    return {
      capabilities: [] as const,
      chain: { vector: methods },
      api: { store: {}, transaction: {} }
    }
  })
}
