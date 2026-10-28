import type { ISerializeChunk, ISerializeParser, ISerializePlugin } from '../../src/types.ts'

/** Creates one test parser without owning any external resource. */
export const textParser = (name = 'text'): ISerializeParser => ({
  name,
  encode: (value): ISerializeChunk => ['text', String(value)],
  decode: (chunk): unknown => (chunk[0] === 'text' ? chunk[1] : chunk)
})

/** Associates one routing token with its parser fixture. */
export const plugin = (
  type: string,
  parser: ISerializeParser = textParser(type)
): ISerializePlugin => ({
  type,
  parser
})
