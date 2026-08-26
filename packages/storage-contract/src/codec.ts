import type { IOperationContext } from './context.js'

export type ICodecOutput = 'text' | 'binary' | 'structured'

/**
 * 序列化是面向开发者的开放契约，不绑定任何库。内置实现只提供最常用的三个（见 storage-web 的 jsonCodec / structured.ts /
 * binary.ts），任何自定义编解码——压缩、 加密、走 Worker 的重编码——都通过实现同一接口接入，本包不内置也不依赖它们。
 */
export type ICodec<T = unknown, TRaw = string | Uint8Array | unknown> = {
  readonly name: string
  /** 声明产出形态，用于与后端能力选路。 */
  readonly output: ICodecOutput
  encode(value: T, ctx?: IOperationContext): Promise<TRaw>
  decode(raw: TRaw, ctx?: IOperationContext): Promise<T>
}
