import { expect, it, vi } from 'vitest'

import { createLogHost } from '@migaia/log-host'

import type { ILogPlugin, ILogPluginCore, ILogEntry } from '@migaia/log-host/plugin'

import { binlogPlugin, walPlugin, undoLogPlugin, memoryLogStore } from '../src/index.ts'

import type { ILogAppendPort, ILogStore, ILogPayload } from '../src/index.ts'
/** No clock budgets or output effects obscure durable resource ownership. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** Expected diagnostics are observed through onFailure without native terminal output. */
function ignoreDiagnostic(): void {}
/** Provides only transaction callbacks for testing plugin call timing, never native atomicity. */
function transactionPort(
  store: ILogStore,
  append: ILogAppendPort['append']
): TransactionPortFixture {
  return new TransactionPortFixture(store, append)
}

/** Own only transaction callbacks; actual atomicity stays with the real storage fixture. */
class TransactionPortFixture {
  /** Commit effects belong to this one transaction receipt. */
  readonly #commits = new Set<() => void>()
  /** Rollback effects release only provisional state. */
  readonly #rollbacks = new Set<() => void>()
  /** The public native port retains the original store and immediate append callback. */
  readonly port: ILogAppendPort
  /** Capture capabilities without cloning or acquiring the injected storage resource. */
  constructor(store: ILogStore, append: ILogAppendPort['append']) {
    this.port = {
      store,
      append,
      onCommit: (effect) => this.#onCommit(effect),
      onRollback: (effect) => this.#onRollback(effect)
    }
  }
  /** Register one commit effect and return its original idempotent cancellation. */
  #onCommit(effect: () => void): () => void {
    this.#commits.add(effect)
    return () => {
      this.#commits.delete(effect)
    }
  }
  /** Register one rollback effect without introducing another transaction state machine. */
  #onRollback(effect: () => void): () => void {
    this.#rollbacks.add(effect)
    return () => {
      this.#rollbacks.delete(effect)
    }
  }
  /** The fixture publishes the same original committed callback order. */
  commit(): void {
    for (const effect of this.#commits) effect()
    this.#commits.clear()
    this.#rollbacks.clear()
  }
  /** A rollback never publishes committed records. */
  rollback(): void {
    for (const effect of this.#rollbacks) effect()
    this.#commits.clear()
    this.#rollbacks.clear()
  }
}

/** Block one real delegated store read while preserving spread and extraction assertions. */
class BlockedRead {
  /** All unblocked operations remain owned by the original store. */
  readonly #store: ILogStore
  /** This one flag selects the existing fixture's blocked read path. */
  #blocked = false
  /** Resolver existence marks the actual point where the ordinary task has started. */
  #resolve: ((value: number) => void) | undefined
  /** Borrow the original resource without changing its cleanup authority. */
  constructor(store: ILogStore) {
    this.#store = store
  }
  /** Enter blocking mode only after real plugin readiness completed. */
  block(): void {
    this.#blocked = true
  }
  /** Undefined until the actual blocking Promise has captured its completion. */
  get release(): (() => void) | undefined {
    return this.#resolve ? this.#release : undefined
  }
  /** A stable callback lends the original read method to the structural custom store. */
  readonly lastSeq = (): Promise<number> => this.#read()
  /** Unblocked reads use the real store; one blocked read captures the original release point. */
  #read(): Promise<number> {
    return this.#blocked ? new Promise<number>(this.#capture) : this.#store.lastSeq()
  }
  /** The Promise constructor supplies its real resolver directly. */
  readonly #capture = (resolve: (value: number) => void): void => {
    this.#resolve = resolve
  }
  /** Completing the fixture reports the same zero watermark as the original blocked callback. */
  readonly #release = (): void => {
    this.#resolve!(0)
  }
}

it(
  'durable logger plugins' +
    ' ' +
    'borrows original stores, echoes metadata only, and revokes old nested methods',
  durableCase1
)

it(
  'durable logger plugins' +
    ' ' +
    'hands history to live delivery exactly once while independent subscribers keep progressing',
  durableCase2
)

it(
  'durable logger plugins' +
    ' ' +
    'reports listener failure once and stops cursors passed by truncation',
  durableCase3
)

it(
  'durable logger plugins' +
    ' ' +
    'serializes WAL terminal competition and preserves pending records for recovery',
  durableCase4
)

it(
  'durable logger plugins' +
    ' ' +
    'indexes active undo images in reverse append order and never revives forgotten records',
  durableCase5
)

it(
  'durable logger plugins' +
    ' ' +
    'rejects corrupt owned undo recovery, releases the borrow, and preserves injected resources',
  durableCase6
)

it(
  'durable logger plugins' +
    ' ' +
    'starts transaction ports in the current stack and whenIdle covers the actual append result',
  durableCase7
)

it(
  'durable logger plugins' +
    ' ' +
    'does not hold an immediate port result behind a blocked ordinary task',
  durableCase8
)

it(
  'durable logger plugins' +
    ' ' +
    'gets old-transaction commits from the store source after reinstalling undo',
  durableCase9
)

it(
  'durable logger plugins' + ' ' + 'rollback releases a staged undo identity without publishing it',
  durableCase10
)

it('contains option access failures before invoking transaction ports', durableCase11)
/** A real test output plugin uses the supported host authoring boundary. */
class EntryCapture {
  /** The test owns the collected array; the plugin only appends delivered entries. */
  readonly #entries: unknown[]
  /** Capture the test-owned output before host installation. */
  constructor(entries: unknown[]) {
    this.#entries = entries
  }
  /** The peer still owns sink revocation through this installation. */
  readonly plugin: ILogPlugin<Record<string, never>, Record<string, never>> = {
    name: 'test-capture',
    config: {},
    install: (core) => this.#install(core)
  }
  /** Register one actual output sink without adding a public host API. */
  #install(core: ILogPluginCore): Record<string, never> {
    core.useSink(this.#capture)
    return {}
  }
  /** Delivery preserves the complete native entry for the original assertions. */
  readonly #capture = (entry: ILogEntry): void => {
    this.#entries.push(entry)
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase1(): Promise<void> {
  const store = memoryLogStore()
  const entries: unknown[] = []
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store, echo: true }), new EntryCapture(entries).plugin]
  })
  await log.binlog.ready()
  const old = log.binlog
  const append = old.append
  expect(await log.binlog.append('created', { secret: 'business data' })).toBe(1)
  await log.flush()
  expect(entries).toMatchObject([
    { tag: 'binlog', message: 'created', meta: { seq: 1, time: expect.any(Number) } }
  ])
  expect(entries[0]).not.toHaveProperty('payload')
  const other = createLogHost({ execution, report: ignoreDiagnostic })
  await expect(other.use(binlogPlugin({ store }))).rejects.toBeDefined()
  await other.shutdown('manual')
  await log.unUse('binlog')
  await old.whenIdle()
  await expect(append('stale', null)).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'RUNTIME_SHUTTING_DOWN'
  })
  await expect(old.ready()).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'RUNTIME_SHUTTING_DOWN'
  })
  const [handle] = await log.use(binlogPlugin({ store }))
  await handle.extensions.binlog.ready()
  expect(await handle.extensions.binlog.lastSeq()).toBe(1)
  await expect(old.lastSeq()).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'RUNTIME_SHUTTING_DOWN'
  })
  await log.shutdown('manual')
  expect(await store.lastSeq()).toBe(1)
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase2(): Promise<void> {
  const store = memoryLogStore()
  await store.append([
    { kind: 'a', payload: 1 },
    { kind: 'b', payload: 2 }
  ])
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store })]
  })
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
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase3(): Promise<void> {
  const store = memoryLogStore()
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store })]
  })
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
  expect(failures.filter((value) => (value as { error: unknown }).error === original)).toHaveLength(
    1
  )
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
      error: expect.objectContaining({
        source: 'logging.durable',
        code: 'LOG_SUBSCRIPTION_TRUNCATED'
      })
    })
  )
  await log.shutdown('manual')
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase4(): Promise<void> {
  const store = memoryLogStore()
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [walPlugin({ store })]
  })
  await log.wal.ready()
  const first = await log.wal.begin('intent', { key: 'a' })
  const second = await log.wal.begin('intent', { key: 'b' })
  const results = await Promise.allSettled([log.wal.complete(first), log.wal.abort(first)])
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
  expect((await log.wal.pending()).map((row) => row.seq)).toEqual([second])
  await log.shutdown('manual')
  const reopened = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [walPlugin({ store })]
  })
  await reopened.wal.ready()
  expect((await reopened.wal.pending()).map((row) => row.seq)).toEqual([second])
  await reopened.wal.abort(second)
  expect(await reopened.wal.pending()).toEqual([])
  await reopened.shutdown('manual')
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase5(): Promise<void> {
  const store = memoryLogStore()
  const now = vi.spyOn(Date, 'now').mockReturnValue(100)
  try {
    const log = createLogHost({
      execution,
      report: ignoreDiagnostic,
      plugins: [undoLogPlugin({ store })]
    })
    await log.undo.ready()
    await log.undo.record('one', [{ target: 'a', before: null, after: { value: 1 } }])
    await log.undo.record('two', [{ target: 'b', before: 1, after: 2 }])
    await expect(log.undo.record('one', [])).rejects.toMatchObject({
      source: 'logging.durable',
      code: 'UNDO_RECORD_EXISTS'
    })
    const copy = await log.undo.get('one')
    ;(copy![0].after as { value: number }).value = 9
    expect(await log.undo.get('one')).toEqual([{ target: 'a', before: null, after: { value: 1 } }])
    expect(await log.undo.list({ sinceTime: 100 })).toEqual([
      { txId: 'two', time: 100 },
      { txId: 'one', time: 100 }
    ])
    expect(await log.undo.list({ limit: 0 })).toEqual([])
    await log.undo.forget('one')
    await log.undo.forget('missing')
    await log.shutdown('manual')
    const reopened = createLogHost({
      execution,
      report: ignoreDiagnostic,
      plugins: [undoLogPlugin({ store })]
    })
    await reopened.undo.ready()
    expect(await reopened.undo.get('one')).toBeUndefined()
    await reopened.undo.record('one', [])
    expect((await reopened.undo.list())[0].txId).toBe('one')
    await reopened.shutdown('manual')
  } finally {
    now.mockRestore()
    await store.dispose()
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase6(): Promise<void> {
  const store = memoryLogStore()
  await store.append([
    { kind: 'unrelated', payload: null },
    { kind: 'undo', payload: { txId: 'bad', images: [{ before: 1, after: 2 }] } }
  ])
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [undoLogPlugin({ store })]
  })
  await expect(log.undo.ready()).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'LOG_STORE_CORRUPT'
  })
  expect(await store.lastSeq()).toBe(2)
  const other = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store })]
  })
  await other.binlog.ready()
  await other.shutdown('manual')
  await log.shutdown('manual')
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase7(): Promise<void> {
  const store = memoryLogStore()
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store })]
  })
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
  ).rejects.toMatchObject({ source: 'logging.durable', code: 'INVALID_OPTION' })
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
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase8(): Promise<void> {
  const actual = memoryLogStore()
  const blocking = new BlockedRead(actual)
  const store: ILogStore = { ...actual, lastSeq: blocking.lastSeq }
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store })]
  })
  await log.binlog.ready()
  blocking.block()
  const ordinary = log.binlog.lastSeq()
  await vi.waitFor(() => expect(blocking.release).toBeTypeOf('function'))
  const transaction = transactionPort(store, async () => [1])
  expect(await log.binlog.append('immediate', null, { transaction: transaction.port })).toBe(1)
  blocking.release!()
  await ordinary
  await log.binlog.whenIdle()
  transaction.rollback()
  await log.shutdown('manual')
  await actual.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase9(): Promise<void> {
  const store = memoryLogStore()
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [undoLogPlugin({ store })]
  })
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
  const [handle] = await log.use(undoLogPlugin({ store }))
  await handle.extensions.undo.ready()
  await store.append(staged)
  transaction.commit()
  expect(await handle.extensions.undo.get('late')).toEqual([
    { target: 'a', before: null, after: 1 }
  ])
  await expect(handle.extensions.undo.record('late', [])).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'UNDO_RECORD_EXISTS'
  })
  await log.shutdown('manual')
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase10(): Promise<void> {
  const store = memoryLogStore()
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [undoLogPlugin({ store })]
  })
  await log.undo.ready()
  const transaction = transactionPort(store, async () => [1])
  await log.undo.record('reuse', [], { transaction: transaction.port })
  await expect(
    log.undo.record('reuse', [], { transaction: transaction.port })
  ).rejects.toMatchObject({ source: 'logging.durable', code: 'UNDO_RECORD_EXISTS' })
  expect(await log.undo.list()).toEqual([])
  transaction.rollback()
  await log.undo.record('reuse', [])
  expect((await log.undo.list()).map((row) => row.txId)).toEqual(['reuse'])
  await log.shutdown('manual')
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase11(): Promise<void> {
  const store = memoryLogStore()
  const log = createLogHost({
    execution,
    report: ignoreDiagnostic,
    plugins: [binlogPlugin({ store })]
  })
  await log.binlog.ready()
  const original = new Error('option getter failed')
  const options = {
    get transaction(): never {
      throw original
    }
  }
  await expect(log.binlog.append('invalid', null, options)).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'INVALID_OPTION',
    cause: original
  })
  const page = {
    get limit(): never {
      throw original
    }
  }
  await expect(log.binlog.read(1, page)).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'INVALID_OPTION',
    cause: original
  })
  expect(await log.binlog.lastSeq()).toBe(0)
  await log.shutdown('manual')
  await store.dispose()
}
