import { setImmediate } from 'node:timers'
import { expect, it } from 'vitest'
import { createLogHost, levelPlugin, LogHostStatus } from '@migaia/log-host'
import { batchFeature, formatFeature, thresholdFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'
import { httpPlugin } from '@migaia/log-plugin-http'
import { filePlugin } from '@migaia/log-plugin-file'
import { processPlugin } from '@migaia/log-plugin-process'
import {
  binlogPlugin,
  walPlugin,
  undoLogPlugin,
  memoryLogStore,
  LogRecordState,
  type ILogStore
} from '@migaia/log-plugin-durable'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { storageJournalPlugin } from '@migaia/storage-host/plugins/journal'

/** Durable preparation keeps its original explicit execution-budget contract. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** The common wire identity proves all three outputs observe the same logical entries. */
type IWireEntry = { id: string; tag: string; message: string }

/** One injected capability owner records output and process effects without real I/O. */
class InjectedOutputs {
  /** The process extension reads its environment from the borrowed capability. */
  readonly env: Record<string, string | undefined> = {}
  /** Console JSON contains one entry per ordinary method call. */
  readonly consoleEntries: IWireEntry[] = []
  /** HTTP retains its unchanged entries envelope and batches. */
  readonly httpEntries: IWireEntry[] = []
  /** File delivery appends NDJSON without accessing a real filesystem. */
  readonly fileEntries: IWireEntry[] = []
  /** Exact listener identities expose real process registration cleanup. */
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  /** Exit is observable without terminating the test runner. */
  readonly exits: Array<number | undefined> = []
  /** Decode the host-selected JSON console format. */
  log(text: unknown): void {
    this.consoleEntries.push(JSON.parse(String(text)) as IWireEntry)
  }
  /** Warning severity uses the same injected destination. */
  warn(text: unknown): void {
    this.log(text)
  }
  /** Error severity uses the same injected destination. */
  error(text: unknown): void {
    this.log(text)
  }
  /** Receive exactly one HTTP attempt without making a network request. */
  async fetch(_url: string, init: { body: string }) {
    this.httpEntries.push(...(JSON.parse(init.body).entries as IWireEntry[]))
    return { ok: true, status: 200, headers: new Headers() }
  }
  /** Receive file batches while retaining each entry's public id. */
  async append(_path: string, text: string): Promise<void> {
    for (const line of text.trimEnd().split('\n'))
      this.fileEntries.push(JSON.parse(line) as IWireEntry)
  }
  /** Retain every original process listener on its actual borrowed object. */
  on(event: string, listener: (...args: unknown[]) => void): void {
    /** Each event owns one independently removable callback set. */
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }
  /** Remove only the callback registered by the process plugin. */
  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener)
  }
  /** Record graceful exit rather than forwarding to the real process. */
  exit(code?: number): void {
    this.exits.push(code)
  }
  /** Drive the installed public signal handler with its original listener identity. */
  fire(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}

/** Extract only common identity fields; formatting containers intentionally differ by output. */
function identity(entry: IWireEntry): IWireEntry {
  return { id: entry.id, tag: entry.tag, message: entry.message }
}

/** Return the rejected value without rebuilding it so native cause identity can be asserted. */
function rejectedValue(error: unknown): unknown {
  return error
}

/** Public outputs share host policies and retain the last signal-shutdown entry. */
async function composedOutputs(): Promise<void> {
  /** All runtime resources are injected and borrowed, including process exit. */
  const outputs = new InjectedOutputs()
  /** Failure observations must remain empty across ordinary delivery and graceful shutdown. */
  const failures: unknown[] = []
  /** A two-entry batch is shared by HTTP/file while console remains a single-entry transport. */
  const log = createLogHost({
    execution,
    report: (error) => failures.push(error),
    features: [
      thresholdFeature({ level: 'info' }),
      formatFeature({ format: 'json' }),
      batchFeature({ maxSize: 2 })
    ],
    plugins: [
      levelPlugin(),
      consolePlugin({ console: outputs }),
      httpPlugin({
        url: 'https://example.invalid/logs',
        fetcher: (url, init) => outputs.fetch(url, init)
      }),
      filePlugin({ path: 'application.ndjson', writer: outputs }),
      processPlugin({ process: outputs, shutdownTimeoutMs: 1000 })
    ]
  })
  log.onFailure(({ error }) => failures.push(error))
  log.onShutdown(() => log.info('final-entry'))
  try {
    log.debug('filtered-entry')
    log.info('created')
    log.warn('queued')
    await expect(log.flush()).resolves.toBeUndefined()
    expect(outputs.consoleEntries.map(identity)).toEqual(outputs.httpEntries.map(identity))
    expect(outputs.fileEntries.map(identity)).toEqual(outputs.httpEntries.map(identity))
    expect(outputs.consoleEntries.map((entry) => entry.message)).toEqual(['created', 'queued'])
    outputs.fire('SIGTERM')
    await expect(log.shutdown('signal')).resolves.toMatchObject({ logicalTerminal: true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(log.status).toBe(LogHostStatus.closed)
    expect(outputs.exits).toEqual([0])
    expect(outputs.consoleEntries.map((entry) => entry.message)).toEqual([
      'created',
      'queued',
      'final-entry'
    ])
    expect(outputs.consoleEntries.map(identity)).toEqual(outputs.httpEntries.map(identity))
    expect(outputs.fileEntries.map(identity)).toEqual(outputs.httpEntries.map(identity))
    for (const listeners of outputs.listeners.values()) expect(listeners.size).toBe(0)
    expect(failures).toEqual([])
  } finally {
    await log.shutdown('manual')
  }
}

/** Logging containment and durable rejection keep their distinct supported public boundaries. */
async function failureBoundaries(): Promise<void> {
  /** The original transport error must survive the HTTP wrapper by identity. */
  const transportFailure = new RangeError('offline integration transport')
  /** Only actual host failure observations count as delivery diagnostics. */
  const failures: unknown[] = []
  /** An authentic durable store receives no records when option admission fails. */
  const records = memoryLogStore()
  /** The ordinary host combines an injected failed transport with a real durable extension. */
  const log = createLogHost({
    execution,
    report: (error) => failures.push(error),
    plugins: [
      httpPlugin({
        url: 'https://example.invalid/logs',
        fetcher: async () => {
          throw transportFailure
        }
      }),
      binlogPlugin({ store: records })
    ]
  })
  log.onFailure(({ error }) => failures.push(error))
  try {
    await log.binlog.ready()
    expect(() => log.log('info', 'business continues')).not.toThrow()
    await expect(log.flush()).resolves.toBeUndefined()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      source: 'logging.http',
      code: 'DELIVERY_FAILED',
      cause: transportFailure
    })
    expect((failures[0] as Error).cause).toBe(transportFailure)
    /** A supported accessor failure proves durable rejection retains the original cause. */
    const original = new TypeError('durable option getter failed')
    /** Admission must read the actual public transaction option rather than a fake append port. */
    const options = {
      get transaction(): never {
        throw original
      }
    }
    /** A real rejection stays distinguishable from a successfully allocated sequence. */
    const rejection = await log.binlog.append('invalid', null, options).catch(rejectedValue)
    expect(rejection).toMatchObject({
      source: 'logging.durable',
      code: 'INVALID_OPTION',
      cause: original
    })
    expect((rejection as Error).cause).toBe(original)
    expect(await records.lastSeq()).toBe(0)
    await expect(log.shutdown('manual')).resolves.toMatchObject({ logicalTerminal: true })
  } finally {
    await log.shutdown('manual')
    await records.dispose()
  }
}

/** The public initializer supplies authentic native log handles to storage's own transaction. */
function journalLogger(records: ILogStore, images: ILogStore) {
  return createLogHost({
    execution,
    plugins: [binlogPlugin({ store: records }), undoLogPlugin({ store: images })]
  })
}

/** One committed business transaction produces binlog/undo and undo performs a new real commit. */
async function nativeJournal(): Promise<void> {
  /** The borrowed logger remains application-owned after the storage host is disposed. */
  let logger: ReturnType<typeof journalLogger> | undefined
  /** Native handles are created by the installed memory backend, never structural mock ports. */
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin(async ({ storageLogStore }) => {
        /** Binlog metadata joins the same native commit as the business write. */
        const records = await storageLogStore('memory', { prefix: 'integration-binlog' })
        /** Undo keeps complete before/after images outside business keyspace. */
        const images = await storageLogStore('memory', { prefix: 'integration-undo' })
        logger = journalLogger(records, images)
        return {
          logger,
          namespace: 'integration',
          atomicBinlog: { memory: records },
          atomicUndo: { memory: images }
        }
      }),
      memoryBackendPlugin()
    ]
  })
  try {
    /** All mutations run through the highest public storage transaction seam. */
    const store = host.backend('memory')
    await store.set('order', 'before')
    await store.transaction(async (scope) => {
      await scope.set('order', 'intermediate')
      await scope.set('order', 'committed')
    })
    expect(await store.get('order')).toBe('committed')
    /** Initial set and the two-write transaction publish exactly two original commits. */
    const commits = await logger!.binlog.read(1)
    expect(commits).toHaveLength(2)
    expect(commits[1]!.kind).toBe('storage.commit')
    /** The transaction id is public journal payload data, not a private bridge handle. */
    const payload = commits[1]!.payload as { txId: string; changes: unknown[] }
    expect(payload.changes).toHaveLength(2)
    expect(await logger!.undo.get(payload.txId)).toHaveLength(1)
    /** Undo authenticates the stored revision and restores the actual original before image. */
    const restored = await store.undo(payload.txId)
    expect(restored.txId).not.toBe(payload.txId)
    expect(await store.get('order')).toBe('before')
    expect(await logger!.binlog.read(1)).toHaveLength(3)
    /** Rollback still rejects and must not publish provisional business or journal changes. */
    const original = new RangeError('rollback integration transaction')
    await expect(
      store.transaction(async (scope) => {
        await scope.set('order', 'rolled-back')
        throw original
      })
    ).rejects.toMatchObject({ cause: original })
    expect(await store.get('order')).toBe('before')
    expect(await logger!.binlog.read(1)).toHaveLength(3)
  } finally {
    await logger?.shutdown('manual')
    await host.dispose()
  }
}

/** External durable WAL must actually write and finish an intent for a public business commit. */
async function externalWalJournal(): Promise<void> {
  /** These stores are real durable resources owned and disposed by the application. */
  const records = memoryLogStore()
  /** A separate physical intent store proves WAL was used instead of merely installed. */
  const intents = memoryLogStore()
  /** Both extensions are passed unchanged through the public journal configuration. */
  const logger = createLogHost({
    execution,
    plugins: [binlogPlugin({ store: records }), walPlugin({ store: intents })]
  })
  /** Omitting atomicBinlog deliberately selects the existing external-WAL commit path. */
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin({ logger, namespace: 'external-integration', redoWal: logger.wal }),
      memoryBackendPlugin()
    ]
  })
  try {
    /** This transaction belongs to storage and its actual terminal completes the WAL intent. */
    const store = host.backend('memory')
    await store.transaction(async (scope) => {
      await scope.set('order', 'durable')
    })
    expect(await store.get('order')).toBe('durable')
    expect((await logger.binlog.read(1))[0]?.kind).toBe('storage.commit')
    expect(await records.lastSeq()).toBe(1)
    expect(await intents.lastSeq()).toBeGreaterThan(0)
    expect(await intents.states(LogRecordState.pending)).toEqual([])
    expect(await logger.wal.pending()).toEqual([])
  } finally {
    await logger.shutdown('manual')
    await host.dispose()
    await Promise.all([records.dispose(), intents.dispose()])
  }
}

it('composes public outputs, level policy and injected signal shutdown', composedOutputs)
it(
  'contains logging failures while durable operations reject with original causes',
  failureBoundaries
)
it('commits and undoes real native storage journal transactions', nativeJournal)
it('finishes real external WAL intents after the storage terminal', externalWalJournal)
