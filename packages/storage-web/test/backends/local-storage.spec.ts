import { afterEach, describe, expect, it } from 'vitest'
import { localStorageHost } from '../../src/backends/local-storage'

describe('localStorageHost 默认注入', () => {
  afterEach(() => {
    globalThis.localStorage.clear()
  })
  it('未传 storage 时使用 globalThis.localStorage', async () => {
    const store = localStorageHost({ namespace: 'default-inject' })
    await store.set('k', 'v')
    expect(globalThis.localStorage.getItem('sw1:14:default-inject:k')).toBe('v')
  })
})
