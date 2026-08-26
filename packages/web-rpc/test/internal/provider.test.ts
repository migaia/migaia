import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../../src/internal/provider'

describe('provider registry ownership', () => {
  it('rejects duplicate providers and clears every callback table', () => {
    const registry = new ProviderRegistry()
    const provider = () => ({ ok: true as const })
    expect(registry.register('method', provider)).toBe(true)
    expect(registry.register('method', provider)).toBe(false)
    registry.listen('event', () => undefined)
    registry.clear()
    expect(registry.getProvider('method')).toBeUndefined()
    expect(registry.getListeners('event')).toBeUndefined()
  })

  it('keeps listener disposal idempotent and independent', () => {
    const registry = new ProviderRegistry()
    const first = () => undefined
    const second = () => undefined
    const stopFirst = registry.listen('event', first)
    const stopSecond = registry.listen('event', second)
    stopFirst()
    stopFirst()
    expect(registry.getListeners('event')).toEqual([second])
    stopSecond()
    expect(registry.getListeners('event')).toBeUndefined()
  })
})
