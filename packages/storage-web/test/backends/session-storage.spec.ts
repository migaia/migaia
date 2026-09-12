import { afterEach, describe, expect, it } from 'vitest'
import { sessionStorageHost } from '../../src/backends/session-storage'

describe('sessionStorageHost 默认注入', () => {
  afterEach(() => {
    globalThis.sessionStorage.clear()
  })
  it('未传 storage 时使用 globalThis.sessionStorage', async () => {
    const store = sessionStorageHost({ namespace: 'default-inject' })
    await store.set('k', 'v')
    expect(globalThis.sessionStorage.getItem('sw1:14:default-inject:k')).toBe('v')
  })
})
