import type { IRpcPortableRecord, IRpcPortableValue, IRpcSerializedError } from '../types.js'

/** Concrete V1 request envelope owned by the V1 semantic module. */
export type IRpcRequestEnvelope = IRpcPortableRecord &
  Readonly<{ kind: 'request'; id: string; method: string; data: IRpcPortableValue }>

/** Concrete V1 successful response envelope. */
export type IRpcResponseSuccess<TData extends IRpcPortableValue = IRpcPortableValue> =
  IRpcPortableRecord &
    Readonly<{
      kind: 'response'
      ok: true
      id: string
      data: TData
      code?: never
      message?: never
      error?: never
    }>

/** Concrete V1 failed response envelope. */
export type IRpcResponseFailure<TData extends IRpcPortableValue = never> = IRpcPortableRecord &
  Readonly<{
    kind: 'response'
    ok: false
    id: string
    code: string
    message: string
    data?: TData
    error?: IRpcSerializedError
  }>

/** Concrete V1 discovery envelope. */
export type IRpcDiscoveryEnvelope = IRpcPortableRecord &
  Readonly<{
    kind: 'discovery'
    id: string
    version: string
    acceptVersions: readonly string[]
    data?: IRpcPortableValue
  }>

/** Concrete V1 variation envelope. */
export type IRpcVariationEnvelope = IRpcPortableRecord &
  Readonly<{ kind: 'variation'; id: string; data: IRpcPortableValue }>

/** Closed V1 semantic-envelope union. */
export type IRpcEnvelope =
  | IRpcRequestEnvelope
  | IRpcResponseSuccess
  | IRpcResponseFailure<IRpcPortableValue>
  | IRpcDiscoveryEnvelope
  | IRpcVariationEnvelope
