import type { IRpcPortableValue, IRpcSerializedError } from '../types.js'
import type { IRpcControlData, IRpcEnvelopeData } from './route.js'

/** Concrete V1 request envelope owned by the V1 semantic module. */
export type IRpcRequestEnvelope = Readonly<{
  kind: 'request'
  id: string
  method: string
  data: IRpcEnvelopeData
}>

/** Concrete V1 successful response envelope. */
export type IRpcResponseSuccess<TData extends IRpcEnvelopeData = IRpcEnvelopeData> = Readonly<{
  kind: 'response'
  ok: true
  id: string
  data: TData
  code?: never
  message?: never
  error?: never
}>

/** Concrete V1 failed response envelope. */
export type IRpcResponseFailure<TData extends IRpcEnvelopeData = IRpcEnvelopeData> = Readonly<{
  kind: 'response'
  ok: false
  id: string
  code: string
  message: string
  data: TData
  error?: IRpcSerializedError
}>

/** Concrete V1 discovery envelope. */
export type IRpcDiscoveryEnvelope = Readonly<{
  kind: 'discovery'
  id: string
  version: string
  acceptVersions: readonly string[]
  data: IRpcEnvelopeData
}>

/** Concrete V1 variation envelope. */
export type IRpcVariationEnvelope = Readonly<{
  kind: 'variation'
  id: string
  data: IRpcControlData
}>

/** Closed V1 semantic-envelope union. */
export type IRpcEnvelope =
  | IRpcRequestEnvelope
  | IRpcResponseSuccess
  | IRpcResponseFailure
  | IRpcDiscoveryEnvelope
  | IRpcVariationEnvelope

/** Values allowed in an ordinary envelope payload after portable normalization. */
export type IRpcApplicationPayload = IRpcPortableValue
