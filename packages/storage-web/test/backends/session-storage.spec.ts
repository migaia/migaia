import { afterEach, describe, expect, it } from 'vitest'
import { createSessionTestStore } from '../helpers/installed-backends.js'

describe('sessionStorageHost 默认注入', () => {
  afterEach(() => {
    globalThis.sessionStorage.clear()
  })
  it('未传 storage 时使用 globalThis.sessionStorage', async () => {
    const store = await createSessionTestStore({ namespace: 'default-inject' })
    await store.set('k', 'v')
    expect(globalThis.sessionStorage.getItem('sw1:14:default-inject:k')).toBe('v')
  })
})
