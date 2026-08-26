import { describe, expect, it } from 'vitest'
import { ControlTaskRegistry } from '../../src/internal/control-task-registry'

describe('ControlTaskRegistry', () => {
  it('purges expired unordered aborts before applying its hard cap', () => {
    const registry = new ControlTaskRegistry()
    expect(registry.rememberAbort('old', 10, 0)).toBe(true)
    expect(registry.consumeAbort('old', 11)).toBe(false)
    expect(registry.rememberAbort('new', 20, 11)).toBe(true)
  })

  it('deduplicates control tasks before they reach the wire owner', () => {
    const registry = new ControlTaskRegistry()
    expect(registry.admit('task', 0)).toBe(true)
    expect(registry.admit('task', 1)).toBe(false)
    registry.clear()
    expect(registry.admit('task', 2)).toBe(true)
  })

  it('keeps variation admission in the control owner', () => {
    const registry = new ControlTaskRegistry()
    expect(registry.admitVariation('peer', 0)).toBe(true)
    expect(registry.admitVariation('peer', 1)).toBe(true)
    expect(registry.admitVariation('peer', 60_001)).toBe(true)
  })

  it('does not consume variation quota when replay capacity is full', () => {
    const registry = new ControlTaskRegistry()
    for (let index = 0; index < 1024; index++)
      expect(registry.admitControl(`peer-${index % 9}`, `filled-${index}`, index)).toBe(true)
    expect(registry.admitControl('quota-peer', 'rejected-by-capacity', 2_000)).toBe(false)
    expect(registry.admitVariation('quota-peer', 2_001)).toBe(true)
  })

  it('requires a boolean lease decision and skips tombstones when retain rejects', () => {
    let available = false
    const retained: string[] = []
    const registry = new ControlTaskRegistry({
      retain: (peerKey) => {
        if (!available) return false
        retained.push(peerKey)
        return true
      },
      release: () => undefined
    })

    expect(registry.admitControl('peer', 'rejected', 0)).toBe(false)
    available = true
    expect(registry.admitControl('peer', 'rejected', 1)).toBe(true)
    expect(retained).toEqual(['peer'])
  })
})
