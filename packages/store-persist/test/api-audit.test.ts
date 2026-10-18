import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { persist } from '../src/light-index.js'
import { createAtomStore, atomDef } from '@migaia/store-keyed'
import { persistKeyed } from '../src/keyed-index.js'
import { assertEnvelope, type IPersistHandle } from '../src/index.js'
import { defaultJsonCodec, PersistState } from '../src/index.js'

describe('store-persist audit regressions', () => {
  it('SP-D01 delivers the same real backend failure to concurrent strict flush calls', async () => {
    /** Public Store and backend own the actual state and write failure. */
    const runtime = createRuntime({ onError: () => {} })
    /** No pending state change introduces a debounced write before the explicit flush calls. */
    const store = createStore({ count: 1 }, { runtime })
    /** Closing the real backend yields its genuine coded boundary error. */
    const backend = memoryStorageHost()
    /** Exercise the highest existing facade rather than a private write queue. */
    const handle = persist(store, { key: 'strict', storage: backend })
    try {
      await handle.ready
      await backend.dispose()
      /** Both documented callers must observe the failed write, preserving its foreign owner. */
      const results = await Promise.allSettled([handle.flush(), handle.flush()])
      expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        expect(results[0].reason).toBe(results[1].reason)
        expect(results[0].reason).toMatchObject({
          source: '@migaia/storage-contract',
          code: 'STORE_DISPOSED'
        })
        expect(handle.writeError.value).toBe(results[0].reason)
      }
    } finally {
      handle.dispose()
      await store.$dispose()
      await backend.dispose()
    }
  })

  it('SP-D02 round-trips mixed legacy lookalikes and current Map/Set values without dropping fields', async () => {
    /** Extra user fields make these ordinary data records, not exact legacy collection markers. */
    const value = {
      version: 0,
      state: {
        legacy: { __migaia_persist_map__: [['old', 1]], note: 'keep-this-field' },
        legacySet: { __migaia_persist_set__: ['old'], note: 'keep-set-field' },
        current: new Map([['new', 2]]),
        currentSet: new Set(['new'])
      }
    }
    /** The codec must decode its own newly encoded result completely. */
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode(value)
    )) as typeof value
    expect(decoded.state.legacy).toEqual(value.state.legacy)
    expect(decoded.state.legacySet).toEqual(value.state.legacySet)
    expect(decoded.state.current).toBeInstanceOf(Map)
    expect(decoded.state.current).toEqual(value.state.current)
    expect(decoded.state.currentSet).toBeInstanceOf(Set)
    expect(decoded.state.currentSet).toEqual(value.state.currentSet)
  })

  it('SP-D02 continues reading exact one-key legacy collection archives', async () => {
    /** Exact one-key old markers remain the supported archive migration grammar. */
    const raw = JSON.stringify({
      version: 0,
      state: {
        map: { __migaia_persist_map__: [['old', 1]] },
        set: { __migaia_persist_set__: ['old'] }
      }
    })
    /** Normal legacy archives still decode to native collections. */
    const decoded = (await defaultJsonCodec.decode(raw)) as {
      state: { map: Map<string, number>; set: Set<string> }
    }
    expect(decoded.state.map).toEqual(new Map([['old', 1]]))
    expect(decoded.state.set).toEqual(new Set(['old']))
  })
  it('SP-D03 invokes a facade option getter with the original receiver once', async () => {
    /** Both value source and storage are complete actual public implementations. */
    const runtime = createRuntime({ onError: () => {} })
    /** An extra option property is legitimately read by the key getter through this. */
    const store = createStore({ count: 0 }, { runtime })
    /** The backend is disposed even if the wrapper rejects during construction. */
    const backend = memoryStorageHost()
    /** Observe identity rather than substituting descriptor internals. */
    const receivers: unknown[] = []
    /** The getter returns a string only when it receives the actual options object. */
    const options = {
      archiveName: 'receiver',
      storage: backend,
      get key(): string {
        receivers.push(this)
        return this.archiveName
      }
    }
    /** Failed construction has no handle to dispose. */
    let handle: IPersistHandle | undefined
    try {
      handle = persist(store, options)
      await handle.ready
      expect(receivers).toEqual([options])
    } finally {
      handle?.dispose()
      await store.$dispose()
      await backend.dispose()
    }
  })

  it('SP-D04 preserves the live keyed handle getter while value remains the initial snapshot', async () => {
    /** AtomStore owns the business value independently of persistence. */
    const atoms = createAtomStore(createRuntime())
    /** The initial snapshot differs from the restored archive. */
    const definition = atomDef(0)
    /** Actual storage and the public default codec supply the hydration input. */
    const backend = memoryStorageHost()
    await backend.set(
      'prefs:user',
      (await defaultJsonCodec.encode({ version: 0, state: 9 })) as string
    )
    /** The keyed facade must retain the canonical handle's live metadata. */
    const handle = persistKeyed(atoms, definition, 'user', { namespace: 'prefs', storage: backend })
    try {
      await handle.ready
      expect(handle.value).toBe(0)
      expect(atoms.get(definition)).toBe(9)
      handle.dispose()
      expect(handle.disposed).toBe(true)
      expect(handle.status.value).toBe('disposed')
    } finally {
      handle.dispose()
      atoms.dispose()
      await backend.dispose()
    }
  })

  it('SP-D05 rejects ready when disposal cancels the still-pending hydration', async () => {
    /** Gate the real backend read without replacing its cancellation or capability semantics. */
    const backend = memoryStorageHost()
    /** The original backend get remains the sole actual storage operation. */
    let release!: () => void
    /** No timer or simulated lifecycle is needed to force this supported race. */
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    /** A complete persistence port forwards every required method and its signal context. */
    const storage = {
      capabilities: backend.capabilities,
      get: async (key: string, ctx?: Parameters<typeof backend.get>[1]) => {
        await gate
        return backend.get(key, ctx)
      },
      set: (key: string, value: string, ctx?: Parameters<typeof backend.set>[2]) =>
        backend.set(key, value, ctx),
      remove: (key: string, ctx?: Parameters<typeof backend.remove>[1]) => backend.remove(key, ctx),
      keys: () => backend.keys(),
      getBytes: (key: string, ctx?: Parameters<typeof backend.getBytes>[1]) =>
        backend.getBytes(key, ctx),
      setBytes: (key: string, value: Uint8Array, ctx?: Parameters<typeof backend.setBytes>[2]) =>
        backend.setBytes(key, value, ctx)
    }
    /** The real light Store is restored only if hydration actually succeeds. */
    const store = createStore({ count: 0 }, { runtime: createRuntime({ onError: () => {} }) })
    /** Register rejection observation before closing the public owner. */
    const handle = persist(store, { key: 'cancelled', storage })
    /** The ready result describes this attempt, not a mutable status sampled later. */
    const ready = expect(handle.ready).rejects.toMatchObject({
      name: 'AbortError',
      source: '@migaia/store-persist',
      code: 'ABORTED_BY_DISPOSE'
    })
    try {
      handle.dispose()
      release()
      await ready
      await expect(handle.settled).resolves.toBeUndefined()
      expect(handle.hydrated.value).toBe(false)
    } finally {
      release()
      handle.dispose()
      await store.$dispose()
      await backend.dispose()
    }
  })

  it('SP-D06 keeps a failed envelope getter reachable through a coded validation error', () => {
    /** The accessor owns this real native failure and its stack. */
    const primary = new Error('envelope getter failed')
    /** The public unknown boundary must expose its semantic validation identity. */
    let failure: unknown
    try {
      assertEnvelope(
        {
          get version() {
            throw primary
          },
          state: {}
        },
        'audit'
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      source: '@migaia/store-persist',
      code: 'ENVELOPE_INVALID',
      cause: primary
    })
    expect((failure as Error).cause).toBe(primary)
    expect(primary.stack).toBeTruthy()
  })
  it('SP-C02 keeps the private active projection out of the public runtime vocabulary', () => {
    expect(PersistState).not.toHaveProperty('active')
    expect(PersistState.disposed).toBe('disposed')
  })
  it('SP-D02 preserves ordinary tuple-shaped arrays inside a valid legacy archive', async () => {
    /** The old format did not assign new-format meaning to an application array in a Map value. */
    const literal = ['migaia-collections-json-v1', 'map', [['application', 1]]]
    /** An exact old marker identifies the existing legacy archive grammar. */
    const raw = JSON.stringify({
      version: 0,
      state: { __migaia_persist_map__: [['literal', literal]] }
    })
    /** Legacy compatibility must retain the application value rather than reinterpret it as a Map. */
    const decoded = (await defaultJsonCodec.decode(raw)) as { state: Map<string, unknown> }
    expect(decoded.state).toBeInstanceOf(Map)
    expect(decoded.state.get('literal')).toEqual(literal)
    expect(Array.isArray(decoded.state.get('literal'))).toBe(true)
  })
})
