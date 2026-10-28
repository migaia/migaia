/** Stable diagnostics shared by registry, chunk validation and stream boundaries. */
import { SerializeErrorText } from './errors.ts'

/** Internal diagnostics extend the existing error text owner without changing its public keys. */
export const SerializeDiagnosticText = {
  /** Public codec errors retain this native Error.name across registry and stream failures. */
  codecErrorName: 'SerializeCodecError',
  /** Iterable admission rejects a present non-callable asynchronous protocol. */
  asyncIteratorFunction: 'serialize async iterator must be a function',
  /** Iterable admission rejects a present non-callable synchronous protocol. */
  iteratorFunction: 'serialize iterator must be a function',
  /** An asynchronous factory must acquire an object iterator before draining. */
  asyncIteratorObject: 'serialize async iterator must return an object',
  /** An asynchronous iterator captures one callable next method. */
  asyncIteratorNext: 'serialize async iterator.next must be a function',
  /** A synchronous factory must acquire an object iterator before draining. */
  iteratorObject: 'serialize iterator must return an object',
  /** A synchronous iterator captures one callable next method. */
  iteratorNext: 'serialize iterator.next must be a function',
  /** A registry needs both structural encoding capabilities before owning parsers. */
  encodingUnavailable: 'TextEncoder/TextDecoder is unavailable',
  /** A registry requires a primary plugin, fixed by registration order. */
  pluginsEmpty: 'serialize registry needs at least one plugin',
  /** Closed registry admission never revives released parsers. */
  registryDisposed: 'serialize registry is disposed',
  /** A value chunk is a complete result and cannot join neighboring chunks. */
  valueCombined: 'a value chunk cannot be combined with other chunks',
  /** A parser must produce at least one chunk. */
  noChunks: 'serialize produced no chunks',
  /** Decode cancellation retains its historically distinct diagnostic. */
  deserializeAborted: 'deserialize aborted',
  /** Disposal snapshots the first deadline before closing admission. */
  deadlineRead: 'serialize dispose deadlineAt could not be read',
  /** Only finite absolute deadlines enter registry disposal. */
  deadlineFinite: 'serialize dispose deadlineAt must be a finite number',
  /** Chunk validation requires the exact tuple shape before reading its payload. */
  chunkPair: 'serialize chunk must be a [type, data] pair',
  /** Text payloads must already be strings; validators never coerce caller data. */
  chunkText: 'text chunk data must be a string',
  /** Byte payloads must expose the native byte-array brand. */
  chunkBytes: 'bytes chunk data must be a Uint8Array',
  /** Unknown tags cannot enter collection as an accidental iterable. */
  chunkUnknown: 'unknown serialize chunk type',
  /** Hostile tuple access retains its original cause behind the chunk boundary. */
  chunkValidation: 'serialize chunk validation failed',
  /** Plugin type admission identifies its original list position. */
  pluginType: (index: number): string =>
    `serialize plugin at index ${index} must provide a string type`,
  /** Plugin parser admission retains the original routing token in its diagnostic. */
  pluginParser: (type: string): string => `serialize plugin "${type}" must provide a parser object`,
  /** Parser methods are captured once before any parser ownership is acquired. */
  parserMethods: (type: string): string =>
    `serialize parser "${type}" must provide encode/decode functions`,
  /** Optional disposal must be callable before parser ownership is acquired. */
  parserDispose: (type: string): string => `serialize parser "${type}" dispose must be a function`,
  /** Plugin property failures retain the index without reflecting rejected data. */
  pluginInvalid: (index: number): string => `invalid serialize plugin at index ${index}`,
  /** Duplicate routing tokens reject before acquiring any parser. */
  pluginDuplicate: (type: string): string => `duplicate serialize plugin type: ${type}`,
  /** Lookup failure reports the requested format without changing the routing contract. */
  pluginMissing: (type: string): string => `no serialize plugin registered for type: ${type}`,
  /** Iterator failures include the current chunk and safe original diagnostic. */
  streamFailed: (index: number, reason: string): string =>
    `serialize stream failed at chunk ${index}: ${reason}`,
  /** Synchronous parser failure and rejected parser output share their established text. */
  stepFailed: (reason: string): string => `serialize step failed: ${reason}`,
  /** Decode failure retains safe original text and the exact original cause. */
  deserializeFailed: (reason: string): string => `deserialize failed: ${reason}`,
  /** Stream encode diagnostics locate the admitted slice. */
  streamEncodeFailed: (index: number, reason: string): string =>
    `encode stream failed at slice ${index}: ${reason}`,
  /** Stream decode diagnostics locate the admitted input chunk. */
  streamDecodeFailed: (index: number, reason: string): string =>
    `decode stream failed at chunk ${index}: ${reason}`,
  /** Stream collector diagnostics locate the current chunk before final assembly. */
  streamCollectFailed: (index: number, reason: string): string =>
    `collect stream failed at chunk ${index}: ${reason}`,
  /** Frame timing admits only finite positive budgets. */
  frameBudgetPositive: (name: string, value: unknown): string =>
    `frame budget ${name} must be a finite positive number, got ${value}`,
  /** Frame counts admit only positive safe integer sizes. */
  frameBudgetCount: (name: string, value: unknown): string =>
    `frame budget ${name} must be a positive integer, got ${value}`,
  /** Frame bounds cannot request a maximum below their minimum. */
  frameBudgetBounds: 'frame budget maxItems must be at least minItems',
  /** Stream backpressure requires a positive safe integer concurrency. */
  streamInFlight: (value: unknown): string =>
    `maxInFlight must be a positive integer, got ${value}`,
  /** Public routing token validation retains the original regular expression spelling. */
  invalidType: (type: string, pattern: RegExp): string =>
    `invalid serialize plugin type: ${JSON.stringify(type)}; expected ${String(pattern)}`,
  /** Text encoder failures retain collection position without changing their primary cause. */
  textEncodeAt: (index: number): string =>
    `${SerializeErrorText.textEncodeFailed} at chunk ${index}`,
  /** Invalid text encoder output retains its collection position. */
  textEncoderOutputAt: (index: number): string =>
    `${SerializeErrorText.textEncoderOutputInvalid} at chunk ${index}`
} as const
