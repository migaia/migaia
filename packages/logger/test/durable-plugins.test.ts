import { describe, expect, it, vi } from 'vitest'
import { Logger } from '../src/index.js'
import { binlog, wal, undoLog, memoryLogStore } from '../src/plugins/durable/index.js'
import type { ILogAppendPort, ILogStore, ILogPayload } from '../src/plugins/durable/index.js'

/** No clock budgets or output effects obscure durable resource ownership. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** Uses the logger's supported runtime injection for expected failure diagnostics. */
const runtimeManager = {
  randomUUID: () => crypto.randomUUID(),
  defer: (task: () => void) => queueMicrotask(task),
  write: () => undefined
}
/** Provides only transaction callbacks for testing plugin call timing, never native atomicity. */
function transactionPort(store: ILogStore, append: ILogAppendPort['append']) {
  const commit = new Set<() => void>()
  const rollback = new Set<() => void>()
  const port: ILogAppendPort = {
    store,
    append,
    onCommit: (effect) => {
      commit.add(effect)
      return () => {
        commit.delete(effect)
      }
    },
    onRollback: (effect) => {
      rollback.add(effect)
      return () => {
        rollback.delete(effect)
      }
    }
  }
  return {
    port,
    commit: () => {
      for (const effect of commit) effect()
      commit.clear()
      rollback.clear()
    },
    rollback: () => {
      for (const effect of rollback) effect()
      commit.clear()
      rollback.clear()
    }
  }
}

describe('durable logger plugins', () => {
  it('borrows original stores, echoes metadata only, and revokes old nested methods', async () => {
    const store = memoryLogStore()
    const log = new Logger({ execution, runtimeManager, plugins: [binlog({ store, echo: true })] })
    const entries: unknown[] = []
    log.useSink((entry) => {
      entries.push(entry)
    })
    await log.binlog.ready()
    const old = log.binlog
    const append = old.append
    expect(await log.binlog.append('created', { secret: 'business data' })).toBe(1)
    expect(entries).toMatchObject([
      { tag: 'binlog', message: 'created', meta: { seq: 1, time: expect.any(Number) } }
    ])
    expect(entries[0]).not.toHaveProperty('payload')
    const other = new Logger({ execution, runtimeManager })
    await expect(other.use(binlog({ store }))).rejects.toBeDefined()
    await other.shutdown('manual')
    await log.unUse('binlog')
    await old.whenIdle()
    await expect(append('stale', null)).rejects.toMatchObject({ code: 'RUNTIME_SHUTTING_DOWN' })
    await expect(old.ready()).rejects.toMatchObject({ code: 'RUNTIME_SHUTTING_DOWN' })
    const [handle] = await log.use(binlog({ store }))
    await handle.extensions.binlog.ready()
    expect(await handle.extensions.binlog.lastSeq()).toBe(1)
    await expect(old.lastSeq()).rejects.toMatchObject({ code: 'RUNTIME_SHUTTING_DOWN' })
    await log.shutdown('manual')
    expect(await store.lastSeq()).toBe(1)
    await store.dispose()
  })
  it('hands history to live delivery exactly once while independent subscribers keep progressing', async () => {
    const store = memoryLogStore()
    await store.append([
      { kind: 'a', payload: 1 },
      { kind: 'b', payload: 2 }
    ])
    const log = new Logger({ execution, runtimeManager, plugins: [binlog({ store })] })
    await log.binlog.ready()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow: number[] = []
    const fast: number[] = []
    const offSlow = log.binlog.subscribe(1, async (row) => {
      slow.push(row.seq)
      if (row.seq === 1) await blocked
    })
    const offFast = log.binlog.subscribe(1, (row) => {
      fast.push(row.seq)
    })
    await vi.waitFor(() => expect(slow).toEqual([1]))
    await log.binlog.append('c', 3)
    await vi.waitFor(() => expect(fast).toEqual([1, 2, 3]))
    expect(slow).toEqual([1])
    release()
    await vi.waitFor(() => expect(slow).toEqual([1, 2, 3]))
    offSlow()
    offSlow()
    offFast()
    await log.shutdown('manual')
    await store.dispose()
  })
  it('reports listener failure once and stops cursors passed by truncation', async () => {
    const store = memoryLogStore()
    const log = new Logger({ execution, runtimeManager, plugins: [binlog({ store })] })
    await log.binlog.ready()
    const failures: unknown[] = []
    log.onFailure((failure) => {
      failures.push(failure)
    })
    const original = new Error('listener failed')
    log.binlog.subscribe(1, () => {
      throw original
    })
    await log.binlog.append('a', null)
    await vi.waitFor(() => expect(failures).toContainEqual({ source: 'hook', error: original }))
    await log.binlog.append('b', null)
    expect(
      failures.filter((value) => (value as { error: unknown }).error === original)
    ).toHaveLength(1)
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const received: number[] = []
    log.binlog.subscribe(1, async (row) => {
      received.push(row.seq)
      await wait
    })
    await vi.waitFor(() => expect(received).toEqual([1]))
    await log.binlog.truncate(3)
    release()
    await vi.waitFor(() =>
      expect(failures).toContainEqual({
        source: 'hook',
        error: expect.objectContaining({ code: 'LOG_SUBSCRIPTION_TRUNCATED' })
      })
    )
    await log.shutdown('manual')
    await store.dispose()
  })
  it('serializes WAL terminal competition and preserves pending records for recovery', async () => {
    const store = memoryLogStore()
    const log = new Logger({ execution, runtimeManager, plugins: [wal({ store })] })
    await log.wal.ready()
    const first = await log.wal.begin('intent', { key: 'a' })
    const second = await log.wal.begin('intent', { key: 'b' })
    const results = await Promise.allSettled([log.wal.complete(first), log.wal.abort(first)])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((await log.wal.pending()).map((row) => row.seq)).toEqual([second])
    await log.shutdown('manual')
    const reopened = new Logger({ execution, runtimeManager, plugins: [wal({ store })] })
    await reopened.wal.ready()
    expect((await reopened.wal.pending()).map((row) => row.seq)).toEqual([second])
    await reopened.wal.abort(second)
    expect(await reopened.wal.pending()).toEqual([])
    await reopened.shutdown('manual')
    await store.dispose()
  })
  it('indexes active undo images in reverse append order and never revives forgotten records', async () => {
    const store = memoryLogStore()
    const now = vi.spyOn(Date, 'now').mockReturnValue(100)
    try {
      const log = new Logger({ execution, runtimeManager, plugins: [undoLog({ store })] })
      await log.undo.ready()
      await log.undo.record('one', [{ target: 'a', before: null, after: { value: 1 } }])
      await log.undo.record('two', [{ target: 'b', before: 1, after: 2 }])
      await expect(log.undo.record('one', [])).rejects.toMatchObject({ code: 'UNDO_RECORD_EXISTS' })
      const copy = await log.undo.get('one')
      ;(copy![0].after as { value: number }).value = 9
      expect(await log.undo.get('one')).toEqual([
        { target: 'a', before: null, after: { value: 1 } }
      ])
      expect(await log.undo.list({ sinceTime: 100 })).toEqual([
        { txId: 'two', time: 100 },
        { txId: 'one', time: 100 }
      ])
      expect(await log.undo.list({ limit: 0 })).toEqual([])
      await log.undo.forget('one')
      await log.undo.forget('missing')
      await log.shutdown('manual')
      const reopened = new Logger({ execution, runtimeManager, plugins: [undoLog({ store })] })
      await reopened.undo.ready()
      expect(await reopened.undo.get('one')).toBeUndefined()
      await reopened.undo.record('one', [])
      expect((await reopened.undo.list())[0].txId).toBe('one')
      await reopened.shutdown('manual')
    } finally {
      now.mockRestore()
      await store.dispose()
    }
  })
  it('rejects corrupt owned undo recovery, releases the borrow, and preserves injected resources', async () => {
    const store = memoryLogStore()
    await store.append([
      { kind: 'unrelated', payload: null },
      { kind: 'undo', payload: { txId: 'bad', images: [{ before: 1, after: 2 }] } }
    ])
    const log = new Logger({ execution, runtimeManager, plugins: [undoLog({ store })] })
    await expect(log.undo.ready()).rejects.toMatchObject({ code: 'LOG_STORE_CORRUPT' })
    expect(await store.lastSeq()).toBe(2)
    const other = new Logger({ execution, runtimeManager, plugins: [binlog({ store })] })
    await other.binlog.ready()
    await other.shutdown('manual')
    await log.shutdown('manual')
    await store.dispose()
  })
  it('starts transaction ports in the current stack and whenIdle covers the actual append result', async () => {
    const store = memoryLogStore()
    const log = new Logger({ execution, runtimeManager, plugins: [binlog({ store })] })
    let resolve!: (seqs: readonly number[]) => void
    const completion = new Promise<readonly number[]>((done) => {
      resolve = done
    })
    let started = false
    const transaction = transactionPort(store, () => {
      started = true
      return completion
    })
    await expect(
      log.binlog.append('too-early', null, { transaction: transaction.port })
    ).rejects.toMatchObject({ code: 'INVALID_OPTION' })
    await log.binlog.ready()
    const result = log.binlog.append('provisional', null, { transaction: transaction.port })
    expect(started).toBe(true)
    let idle = false
    const waiting = log.binlog.whenIdle().then(() => {
      idle = true
    })
    await Promise.resolve()
    expect(idle).toBe(false)
    resolve([1])
    expect(await result).toBe(1)
    await waiting
    expect(await store.lastSeq()).toBe(0)
    transaction.rollback()
    await log.shutdown('manual')
    await store.dispose()
  })
  it('does not hold an immediate port result behind a blocked ordinary task', async () => {
    const actual = memoryLogStore()
    let release!: () => void
    let blocked = false
    const store: ILogStore = {
      ...actual,
      lastSeq: () =>
        blocked
          ? new Promise<number>((resolve) => {
              release = () => resolve(0)
            })
          : actual.lastSeq()
    }
    const log = new Logger({ execution, runtimeManager, plugins: [binlog({ store })] })
    await log.binlog.ready()
    blocked = true
    const ordinary = log.binlog.lastSeq()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const transaction = transactionPort(store, async () => [1])
    expect(await log.binlog.append('immediate', null, { transaction: transaction.port })).toBe(1)
    release()
    await ordinary
    await log.binlog.whenIdle()
    transaction.rollback()
    await log.shutdown('manual')
    await actual.dispose()
  })
  it('gets old-transaction commits from the store source after reinstalling undo', async () => {
    const store = memoryLogStore()
    const log = new Logger({ execution, runtimeManager, plugins: [undoLog({ store })] })
    await log.undo.ready()
    let staged: readonly { readonly kind: string; readonly payload: ILogPayload }[] = []
    const transaction = transactionPort(store, async (records) => {
      staged = records
      return [1]
    })
    await log.undo.record('late', [{ target: 'a', before: null, after: 1 }], {
      transaction: transaction.port
    })
    expect(await log.undo.get('late')).toBeUndefined()
    await log.unUse('undoLog')
    const [handle] = await log.use(undoLog({ store }))
    await handle.extensions.undo.ready()
    await store.append(staged)
    transaction.commit()
    expect(await handle.extensions.undo.get('late')).toEqual([
      { target: 'a', before: null, after: 1 }
    ])
    await expect(handle.extensions.undo.record('late', [])).rejects.toMatchObject({
      code: 'UNDO_RECORD_EXISTS'
    })
    await log.shutdown('manual')
    await store.dispose()
  })
  it('rollback releases a staged undo identity without publishing it', async () => {
    const store = memoryLogStore()
    const log = new Logger({ execution, runtimeManager, plugins: [undoLog({ store })] })
    await log.undo.ready()
    const transaction = transactionPort(store, async () => [1])
    await log.undo.record('reuse', [], { transaction: transaction.port })
    await expect(
      log.undo.record('reuse', [], { transaction: transaction.port })
    ).rejects.toMatchObject({ code: 'UNDO_RECORD_EXISTS' })
    expect(await log.undo.list()).toEqual([])
    transaction.rollback()
    await log.undo.record('reuse', [])
    expect((await log.undo.list()).map((row) => row.txId)).toEqual(['reuse'])
    await log.shutdown('manual')
    await store.dispose()
  })
})

it('contains option access failures before invoking transaction ports', async () => {
  const store = memoryLogStore()
  const log = new Logger({ execution, runtimeManager, plugins: [binlog({ store })] })
  await log.binlog.ready()
  const original = new Error('option getter failed')
  const options = {
    get transaction(): never {
      throw original
    }
  }
  await expect(log.binlog.append('invalid', null, options)).rejects.toMatchObject({
    code: 'INVALID_OPTION',
    cause: original
  })
  const page = {
    get limit(): never {
      throw original
    }
  }
  await expect(log.binlog.read(1, page)).rejects.toMatchObject({
    code: 'INVALID_OPTION',
    cause: original
  })
  expect(await log.binlog.lastSeq()).toBe(0)
  await log.shutdown('manual')
  await store.dispose()
})
