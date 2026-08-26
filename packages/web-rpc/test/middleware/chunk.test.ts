import { describe, expect, it } from 'vitest'
import { chunk } from '../../src/middleware/chunk'
import { installPlugin } from './helpers'

describe('chunk middleware', () => {
  it('splits by UTF-8 bytes without breaking unicode', () => {
    const values = installPlugin(chunk({ chunkSize: 4 }))
    const capability = values.get('chunkCapability') as {
      byteLength(value: string): number
      split(value: string, max: number): readonly string[]
    }
    const parts = capability.split('😀中文', 4)
    expect(parts.join('')).toBe('😀中文')
    expect(Math.max(...parts.map((part) => capability.byteLength(part)))).toBeLessThanOrEqual(4)
  })
  it('preserves custom splitter and byte counter in middleware capability', () => {
    const split = (value: string): readonly string[] => [value.slice(0, 1), value.slice(1)]
    const byteLength = (value: string): number => value.length
    const values = installPlugin(chunk({ split, byteLength }))
    const capability = values.get('chunkCapability') as {
      byteLength: (value: string) => number
      split: (value: string, max: number) => readonly string[]
    }
    expect(capability.byteLength).toBe(byteLength)
    expect(capability.split).toBe(split)
  })
})
