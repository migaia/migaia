import { describe, expect, it, vi } from 'vitest'
import { createStoreResource } from '../src/store-resource.js'

describe('event-subscriber listener migration', () => {
  it('ES-T53 preserves Set dedupe, snapshot dispatch, and idempotent unsubscribe', async () => {
    let resolveLoad!: (value: object) => void
    const load = new Promise<object>((resolve) => {
      resolveLoad = resolve
    })
    const listener = vi.fn()
    const resource = createStoreResource(() => load)
    resource.subscribe(listener)
    const duplicateStop = resource.subscribe(listener)

    resource.preload()
    resolveLoad({ value: 1 })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(listener).toHaveBeenCalledTimes(1)

    duplicateStop()
    resource.dispose()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ES-T19 keeps listener failure in the resource listener error phase', () => {
    const onError = vi.fn()
    const listener = vi.fn(() => {
      throw new Error('listener failure')
    })
    const resource = createStoreResource(() => ({ value: 1 }), { onError })
    resource.subscribe(listener)

    resource.dispose()

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'listener')
  })
})
