import { webByteStream } from './adapter-owned/process/web-byte-stream.js'

/**
 * Construct the original owned reader/writer scope from actual held Web Streams. The execution
 * owner remains outside this byte channel; there is no native-replay assertion or registrar input.
 */
export function createAdapterWebByteIO(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>
) {
  return webByteStream(readable, writable, () => undefined)
}
