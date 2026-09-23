import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseConfigPath, readConfigPath } from '../src/config'

describe('PluginHost configuration properties', () => {
  it('reads arbitrary non-negative array indexes through the public path grammar', () => {
    fc.assert(
      fc.property(fc.nat({ max: 32 }), fc.string(), (index, value) => {
        const config = { records: Array.from({ length: index + 1 }, () => ({ value })) }
        const path = parseConfigPath(`plugin.records.[${index}].value`)
        expect(readConfigPath(config, path)).toBe(value)
      })
    )
  })

  it('delegates the shared path grammar while preserving the plugin-host mutable array boundary', () => {
    const segments = parseConfigPath('plugin.records.[0].value')
    expect(segments).toEqual(['plugin', 'records', '0', 'value'])
    expect(Object.isFrozen(segments)).toBe(false)
    expect(() => parseConfigPath('plugin.records.[0')).toThrow(/invalid/)
  })
})
