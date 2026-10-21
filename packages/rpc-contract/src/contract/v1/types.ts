import type { IRpcPortableValue, IRpcSerializedError } from '../types.js'
import type { IRpcControlData, IRpcEnvelopeData } from './route.js'

/** Concrete V1 request envelope owned by the V1 semantic module. */
export type IRpcRequestEnvelope = Readonly<{
  /** V1 request discriminator. */
  kind: 'request'
  /** Correlation id echoed by the response. */
  id: string
  /** Required application method name. */
  method: string
  /** Validated route plus optional portable input. */
  data: IRpcEnvelopeData
}>

/** Concrete V1 successful response envelope. */
export type IRpcResponseSuccess<TData extends IRpcEnvelopeData = IRpcEnvelopeData> = Readonly<{
  /** V1 response discriminator. */
  kind: 'response'
  /** Selects the success grammar; failure-only fields are forbidden. */
  ok: true
  /** Original request correlation id. */
  id: string
  /** Response route and optional returned business value. */
  data: TData
  /** Failure code is absent on success. */
  code?: never
  /** Failure message is absent on success. */
  message?: never
  /** Failure graph is absent on success. */
  error?: never
}>

/** Concrete V1 failed response envelope. */
export type IRpcResponseFailure<TData extends IRpcEnvelopeData = IRpcEnvelopeData> = Readonly<{
  /** V1 response discriminator. */
  kind: 'response'
  /** Selects the failure grammar. */
  ok: false
  /** Original request correlation id. */
  id: string
  /** Stable failure code, separate from the display message. */
  code: string
  /** Display message accompanying the failure. */
  message: string
  /** Response routing and optional portable diagnostic payload. */
  data: TData
  /** Optional complete bounded error graph; code/message remain required without it. */
  error?: IRpcSerializedError
}>

/** Concrete V1 discovery envelope. */
export type IRpcDiscoveryEnvelope = Readonly<{
  /** Application discovery discriminator. */
  kind: 'discovery'
  /** Discovery exchange correlation id. */
  id: string
  /** Sender application version, independent of the protocol version. */
  version: string
  /** Accepted application-version declarations. */
  acceptVersions: readonly string[]
  /** Discovery route and optional portable payload. */
  data: IRpcEnvelopeData
}>

/** Concrete V1 variation envelope. */
export type IRpcVariationEnvelope = Readonly<{
  /** Out-of-band control/variation discriminator. */
  kind: 'variation'
  /** Correlation id in the control exchange. */
  id: string
  /** Control-owned routing and opaque subtype payload. */
  data: IRpcControlData
}>

/** Stream frames share control-owned routing and carry a portable event payload. */
export type IRpcStreamEnvelope = Readonly<{
  /** Streaming envelope discriminator. */
  kind: 'stream'
  /** Stream exchange correlation id. */
  id: string
  /** Stream route and event payload, checked by the stream normalizer. */
  data: IRpcEnvelopeData
}>

/** Closed V1 semantic-envelope union. */
export type IRpcEnvelope =
  | IRpcRequestEnvelope
  | IRpcResponseSuccess
  | IRpcResponseFailure
  | IRpcDiscoveryEnvelope
  | IRpcVariationEnvelope
  | IRpcStreamEnvelope

/** Values allowed in an ordinary envelope payload after portable normalization. */
export type IRpcApplicationPayload = IRpcPortableValue
