import { expect, it, vi } from 'vitest'

import { DatabaseSync } from 'node:sqlite'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { fileLogStore } from '../src/file.ts'

import { asyncDisposeKey } from '@migaia/plugin-host'

import { deferred } from '@migaia/utils/promise'

import {
  assertLogInteger,
  memoryLogStore,
  LogRecordState,
  snapshotLogRecords,
  prepareLogAppend,
  snapshotLogStoreState,
  createLogStoreIndex,
  type ILogRecord
} from '../src/index.ts'

it(
  'native committed index authoring' +
    ' ' +
    'retains original integer admission for native adapters',
  durableCase1
)

it(
  'native committed index authoring' +
    ' ' +
    'shares the original index only after actual asynchronous commit and leaves rollback invisible',
  durableCase2
)

it(
  'native committed index authoring' +
    ' ' +
    'keeps recovery validation before row I/O and preserves payload corruption causes',
  durableCase3
)

it(
  'durable stores' +
    ' ' +
    'commits concurrent batches in admission order and preserves its high watermark',
  durableCase4
)

it(
  'durable stores' +
    ' ' +
    'snapshots input before FIFO admission and rejects an entire invalid batch',
  durableCase5
)
for (const [name, create] of [
  ['memory', async (_path: string) => memoryLogStore()],
  ['SQLite', fileLogStore]
] as const) {
  it(
    `${name} durable contract` +
      ' ' +
      'commits whole batches, publishes one frozen notice, and persists terminal state',
    () => durableCase6(create)
  )

  it(
    `${name} durable contract` +
      ' ' +
      'captures safe JSON without getters, rejects holes and cycles, and copies shared subtrees',
    () => durableCase7(create)
  )
}

it(
  'SQLite durable resource' +
    ' ' +
    'retains the exclusive connection lock, reopens watermarks, and continues after complete truncation',
  durableCase8
)

it(
  'SQLite durable resource' +
    ' ' +
    'rejects corrupt databases with the original native error as cause',
  durableCase9
)

it(
  'SQLite durable resource' + ' ' + 'caches explicit and symbolic cleanup promises separately',
  durableCase10
)

it(
  'codes reflection failures without admitting a record and retains the original cause',
  durableCase11
)

it('publishes disposal promises before a close observer can reenter', durableCase12)

it('shares one failed cleanup while symbolic disposal reports once and resolves', durableCase13)

it(
  'stops admission after an uncertain COMMIT and reopens the actual committed result without replay',
  durableCase14
)

/** Preserve the migrated durable case and every original assertion. */
function durableCase1(): void {
  expect(() => assertLogInteger(0, 0)).not.toThrow()
  expect(() => assertLogInteger(0)).toThrowError(
    expect.objectContaining({
      source: 'logging.durable',
      code: 'INVALID_OPTION',
      name: 'RangeError'
    })
  )
  expect(() => assertLogInteger(Number.MAX_SAFE_INTEGER + 1)).toThrowError(
    expect.objectContaining({
      source: 'logging.durable',
      code: 'LOG_SEQUENCE_EXHAUSTED',
      name: 'RangeError'
    })
  )
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase2(): Promise<void> {
  const database = new DatabaseSync(':memory:')
  database.exec(
    'CREATE TABLE committed(seq INTEGER PRIMARY KEY, time REAL, kind TEXT, payload TEXT, state TEXT)'
  )
  const insert = database.prepare('INSERT INTO committed VALUES(?, ?, ?, ?, ?)')
  const index = createLogStoreIndex()
  const gate = deferred<void>()
  const payload = { value: 1 }
  const captured = snapshotLogRecords([{ kind: 'native', payload }])
  payload.value = 2
  const batch = prepareLogAppend(captured, index, 100)
  try {
    const commit = (async () => {
      database.exec('BEGIN')
      for (const row of batch)
        insert.run(row.seq, row.time, row.kind, JSON.stringify(row.payload), LogRecordState.pending)
      await gate.promise
      database.exec('COMMIT')
      index.applyAppend(batch)
    })()
    expect(index.lastSeq).toBe(0)
    expect(index.read(1, 10)).toEqual([])
    expect(index.pending()).toEqual([])
    gate.resolve()
    await commit
    expect(index.lastSeq).toBe(1)
    expect(index.read(1, 10)).toEqual([
      { seq: 1, time: 100, kind: 'native', payload: { value: 1 } }
    ])
    const rolledBack = prepareLogAppend(
      snapshotLogRecords([{ kind: 'rollback', payload: null }]),
      index,
      90
    )
    database.exec('BEGIN')
    for (const row of rolledBack)
      insert.run(row.seq, row.time, row.kind, JSON.stringify(row.payload), LogRecordState.pending)
    database.exec('ROLLBACK')
    expect(index.lastSeq).toBe(1)
    expect(index.pending()).toEqual([1])
    expect(
      prepareLogAppend(snapshotLogRecords([{ kind: 'next', payload: null }]), index, 90)[0]
    ).toMatchObject({ seq: 2, time: 100 })
    const snapshot = snapshotLogStoreState(
      index,
      database.prepare('SELECT * FROM committed ORDER BY seq').all() as (ILogRecord & {
        state: LogRecordState
      })[],
      (value) => JSON.parse(value as string)
    )
    const recovered = createLogStoreIndex(snapshot)
    expect(recovered.read(1, 10)).toEqual(index.read(1, 10))
    expect(recovered.pending()).toEqual([1])
    if (recovered.checkState(1, LogRecordState.done)) recovered.applyState(1, LogRecordState.done)
    expect(recovered.pending()).toEqual([])
    if (recovered.checkTruncate(2)) recovered.applyTruncate(2)
    expect(recovered.read(1, 10)).toEqual([])
    expect(recovered.lastSeq).toBe(1)
    expect(recovered.floor).toBe(2)
  } finally {
    database.close()
  }
}

/** Preserve the migrated durable case and every original assertion. */
function durableCase3(): void {
  let visits = 0
  const rows = {
    *[Symbol.iterator]() {
      visits++
      yield { seq: 1, time: 1, kind: 'one', payload: null, state: LogRecordState.pending }
    }
  }
  expect(() => snapshotLogStoreState({ lastSeq: -1, time: 1, floor: 1 }, rows)).toThrowError(
    expect.objectContaining({ source: 'logging.durable', code: 'LOG_STORE_CORRUPT' })
  )
  expect(visits).toBe(0)
  const cause = new SyntaxError('native payload is corrupt')
  const decoder = new FailingDecoder(cause)
  expect(() =>
    snapshotLogStoreState({ lastSeq: 1, time: 1, floor: 1 }, rows, decoder.decode)
  ).toThrowError(
    expect.objectContaining({ source: 'logging.durable', code: 'LOG_STORE_CORRUPT', cause })
  )
  const clock = vi.spyOn(Date, 'now')
  try {
    expect(prepareLogAppend([], { lastSeq: 0, time: 0 })).toEqual([])
    expect(() =>
      prepareLogAppend(snapshotLogRecords([{ kind: 'one', payload: null }]), {
        lastSeq: Number.MAX_SAFE_INTEGER,
        time: 0
      })
    ).toThrowError(
      expect.objectContaining({ source: 'logging.durable', code: 'LOG_SEQUENCE_EXHAUSTED' })
    )
    expect(clock).not.toHaveBeenCalled()
  } finally {
    clock.mockRestore()
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase4(): Promise<void> {
  const store = memoryLogStore()
  await Promise.all(
    Array.from({ length: 100 }, (_, index) => store.append([{ kind: 'entry', payload: { index } }]))
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
    source: 'logging.durable',
    code: 'WAL_RECORD_INVALID'
  })
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase5(): Promise<void> {
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
  ).rejects.toMatchObject({ source: 'logging.durable', code: 'LOG_PAYLOAD_INVALID' })
  expect(await store.lastSeq()).toBe(1)
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase6(
  create: (
    path: string
  ) => import('../src/types.ts').ILogStore | Promise<import('../src/types.ts').ILogStore>
): Promise<void> {
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
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase7(
  create: (
    path: string
  ) => import('../src/types.ts').ILogStore | Promise<import('../src/types.ts').ILogStore>
): Promise<void> {
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
        source: 'logging.durable',
        code: 'LOG_PAYLOAD_INVALID'
      })
    expect(getterCalls).toBe(0)
    expect(await store.lastSeq()).toBe(1)
  } finally {
    await store.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase8(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'logger-file-'))
  const path = join(directory, 'log.sqlite')
  let store = await fileLogStore(path)
  try {
    await store.append(Array.from({ length: 10 }, () => ({ kind: 'a', payload: null })))
    await expect(fileLogStore(path)).rejects.toMatchObject({
      source: 'logging.durable',
      code: 'LOG_STORE_LOCKED'
    })
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
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase9(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'logger-corrupt-'))
  const path = join(directory, 'log.sqlite')
  try {
    await writeFile(path, 'this is not sqlite')
    await expect(fileLogStore(path)).rejects.toMatchObject({
      source: 'logging.durable',
      code: 'LOG_STORE_CORRUPT',
      cause: expect.any(Error)
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase10(): Promise<void> {
  const store = memoryLogStore()
  await store.append([{ kind: 'a', payload: null }])
  const explicit = store.dispose()
  const symbolic = store[asyncDisposeKey]()
  expect(store.dispose()).toBe(explicit)
  expect(store[asyncDisposeKey]()).toBe(symbolic)
  expect(symbolic).not.toBe(explicit)
  await Promise.all([explicit, symbolic])
  await expect(store.lastSeq()).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'RUNTIME_SHUTTING_DOWN'
  })
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase11(): Promise<void> {
  const store = memoryLogStore()
  const original = new Error('payload reflection failed')
  const payload = new Proxy(
    { value: 1 },
    {
      ownKeys() {
        throw original
      }
    }
  )
  await expect(store.append([{ kind: 'bad', payload }])).rejects.toMatchObject({
    source: 'logging.durable',
    code: 'LOG_PAYLOAD_INVALID',
    cause: original
  })
  expect(await store.lastSeq()).toBe(0)
  await store.dispose()
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase12(): Promise<void> {
  let reentered: Promise<void> | undefined
  const store = memoryLogStore({
    observe: (event) => {
      if (event.stage === 'beforeLogClose') reentered = store.dispose()
    }
  })
  const completion = store.dispose()
  expect(reentered).toBe(completion)
  await completion
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase13(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'logger-close-failure-'))
  const reports: unknown[] = []
  const store = await fileLogStore(join(directory, 'log.sqlite'), {
    report: (error) => {
      reports.push(error)
    }
  })
  const original = new Error('native close failed after releasing connection')
  const close = DatabaseSync.prototype.close
  const replacement = vi
    .spyOn(DatabaseSync.prototype, 'close')
    .mockImplementationOnce(function (this: DatabaseSync) {
      Reflect.apply(close, this, [])
      throw original
    })
  try {
    const explicit = store.dispose()
    const symbolic = store[asyncDisposeKey]()
    expect(store.dispose()).toBe(explicit)
    expect(store[asyncDisposeKey]()).toBe(symbolic)
    expect(symbolic).not.toBe(explicit)
    await expect(explicit).rejects.toMatchObject({
      source: 'logging.durable',
      code: 'LOG_STORE_IO_FAILED',
      cause: original
    })
    await symbolic
    expect(replacement).toHaveBeenCalledOnce()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ cause: original })
  } finally {
    replacement.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase14(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'logger-uncertain-commit-'))
  const path = join(directory, 'log.sqlite')
  let store = await fileLogStore(path)
  const original = new Error('commit acknowledged ambiguously')
  const exec = DatabaseSync.prototype.exec
  let armed = true
  const replacement = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
    this: DatabaseSync,
    sql: string
  ) {
    Reflect.apply(exec, this, [sql])
    if (sql === 'COMMIT' && armed) {
      armed = false
      throw original
    }
  })
  try {
    await expect(
      store.append([
        { kind: 'a', payload: 1 },
        { kind: 'b', payload: 2 }
      ])
    ).rejects.toMatchObject({
      source: 'logging.durable',
      code: 'LOG_STORE_IO_FAILED',
      cause: original
    })
    await expect(store.lastSeq()).rejects.toMatchObject({
      source: 'logging.durable',
      code: 'LOG_STORE_IO_FAILED',
      cause: original
    })
    await store.dispose()
    replacement.mockRestore()
    store = await fileLogStore(path)
    expect(await store.lastSeq()).toBe(2)
    expect((await store.read(1, 10)).map((record) => record.seq)).toEqual([1, 2])
    expect(await store.append([{ kind: 'c', payload: 3 }])).toEqual([3])
  } finally {
    replacement.mockRestore()
    await store.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}

/** Preserve the exact original native decoder error without a nested assertion callback. */
class FailingDecoder {
  /** Recovery must retain this exact SyntaxError as its cause. */
  readonly #cause: SyntaxError
  /** Capture the real decoder failure used by the existing assertion. */
  constructor(cause: SyntaxError) {
    this.#cause = cause
  }
  /** The standalone callback has no receiver requirements. */
  readonly decode = (): never => {
    throw this.#cause
  }
}
