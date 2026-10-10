/** Encoding globals exist in every supported RPC runtime and do not require a DOM or Node API. */
declare class TextEncoder {
  /** Encode actual protocol text using the runtime's standard UTF-8 implementation. */
  encode(value?: string): Uint8Array
  /** Write one accepted header into the already allocated physical frame. */
  encodeInto(value: string, destination: Uint8Array): { read: number; written: number }
}

/** The neutral proof models only the standard encoding operations used by protocol framing. */
declare class TextDecoder {
  /** Fatal decoding preserves the original protocol rejection for malformed bytes. */
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean })
  /** Decode actual held frame bytes with no host-specific stream or DOM dependency. */
  decode(value?: ArrayBuffer | ArrayBufferView): string
}
