import type { IOperationContext } from './context.ts'
import type { StorageStageKind } from './stage-kind.ts'

/** Declared encoded form: text strings, binary bytes, or backend-supported structured values. */
export type ICodecOutput = 'text' | 'binary' | 'structured'

/**
 * Defines an open serialization contract without tying it to a library. `storage-plugin-browser`
 * supplies three common implementations in `jsonCodec`, `structured.ts`, and `binary.ts`. Custom
 * compression, encryption, and Worker-based recoding implement the same contract. This package
 * neither supplies nor depends on those custom implementations.
 */
export type ICodec<T = unknown, TRaw = string | Uint8Array | unknown> = {
  /** Nonempty format identifier; snapshotCodec validates but does not trim or rewrite it. */
  readonly name: string
  /** Declares the output form used to select a route from the backend capabilities. */
  readonly output: ICodecOutput
  /** Encodes one business value; the implementation owns transformation and any context handling. */
  encode(value: T, ctx?: IOperationContext): Promise<TRaw>
  /**
   * Decodes an encoded value or rejects on a format failure; no implicit format conversion is
   * supplied.
   */
  decode(raw: TRaw, ctx?: IOperationContext): Promise<T>
}

/** Observation-only codec ports are bound to real stores and scopes by their existing host owner. */
export type ICodecStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.codec
  forTransaction: (scope: object) => ICodecStageObserver
  beforeEncode?: (operation: string, codec: string) => void | PromiseLike<void>
  afterEncode?: (operation: string, codec: string) => void | PromiseLike<void>
  onEncodeError?: (operation: string, codec: string, code?: string) => void | PromiseLike<void>
  beforeDecode?: (operation: string, codec: string) => void | PromiseLike<void>
  afterDecode?: (operation: string, codec: string) => void | PromiseLike<void>
  onDecodeError?: (operation: string, codec: string, code?: string) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>
