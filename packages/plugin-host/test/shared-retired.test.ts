import { expect, it } from 'vitest'
import { definePlugin, PluginHostErrorCode } from '../src/index.js'

it('rejects the retired shared definition field', () => {
  expect(() =>
    definePlugin({ name: 'retired', shared: () => ({}), install: () => ({}) } as never)
  ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.pluginDefinitionInvalid }))
})
