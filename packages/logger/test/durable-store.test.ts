import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileLogStore } from '../src/plugins/durable/file.js'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { memoryLogStore, LogRecordState } from '../src/plugins/durable/index.js'

describe('durable stores', () => {
  it('commits concurrent batches in admission order and preserves its high watermark', async () => {
    const store = memoryLogStore()
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        store.append([{ kind: 'entry', payload: { index } }])
      )
    )
    expect((await store.read(50, 10)).map((record) => record.seq)).toEqual([
      50, 51, 52, 53, 54, 55, 56, 57, 58, 59
    ])
    await store.truncate(101)
    expect(await store.lastSeq()).toBe(100)
    expect(await store.append([{ kind: 'entry', payload: null }])).toEqual([101])
    await store.setState(101, LogRecordState.done)
    expect(await store.states(LogRecordState.pending)).toEqual([])
    await expect(store.setState(101, LogRecordState.aborted)).rejects.toMatchObject({
      code: 'WAL_RECORD_INVALID'
    })
    await store.dispose()
  })
  it('snapshots input before FIFO admission and rejects an entire invalid batch', async () => {
    const store = memoryLogStore()
    const payload = { value: 1 }
    const pending = store.append([{ kind: 'entry', payload }])
    payload.value = 2
    await pending
    expect((await store.read(1, 1))[0].payload).toEqual({ value: 1 })
    await expect(
      store.append([
        { kind: 'entry', payload: 1 },
        { kind: 'entry', payload: undefined }
      ] as never)
    ).rejects.toMatchObject({ code: 'LOG_PAYLOAD_INVALID' })
    expect(await store.lastSeq()).toBe(1)
    await store.dispose()
  })
})

for (const [name, create] of [
  ['memory', async (_path: string) => memoryLogStore()],
  ['SQLite', fileLogStore]
] as const) {
  describe(`${name} durable contract`, () => {
    it('commits whole batches, publishes one frozen notice, and persists terminal state', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'logger-durable-'))
      const store = await create(join(directory, 'log.sqlite'))
      try {
        const notices: unknown[] = []
        const off = store.onAppend((notice) => {
          expect(Object.isFrozen(notice)).toBe(true)
          notices.push(notice)
        })
        expect(
          await store.append([
            { kind: 'a', payload: 1 },
            { kind: 'b', payload: 2 },
            { kind: 'c', payload: 3 }
          ])
        ).toEqual([1, 2, 3])
        await store.append([])
        await store.setState(1, LogRecordState.done)
        await store.truncate(2)
        expect(notices).toEqual([{ lastSeq: 3, count: 3 }])
        expect(await store.states(LogRecordState.pending)).toEqual([2, 3])
        off()
        off()
      } finally {
        await store.dispose()
        await rm(directory, { recursive: true, force: true })
      }
    })
    it('captures safe JSON without getters, rejects holes and cycles, and copies shared subtrees', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'logger-json-'))
      const store = await create(join(directory, 'log.sqlite'))
      try {
        const child = { value: 1 }
        await store.append([{ kind: 'shared', payload: { a: child, b: child } }])
        const record = (await store.read(1, 1))[0]
        ;(record.payload as { a: { value: number } }).a.value = 4
        expect((await store.read(1, 1))[0].payload).toEqual({ a: { value: 1 }, b: { value: 1 } })
        const cycle: { self?: unknown } = {}
        cycle.self = cycle
        let getterCalls = 0
        const accessor = {
          get value() {
            getterCalls++
            return 1
          }
        }
        const sparse: unknown[] = []
        sparse.length = 1
        for (const payload of [cycle, accessor, sparse, Infinity, new Date(), { value: 1n }])
          await expect(store.append([{ kind: 'bad', payload }] as never)).rejects.toMatchObject({
            code: 'LOG_PAYLOAD_INVALID'
          })
        expect(getterCalls).toBe(0)
        expect(await store.lastSeq()).toBe(1)
      } finally {
        await store.dispose()
        await rm(directory, { recursive: true, force: true })
      }
    })
  })
}

describe('SQLite durable resource', () => {
  it('retains the exclusive connection lock, reopens watermarks, and continues after complete truncation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logger-file-'))
    const path = join(directory, 'log.sqlite')
    let store = await fileLogStore(path)
    try {
      await store.append(Array.from({ length: 10 }, () => ({ kind: 'a', payload: null })))
      await expect(fileLogStore(path)).rejects.toMatchObject({ code: 'LOG_STORE_LOCKED' })
      await store.setState(1, LogRecordState.done)
      await store.dispose()
      store = await fileLogStore(path)
      expect((await store.read(1, 100)).length).toBe(10)
      expect(await store.states(LogRecordState.pending)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
      await store.truncate(11)
      await store.dispose()
      store = await fileLogStore(path)
      expect(await store.append([{ kind: 'next', payload: null }])).toEqual([11])
    } finally {
      await store.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects corrupt databases with the original native error as cause', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logger-corrupt-'))
    const path = join(directory, 'log.sqlite')
    try {
      await writeFile(path, 'this is not sqlite')
      await expect(fileLogStore(path)).rejects.toMatchObject({
        code: 'LOG_STORE_CORRUPT',
        cause: expect.any(Error)
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('caches explicit and symbolic cleanup promises separately', async () => {
    const store = memoryLogStore()
    await store.append([{ kind: 'a', payload: null }])
    const explicit = store.dispose()
    const symbolic = store[asyncDisposeKey]()
    expect(store.dispose()).toBe(explicit)
    expect(store[asyncDisposeKey]()).toBe(symbolic)
    expect(symbolic).not.toBe(explicit)
    await Promise.all([explicit, symbolic])
    await expect(store.lastSeq()).rejects.toMatchObject({ code: 'RUNTIME_SHUTTING_DOWN' })
  })
})
