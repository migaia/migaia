import { afterEach, describe, expect, it } from 'vitest'
import { createLocalTestStore } from '../helpers/installed-backends.js'

describe('localStorageHost 默认注入', () => {
  afterEach(() => {
    globalThis.localStorage.clear()
  })
  it('未传 storage 时使用 globalThis.localStorage', async () => {
    const store = await createLocalTestStore({ namespace: 'default-inject' })
    await store.set('k', 'v')
    expect(globalThis.localStorage.getItem('sw1:14:default-inject:k')).toBe('v')
  })
})
