/** Defines the offline record header, byte-tag vocabulary and recording types shared by the codec. */
import type { IRpcDevtoolsWireEvent, IRpcWireError } from './wire.ts'

/** Header identity freezes the v1 NDJSON grammar for collectors and offline hub imports. */
export const RpcDevtoolsRecordFormat = Object.freeze({
  /** Exact first-line NDJSON discriminator. */
  format: 'migaia-rpc-devtools',
  /** Supported grammar version; other versions are not migrated. */
  version: 1
} as const)

/** A sole $bytes key is reserved v1 byte syntax at any event depth, not an ordinary JSON object. */
export const RpcDevtoolsRecordField = { bytes: '$bytes' } as const

/** Private padded RFC 4648 alphabet keeps v1 byte conversion portable and owned by this format. */
export const RpcDevtoolsRecordBase64Alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** No clock/descriptor metadata is invented; the current contract defines only the format identity. */
export type IRpcDevtoolsRecordHeader = Readonly<typeof RpcDevtoolsRecordFormat>

/** Record inputs accept service wire errors and native errors; decoding restores native errors. */
export type IRpcDevtoolsRecordEvent = Readonly<
  Omit<IRpcDevtoolsWireEvent, 'error'> & { error?: Error | IRpcWireError }
>

/** An offline recording retains order and uses native errors/bytes before and after codec calls. */
export type IRpcDevtoolsRecord = Readonly<{
  /** Format identity only, without clock-alignment or descriptor metadata. */
  header: IRpcDevtoolsRecordHeader
  /** File-order events; codec conversion restores native errors and reserved byte tags. */
  events: readonly IRpcDevtoolsRecordEvent[]
}>
