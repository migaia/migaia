import { expect, it } from 'vitest'
import { createSerializeRegistry } from '../src/index.ts'

it('rejects malformed plugins with INVALID_OPTION before acquiring any parser', () => {
  const invalid = [
    [{ type: 1, parser: {} }],
    [{ type: 'a', parser: 1 }],
    [{ type: 'a', parser: { name: 'a', encode: 1, decode: () => undefined } }],
    [{ type: 'a', parser: { name: 'a', encode: () => [], decode: () => 1, dispose: 1 } }]
  ]
  for (const plugins of invalid)
    expect(() => createSerializeRegistry(plugins as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
})
