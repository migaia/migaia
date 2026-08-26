import { describe, expect, it, vi } from 'vitest'
import { VerifiedPeerRegistry } from '../../src/internal/identity'

describe('VerifiedPeerRegistry', () => {
  it('keeps source bindings injective across delimiter characters', () => {
    const registry = new VerifiedPeerRegistry()
    expect(registry.register('a:b', 'c', 'd')).not.toBe(registry.register('a', 'b:c', 'd'))
    expect(registry.register('a:b', 'c', 'd')).toBe(registry.register('a:b', 'c', 'd'))
  })

  it('rejects new bindings without evicting retained identities', () => {
    const registry = new VerifiedPeerRegistry(2)
    registry.register('first')
    registry.register('second')
    expect(registry.register('third')).toBe(false)
    expect(registry.has('first')).toBe(true)
    expect(registry.has('second')).toBe(true)
    expect(registry.has('third')).toBe(false)
  })

  it('bounds bindings per origin', () => {
    const registry = new VerifiedPeerRegistry(10, 2)
    registry.register('one', undefined, 'https://example.test', 'a')
    registry.register('two', undefined, 'https://example.test', 'b')
    expect(registry.register('three', undefined, 'https://example.test', 'c')).toBe(false)
    expect(registry.has('one', undefined, 'https://example.test', 'a')).toBe(true)
    expect(registry.has('two', undefined, 'https://example.test', 'b')).toBe(true)
    expect(registry.has('three', undefined, 'https://example.test', 'c')).toBe(false)
  })

  it('expires bindings and requires reauthentication', () => {
    const registry = new VerifiedPeerRegistry(10, 2, 1)
    const first = registry.register('peer')
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(registry.has('peer')).toBe(false)
        expect(registry.register('peer')).not.toBe(first)
        resolve()
      }, 2)
    )
  })

  it('does not expire a binding while an operation retains its lease', () => {
    const registry = new VerifiedPeerRegistry(2, 2, 1)
    const token = registry.register('active')
    expect(typeof token).toBe('string')
    expect(registry.retain(token as string)).toBe(true)
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(registry.has('active')).toBe(true)
        registry.release(token as string)
        resolve()
      }, 10)
    )
  })

  it('retain() does not purge the exact token it is about to retain (round-2 regression)', () => {
    vi.useFakeTimers()
    try {
      const registry = new VerifiedPeerRegistry(4, 4, 1) // maxBindingAgeMs=1: any elapsed tick is "expired"
      const token = registry.register('peer')
      vi.advanceTimersByTime(5) // idle past maxBindingAgeMs before the binding is ever retained
      // A naive purge-then-lookup retain() would delete this binding here and return false.
      expect(registry.retain(token as string)).toBe(true)
      expect(registry.has('peer')).toBe(true) // refs>0 keeps it alive past the idle TTL
    } finally {
      vi.useRealTimers()
    }
  })

  it('force-expires a retained binding after its hard lifetime', () => {
    vi.useFakeTimers()
    try {
      const registry = new VerifiedPeerRegistry(10, 2, 10)
      const token = registry.register('retained')
      expect(registry.retain(token as string)).toBe(true)
      vi.advanceTimersByTime(1_001)
      expect(registry.has('retained')).toBe(false)
      expect(registry.retain(token as string)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
