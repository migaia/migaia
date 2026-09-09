import type { ICodec } from '../codec.js'

/** Identity codec used by whole-frame transports; it never imports a format runtime. */
export const identityCodec = Object.freeze({
  id: 'identity',
  version: 1,
  encodedType: 'unknown',
  encode: <T>(value: T): T => value,
  decode: <T>(value: T): T => value
} satisfies ICodec<unknown, unknown, 'identity', 1>)

/** Legacy entry retains the exact V1 codec object identity. */
export const identityCodecV1 = identityCodec
