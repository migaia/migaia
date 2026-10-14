import type { IOperationContext } from './context.js'

export type ICodecOutput = 'text' | 'binary' | 'structured'

/**
 * Defines an open serialization contract without tying it to a library. `storage-web` supplies
 * three common implementations in `jsonCodec`, `structured.ts`, and `binary.ts`. Custom
 * compression, encryption, and Worker-based recoding implement the same contract. This package
 * neither supplies nor depends on those custom implementations.
 */
export type ICodec<T = unknown, TRaw = string | Uint8Array | unknown> = {
  readonly name: string
  /** Declares the output form used to select a route from the backend capabilities. */
  readonly output: ICodecOutput
  encode(value: T, ctx?: IOperationContext): Promise<TRaw>
  decode(raw: TRaw, ctx?: IOperationContext): Promise<T>
}
