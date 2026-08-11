import { describe, expect, it } from 'vitest'
import { jsonPlugin, createSerializeRegistry } from '@migaia/store/serialize'
import {
  localStorageAdapter,
  readSSRStateFromDocument,
  readSSRStateFromDocumentWith
} from './index'

describe('@migaia/store-web adapters', () => {
  it('wraps injected Web Storage without touching ambient globals', () => {
    const values = new Map<string, string>()
    const storage = {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value)
    }
    const adapter = localStorageAdapter(storage)
    adapter.setItem('key', 'value')
    expect(adapter.getItem('key')).toBe('value')
  })

  it('reads plain and codec-tagged SSR state from an injected document', async () => {
    const state = { version: 1 as const, stores: { app: { count: 1 } } }
    const documentValue = {
      getElementById: () => ({
        textContent: JSON.stringify(state),
        getAttribute: (name: string) =>
          name === 'data-codec' ? 'json' : name === 'data-wire' ? 'text' : null
      })
    } as unknown as Document
    expect(readSSRStateFromDocument('__STORE_STATE__', documentValue)).toEqual(state)
    await expect(
      readSSRStateFromDocumentWith({
        codecs: createSerializeRegistry([jsonPlugin()]),
        document: documentValue
      })
    ).resolves.toEqual(state)
  })
})
