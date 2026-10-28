import { describe, expect, it, vi } from 'vitest'
import { createStoreResource } from '../src/store-resource.ts'

describe('event-subscriber compatibility', () => {
  it('preserves exact revision progression and notification call order', async () => {
    const calls: string[] = []
    const resource = createStoreResource(() => ({ value: 1 }))
    const first = resource.subscribe(() => calls.push('first'))
    const second = resource.subscribe(() => calls.push('second'))
    const before = resource.getSnapshot()
    resource.preload()
    await vi.waitFor(() => expect(resource.getSnapshot()).toBe(before + 1))
    expect(calls).toEqual(['first', 'second'])
    const stable = resource.getSnapshot()
    second()
    resource.preload()
    await Promise.resolve()
    first()
    expect(resource.getSnapshot()).toBe(stable)
    resource.dispose()
    const disposed = resource.getSnapshot()
    expect(resource.getSnapshot()).toBe(disposed)
  })

  it('preserves Set dedupe and repeated disposer idempotency', async () => {
    const listener = vi.fn()
    const resource = createStoreResource(() => ({ value: 1 }))
    const first = resource.subscribe(listener)
    const duplicate = resource.subscribe(listener)
    resource.preload()
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    duplicate()
    duplicate()
    first()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
