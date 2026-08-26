import { expectTypeOf } from 'vitest'
import type { ICookiesOptions, ICookieScope, IExtensionStage, ISyncCapableStore } from '../../src'
import { memoryStorage } from '../../src'

expectTypeOf<ICookiesOptions>().toMatchTypeOf<{ scope?: ICookieScope }>()
expectTypeOf<IExtensionStage>().toEqualTypeOf<
  'schema' | 'codec' | 'migration' | 'comparator' | 'diagnostic'
>()
type IMemoryStore = ReturnType<typeof memoryStorage>
expectTypeOf(memoryStorage()).toMatchTypeOf<ISyncCapableStore<IMemoryStore>>()
import type { ICodec, ISchemaAdapter } from '../../src/index'

/** Schema/codec 是面向开发者的开放契约：任何手写实现（不 import 任何第三方库） 都应该能被类型系统接受，不需要绕过 as any。 */
const customCodec: ICodec<{ n: number }, string> = {
  name: 'custom',
  output: 'text',
  encode: async (value) => String(value.n),
  decode: async (raw) => ({ n: Number(raw) })
}
expectTypeOf(customCodec).toMatchTypeOf<ICodec<{ n: number }, string>>()

const customSchema: ISchemaAdapter<{ n: number }, string> = {
  name: 'custom-schema',
  validate: async (value) => {
    if (typeof value !== 'object' || value === null || !('n' in value))
      throw new TypeError('invalid')
    return value as { n: number }
  },
  encode: async (value) => String(value.n),
  decode: async (raw) => ({ n: Number(raw) })
}
expectTypeOf(customSchema).toMatchTypeOf<ISchemaAdapter<{ n: number }, string>>()

// normalize/encode/decode 均为可选——最小实现只需 name + validate。
const minimalSchema: ISchemaAdapter<unknown> = {
  name: 'minimal',
  validate: async (value) => value
}
expectTypeOf(minimalSchema).toMatchTypeOf<ISchemaAdapter<unknown>>()
