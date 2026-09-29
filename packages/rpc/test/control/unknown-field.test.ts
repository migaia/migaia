import { describe, expect, it } from 'vitest'
import { createRpcUnknownFieldWarner } from '../../src/contract/index.js'

describe('unknown field warnings (A4)', () => {
  it('uses the protocol default of 256 keys and 1024 retained connections', () => {
    const warnings: Array<[string, string]> = []
    const warner = createRpcUnknownFieldWarner({
      warn(connection, key) {
        warnings.push([connection, key])
      }
    })
    warner.note('one', 'request', '/data/route', 'x')
    for (let index = 0; index < 300; index += 1)
      warner.note('one', 'request', '/data/route', `f${index}`)
    expect(warnings.filter(([connection]) => connection === 'one')).toHaveLength(257)
    expect(warnings.at(-1)).toEqual(['one', '*'])
    for (let index = 0; index < 1025; index += 1)
      warner.note(`peer-${index}`, 'request', '/data/route', 'x')
    warner.note('one', 'request', '/data/route', 'x')
    expect(warnings.at(-1)).toEqual(['one', 'request/data/route#x'])
  })

  it('deduplicates per connection and bounds retained keys', () => {
    const warnings: string[] = []
    const warner = createRpcUnknownFieldWarner({
      maxKeysPerConnection: 2,
      maxConnections: 2,
      warn(connection, key) {
        warnings.push(`${connection}:${key}`)
      }
    })
    warner.note('one', 'request', '/data/route', 'x')
    warner.note('one', 'request', '/data/route', 'x')
    warner.note('one', 'request', '/data/route', 'y')
    warner.note('one', 'request', '/data/route', 'z')
    warner.note('one', 'request', '/data/route', 'last')
    warner.note('two', 'request', '/data/route', 'x')
    warner.note('three', 'request', '/data/route', 'x')
    warner.note('one', 'request', '/data/route', 'x')
    expect(warnings).toEqual([
      'one:request/data/route#x',
      'one:request/data/route#y',
      'one:*',
      'two:request/data/route#x',
      'three:request/data/route#x',
      'one:request/data/route#x'
    ])
    warner.clear()
    warner.note('one', 'request', '/data/route', 'x')
    expect(warnings.at(-1)).toBe('one:request/data/route#x')
  })

  it('keeps reporter failures as the exact thrown value after recording the field', () => {
    const original = new Error('reporter failed')
    let calls = 0
    const warner = createRpcUnknownFieldWarner({
      warn() {
        calls += 1
        throw original
      }
    })
    expect(() => warner.note('one', 'request', '/data/route', 'x')).toThrow(original)
    warner.note('one', 'request', '/data/route', 'x')
    expect(calls).toBe(1)
  })

  it('truncates each component and canonicalizes array indexes', () => {
    const fields: string[] = []
    const warner = createRpcUnknownFieldWarner({
      warn(_connection, field) {
        fields.push(field)
      }
    })
    warner.note('one', 'k'.repeat(100), `/data/123/${'p'.repeat(300)}`, 'f'.repeat(10000))
    expect(fields[0]).toContain('/data/*/')
    expect(fields[0]!.length).toBeLessThanOrEqual(32 + 128 + 1 + 64 + 3)
    expect(fields[0]!.endsWith('…')).toBe(true)
  })
})
