import { Logger } from '@migaia/logger'
import {
  binlog,
  wal,
  undoLog,
  memoryLogStore,
  assertLogInteger,
  snapshotLogRecords,
  prepareLogAppend,
  snapshotLogStoreState,
  createLogStoreIndex
} from '@migaia/logger/plugins/durable'
import { fileLogStore } from '@migaia/logger/plugins/durable/file'
import type { ILogStore } from '@migaia/logger/plugins/durable'

/** Native authors share index data without acquiring another queue, resource or close handle. */
export function compileCommittedIndexExample(): void {
  const snapshot = snapshotLogStoreState({ lastSeq: 0, time: 0, floor: 1 }, [])
  const index = createLogStoreIndex(snapshot)
  const batch = prepareLogAppend(
    snapshotLogRecords([{ kind: 'order.created', payload: { id: 'o1' } }]),
    index
  )
  console.log(index.lastSeq, batch[0]?.seq)
  // @ts-expect-error The author index does not own the adapter resource.
  void index.dispose
  // @ts-expect-error Captured records cannot acquire unsupported payloads.
  batch[0]!.payload = undefined
}

/** The maintained public examples compile against emitted package entries. */
export async function compilePluginExample(): Promise<void> {
  await using events = memoryLogStore()
  await using intents = memoryLogStore()
  await using images = memoryLogStore()
  const log = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]
  })
  try {
    await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])
    const seq = await log.binlog.append('order.created', { id: 'o1' })
    const off = log.binlog.subscribe(seq, (record) => console.log(record.seq))
    const intent = await log.wal.begin('save-order', { id: 'o1' })
    await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])
    await log.wal.complete(intent)
    console.log(await log.undo.get('tx1'))
    await log.undo.forget('tx1')
    off()
  } finally {
    try {
      await log.shutdown('manual')
    } finally {
      await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()])
    }
  }
}
/** File examples use the real file subpath and native asynchronous disposal contract. */
export async function compileFileExample(): Promise<void> {
  await using store = await fileLogStore('./orders.sqlite')
  await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])
  console.log(await store.lastSeq())
}
/** A custom store must preserve the complete atomic owner surface. */
export async function compileCustomExample(): Promise<void> {
  const delegate = memoryLogStore()
  // A custom implementation must preserve this single owner's atomic commit and notices.
  const custom: ILogStore = {
    append: (records) => delegate.append(records),
    read: (fromSeq, limit) => delegate.read(fromSeq, limit),
    lastSeq: () => delegate.lastSeq(),
    onAppend: (listener) => delegate.onAppend(listener),
    truncate: (beforeSeq) => delegate.truncate(beforeSeq),
    setState: (seq, state) => delegate.setState(seq, state),
    states: (filter) => delegate.states(filter),
    dispose: () => delegate.dispose(),
    [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()
  }
  await custom.append([{ kind: 'custom', payload: null }])
  await custom.dispose()
}

/** Static JSON admission retains named object types while excluding unsupported values. */
export async function compilePayloadDomain(): Promise<void> {
  type IOrder = { id: string; totals: readonly number[] }
  const store = memoryLogStore()
  const log = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [binlog({ store })]
  })
  const order: IOrder = { id: 'o1', totals: [1, 2] }
  await log.binlog.append('order', order)
  await log.binlog.appendBatch([
    { kind: 'one', payload: 1 },
    { kind: 'two', payload: { id: 'o2' } }
  ] as const)
  // @ts-expect-error Undefined is outside the JSON payload domain.
  await log.binlog.append('invalid', undefined)
  // @ts-expect-error Functions are outside the JSON payload domain.
  await log.binlog.append('invalid', { callback: () => undefined })
  const plain = new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  // @ts-expect-error A logger without binlog has no binlog API.
  void plain.binlog
  await plain.shutdown('manual')
  try {
    await log.shutdown('manual')
  } finally {
    await log.binlog.whenIdle()
    await store.dispose()
  }
}

/** Native adapters narrow unknown numeric inputs with the original logger admission. */
export function compileLogInteger(value: unknown): number {
  assertLogInteger(value, 0)
  return value
}
