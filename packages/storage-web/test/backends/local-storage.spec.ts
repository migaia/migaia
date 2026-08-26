import { afterEach, describe, expect, it } from 'vitest'
import { localStorage } from '../../src/backends/local-storage'

describe('localStorage 默认注入', () => {
  afterEach(() => {
    globalThis.localStorage.clear()
  })
  it('未传 storage 时使用 globalThis.localStorage', async () => {
    const store = localStorage({ namespace: 'default-inject' })
    await store.set('k', 'v')
    expect(globalThis.localStorage.getItem('sw1:14:default-inject:k')).toBe('v')
  })
})
