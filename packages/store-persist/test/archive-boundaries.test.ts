import { describe, expect, it } from 'vitest'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { binaryCodec } from '@migaia/storage-web/serialize'
import { createStore } from '@migaia/store-light'
import type { ICodec } from '@migaia/storage-contract'
import { persist } from '../src/light-index.js'
import {
  defaultJsonCodec,
  readEnvelope,
  removeEnvelope,
  writeEnvelope,
  PersistEnvelopeError
} from '../src/index.js'

/** Real envelope JSON travels through the byte channel without replacing storage semantics. */
const binaryArchiveCodec: ICodec = {
  name: 'binary-archive-json',
  output: 'binary',
  encode: async (value) =>
    new TextEncoder().encode((await defaultJsonCodec.encode(value)) as string),
  decode: async (raw) => defaultJsonCodec.decode(new TextDecoder().decode(raw as Uint8Array))
}

describe('public archive boundaries', () => {
  it('clears only the binary archive while preserving the live state and sibling bytes', async () => {
    /** The canonical backend owns both actual archive and sibling byte entries. */
    const storage = memoryStorageHost()
    /** Clearing persistence must leave this current business state intact. */
    const store = createStore({ count: 7 })
    /** A separate byte key must survive per-archive removal. */
    const sibling = new Uint8Array([3, 5])
    await storage.setBytes('sibling', sibling)
    /** The public facade must route removal using the same codec as hydration and writes. */
    const handle = persist(store, { key: 'binary-clear', storage, codec: binaryArchiveCodec })
    try {
      await handle.ready
      await handle.flush()
      expect(await readEnvelope(storage, 'binary-clear', binaryArchiveCodec, {})).toEqual({
        version: 0,
        state: { count: 7 }
      })
      await handle.clear()
      expect(await storage.getBytes('binary-clear')).toBeNull()
      expect(await readEnvelope(storage, 'binary-clear', binaryArchiveCodec, {})).toBeUndefined()
      expect(await storage.getBytes('sibling')).toEqual(sibling)
      expect(store.count).toBe(7)
      await handle.clear()
      expect(await storage.getBytes('binary-clear')).toBeNull()
    } finally {
      handle.dispose()
      await store.$dispose()
      await storage.dispose()
    }
  })

  it('selects byte deletion explicitly while preserving the existing text helper call', async () => {
    /** Actual channel isolation must survive both forms of the public helper. */
    const storage = memoryStorageHost()
    /** Text archives keep the existing three-argument removal contract. */
    const textArchive = { version: 0, state: { count: 1 } }
    /** The selected byte archive is independent of its neighboring text key. */
    const bytes = new Uint8Array([2, 4])
    try {
      await writeEnvelope(storage, 'text', defaultJsonCodec, textArchive, {})
      await writeEnvelope(storage, 'bytes', binaryCodec, bytes, {})
      await removeEnvelope(storage, 'bytes', {}, binaryCodec)
      expect(await storage.getBytes('bytes')).toBeNull()
      expect(await readEnvelope(storage, 'text', defaultJsonCodec, {})).toEqual(textArchive)
      await storage.setBytes('bytes', bytes)
      await removeEnvelope(storage, 'text', {})
      expect(await storage.get('text')).toBeNull()
      expect(await storage.getBytes('bytes')).toEqual(bytes)
    } finally {
      await storage.dispose()
    }
  })

  it('rejects binary clear on an adapter without per-key byte removal', async () => {
    /** Older projected adapters can still read and write bytes, but cannot claim deletion success. */
    const backend = memoryStorageHost()
    /** The public adapter deliberately exposes the pre-existing read/write-only byte projection. */
    const storage = { ...backend, removeBytes: undefined }
    /** The store remains usable and its written archive must survive the rejected clear. */
    const store = createStore({ count: 4 })
    /** All actual I/O still goes to the real canonical backend. */
    const handle = persist(store, { key: 'incomplete', storage, codec: binaryArchiveCodec })
    try {
      await handle.ready
      await handle.flush()
      /** Capture the exact rejection shared by the strict caller and public write status. */
      let failure: unknown
      try {
        await handle.clear()
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(TypeError)
      expect(failure).toMatchObject({
        source: '@migaia/store-persist',
        code: 'BACKEND_CAPABILITY',
        message: '[store] binary archive removal requires a storage backend with removeBytes'
      })
      expect(handle.writeError.value).toBe(failure)
      expect(await readEnvelope(backend, 'incomplete', binaryArchiveCodec, {})).toEqual({
        version: 0,
        state: { count: 4 }
      })
    } finally {
      handle.dispose()
      await store.$dispose()
      await backend.dispose()
    }
  })

  it('round-trips byte archives through the actual binary backend', async () => {
    /** The real backend supplies both byte operations and their declared capability. */
    const storage = memoryStorageHost()
    /** The binary codec preserves the application payload instead of coercing it to text. */
    const payload = new Uint8Array([0, 1, 127, 255])
    try {
      expect(await readEnvelope(storage, 'bytes', binaryCodec, {})).toBeUndefined()
      await writeEnvelope(storage, 'bytes', binaryCodec, payload, {})
      expect(await storage.getBytes('bytes')).toEqual(payload)
      expect(await readEnvelope(storage, 'bytes', binaryCodec, {})).toEqual(payload)
    } finally {
      await storage.dispose()
    }
  })

  it('rejects a corrupt archive version without restoring state or allowing a write to replace it', async () => {
    /** A malformed stored archive is external data, not a modified persistence implementation. */
    const storage = memoryStorageHost()
    /** The live business value must survive rejected hydration unchanged. */
    const store = createStore({ count: 1 })
    /** Encoding succeeds because envelope schema validation belongs to persistence hydration. */
    const raw = (await defaultJsonCodec.encode({
      version: 'broken',
      state: { count: 9 }
    })) as string
    await storage.set('corrupt', raw)
    /** The highest facade exercises the actual readiness and strict-write gates. */
    const handle = persist(store, { key: 'corrupt', storage })
    try {
      /** Capture the exact hydration failure so later strict callers must receive that failure. */
      let failure: unknown
      try {
        await handle.ready
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(PersistEnvelopeError)
      expect(failure).toMatchObject({
        source: '@migaia/store-persist',
        code: 'ENVELOPE_INVALID'
      })
      expect(store.count).toBe(1)
      expect(handle.hydrated.value).toBe(false)
      await expect(handle.flush()).rejects.toBe(failure)
      expect(await storage.get('corrupt')).toBe(raw)
    } finally {
      handle.dispose()
      await store.$dispose()
      await storage.dispose()
    }
  })
})
