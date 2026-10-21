import {
  deserializeRpcError,
  normalizeRpcSerializedError,
  serializeRpcError
} from '@migaia/rpc-contract/errors'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { RpcDevtoolsErrorText } from '../error-text.js'
import { identifyDevtoolsError } from '../errors.js'
import {
  RpcDevtoolsRecordFormat,
  RpcDevtoolsRecordField,
  RpcDevtoolsRecordBase64Alphabet as Base64Alphabet,
  type IRpcDevtoolsRecord,
  type IRpcDevtoolsRecordEvent,
  type IRpcDevtoolsRecordHeader
} from './record.js'

/** Convert captured bytes to the record's Base64 text without changing their backing. */
function encodeBytes(bytes: Uint8Array): string {
  /** The result belongs to this one offline conversion; collection never executes this loop. */
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    /** At most three input bytes form one canonical Base64 quartet. */
    const word = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    text += Base64Alphabet[(word >>> 18) & 63] + Base64Alphabet[(word >>> 12) & 63]
    text += i + 1 < bytes.length ? Base64Alphabet[(word >>> 6) & 63] : '='
    text += i + 2 < bytes.length ? Base64Alphabet[word & 63] : '='
  }
  return text
}

/** Decode only record v1's canonical padded spelling; malformed tags retain a native cause. */
function decodeBytes(text: unknown): Uint8Array {
  if (
    typeof text !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)
  )
    throw new TypeError(RpcDevtoolsErrorText.recordBytesInvalid)
  /** Padding determines the exact owned result size, including an empty byte payload. */
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  /** Decoding Base64 text requires a new byte representation owned by the imported record. */
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)
  for (let i = 0, offset = 0; i < text.length; i += 4) {
    /** The low unused bits of the final quartet must be zero for canonical encoding. */
    const second = Base64Alphabet.indexOf(text[i + 1])
    /** Padded positions contribute zero and never become output bytes. */
    const third = text[i + 2] === '=' ? 0 : Base64Alphabet.indexOf(text[i + 2])
    if (
      i + 4 === text.length &&
      ((padding === 2 && (second & 15) !== 0) || (padding === 1 && (third & 3) !== 0))
    )
      throw new TypeError(RpcDevtoolsErrorText.recordBytesInvalid)
    /** One quartet expands into at most three bytes. */
    const word =
      (Base64Alphabet.indexOf(text[i]) << 18) |
      (second << 12) |
      (third << 6) |
      (text[i + 3] === '=' ? 0 : Base64Alphabet.indexOf(text[i + 3]))
    bytes[offset++] = (word >>> 16) & 255
    if (offset < bytes.length) bytes[offset++] = (word >>> 8) & 255
    if (offset < bytes.length) bytes[offset++] = word & 255
  }
  return bytes
}

/** Both encoder and decoder require the same frozen header identity before processing events. */
function assertHeader(value: unknown): asserts value is IRpcDevtoolsRecordHeader {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('format' in value) ||
    value.format !== RpcDevtoolsRecordFormat.format ||
    !('version' in value) ||
    value.version !== RpcDevtoolsRecordFormat.version
  )
    throw new TypeError(RpcDevtoolsErrorText.recordHeaderInvalid)
}

/** Event lines must retain the required fields used by query and offline timeline consumers. */
function assertEvent(value: unknown): asserts value is IRpcDevtoolsRecordEvent {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('seq' in value) ||
    typeof value.seq !== 'number' ||
    !Number.isFinite(value.seq) ||
    !('at' in value) ||
    typeof value.at !== 'number' ||
    !Number.isFinite(value.at) ||
    !('endpointId' in value) ||
    typeof value.endpointId !== 'string' ||
    !('stage' in value) ||
    typeof value.stage !== 'string' ||
    !('direction' in value) ||
    typeof value.direction !== 'string'
  )
    throw new TypeError(RpcDevtoolsErrorText.recordEventInvalid)
}

/** Byte-tag objects provide the record representation; other values keep their references. */
function replaceBytes(this: object, key: string, value: unknown): unknown {
  /** Retain the original data-slot reference before a byte subtype's toJSON hides its brand. */
  const original: unknown = Object.getOwnPropertyDescriptor(this, key)?.value ?? value
  if (original instanceof Uint8Array)
    return { [RpcDevtoolsRecordField.bytes]: encodeBytes(original) }
  /** This byte view changes representation only and shares the original ArrayBuffer. */
  if (original instanceof ArrayBuffer)
    return { [RpcDevtoolsRecordField.bytes]: encodeBytes(new Uint8Array(original)) }
  return value
}

/** A sole $bytes key is reserved v1 byte syntax; all other JSON object shapes remain ordinary. */
function reviveBytes(_key: string, value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    RpcDevtoolsRecordField.bytes in value &&
    Object.keys(value).length === 1
  )
    return decodeBytes(value[RpcDevtoolsRecordField.bytes])
  return value
}

/**
 * Wrap format failures once; the original JSON, header, byte or error-chain failure stays
 * reachable.
 */
function invalidRecord(cause: unknown): never {
  throw identifyDevtoolsError(
    new TypeError(RpcDevtoolsErrorText.recordFormatInvalid, { cause }),
    RpcDevtoolsErrorCode.recordFormatInvalid
  )
}

/**
 * Encode an ordered offline record as UTF-8-compatible NDJSON text. Errors delegate to Contract; a
 * failure throws RECORD_FORMAT_INVALID with its cause. Uint8Array/ArrayBuffer use reserved $bytes
 * Base64 syntax at any depth; other content follows JSON rather than arbitrary lossless-object
 * semantics. Text has a trailing newline and is not persisted. Input error stacks are not changed.
 */
export function encodeRpcDevtoolsRecord(record: IRpcDevtoolsRecord): string {
  try {
    assertHeader(record.header)
    /** Encode the header as NDJSON text; no retained input object is copied. */
    const lines = [JSON.stringify(record.header)]
    for (const event of record.events) {
      assertEvent(event)
      /**
       * The encode wrapper substitutes the serialized error graph required by NDJSON; every other
       * event field retains its reference, including content and detail.
       */
      const wire =
        event.error === undefined
          ? event
          : {
              ...event,
              error:
                event.error instanceof Error
                  ? serializeRpcError(event.error, {
                      /**
                       * Pure codec calls have no reporter sink, so loss becomes a visible format
                       * failure.
                       */
                      report: (failure) => {
                        throw failure.error
                      }
                    })
                  : normalizeRpcSerializedError(event.error)
            }
      lines.push(JSON.stringify(wire, replaceBytes))
    }
    return `${lines.join('\n')}\n`
  } catch (cause) {
    invalidRecord(cause)
  }
}

/**
 * Decode the frozen v1 header, byte tags and native error graph without regenerating any stack.
 * Preserve file order without sorting/alignment. A final newline is optional; interior blank lines,
 * unsupported headers and malformed byte/error data throw RECORD_FORMAT_INVALID with the original
 * cause. Decoding returns data without registering or opening a target.
 */
export function decodeRpcDevtoolsRecord(text: string): IRpcDevtoolsRecord {
  try {
    /**
     * The encoder's terminal newline is optional on import; interior empty lines remain invalid
     * JSON.
     */
    const lines = text.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    /** Record text becomes a new header representation; byte revival applies only to events. */
    const header: unknown = JSON.parse(lines[0])
    assertHeader(header)
    /** Retained event order is file order; importing never sorts or aligns the timestamps. */
    const events: IRpcDevtoolsRecordEvent[] = []
    for (let i = 1; i < lines.length; i++) {
      /** Each NDJSON line becomes its required event/byte representation once. */
      const event: unknown = JSON.parse(lines[i], reviveBytes)
      assertEvent(event)
      /** The decode wrapper replaces wire error with native error and retains other fields. */
      events.push(
        event.error === undefined ? event : { ...event, error: deserializeRpcError(event.error) }
      )
    }
    return { header, events }
  } catch (cause) {
    invalidRecord(cause)
  }
}
