import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../../../src/core/internal/provider.js'

describe('provider registry ownership', () => {
  it('rejects duplicate providers and clears every callback table', () => {
    const registry = new ProviderRegistry()
    const provider = () => ({ ok: true as const })
    expect(registry.register('method', provider)).toBe(true)
    expect(registry.register('method', provider)).toBe(false)
    registry.listen('event', () => undefined)
    registry.clear()
    expect(registry.getProvider('method')).toBeUndefined()
    expect(registry.hasListeners('event')).toBe(false)
    expect(registry.listenerCount).toBe(0)
  })

  it('keeps listener disposal idempotent and independent', () => {
    const registry = new ProviderRegistry()
    const first = () => undefined
    const second = () => undefined
    const stopFirst = registry.listen('event', first)
    const stopSecond = registry.listen('event', second)
    stopFirst()
    stopFirst()
    expect(registry.hasListeners('event')).toBe(true)
    expect(registry.listenerCount).toBe(1)
    stopSecond()
    expect(registry.hasListeners('event')).toBe(false)
    expect(registry.listenerCount).toBe(0)
  })
})
