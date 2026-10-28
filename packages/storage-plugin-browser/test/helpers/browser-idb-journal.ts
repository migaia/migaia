import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/plugins/journal'
import { indexedDbTestFeatures } from './indexed-db-features.ts'
import { Logger } from '@migaia/logger'
import { binlog, undoLog } from '@migaia/logger/plugins/durable'
import { createOrgId, createStorageHost } from '@migaia/storage-host'
import { decodeFlatStorageKey } from '@migaia/storage-host/sdk'
import { indexedDbBackendPlugin } from '../../src/indexed-db.ts'

/** Each page retains only its own original host and borrowed log until explicit fixture cleanup. */
let current:
  | {
      readonly close: () => Promise<void>
      readonly append: () => Promise<readonly number[]>
      readonly lastSeq: () => Promise<number>
    }
  | undefined

/** Actual native Web Locks must exclude a second page before it can read a cached journal index. */
async function openIndexedDbJournal(dbName: string, wrapFactory = false): Promise<number | string> {
  /** This distinct legal factory object still forwards the exact same persistent browser database. */
  const factory: IDBFactory | undefined = wrapFactory
    ? {
        open: (name, version) => indexedDB.open(name, version),
        deleteDatabase: (name) => indexedDB.deleteDatabase(name),
        databases: () => indexedDB.databases(),
        cmp: (first, second) => indexedDB.cmp(first, second)
      }
    : undefined
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin(),
      indexedDbBackendPlugin({ dbName, factory }, indexedDbTestFeatures)
    ]
  })
  try {
    const log = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
    current = {
      append: () => log.append([{ kind: 'browser', payload: null }]),
      lastSeq: () => log.lastSeq(),
      close: async () => {
        await log.dispose()
        await host.dispose()
      }
    }
    return await log.lastSeq()
  } catch (error) {
    await host.dispose()
    return (error as { code: string }).code
  }
}

/** Fixture calls preserve actual native commit/reopen behavior without manufacturing a lock port. */
async function appendIndexedDbJournal() {
  const appended = await current!.append()
  return { appended, lastSeq: await current!.lastSeq() }
}

/** Release through the original resource owner; the next page must then acquire that exact lock. */
async function closeIndexedDbJournal() {
  const previous = current
  current = undefined
  await previous?.close()
}

/** The actual native durable plugins retain their original inferred logger surface. */
const createNativeJournalLogger = (
  records: Parameters<typeof binlog>[0]['store'],
  images: Parameters<typeof undoLog>[0]['store']
) =>
  new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [binlog({ store: records }), undoLog({ store: images })]
  })

/** Actual browser activity windows must permit native logs and undo without another terminal. */
async function runIndexedDbGlobalJournal(dbName: string) {
  const loggers: Array<ReturnType<typeof createNativeJournalLogger>> = []
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin(async ({ storageLogStore }) => {
        const records = await storageLogStore('indexed-db', { prefix: 'binlog' })
        const images = await storageLogStore('indexed-db', { prefix: 'undo' })
        const logger = createNativeJournalLogger(records, images)
        loggers.push(logger)
        return {
          logger,
          namespace: 'browser',
          indexedDbUndo: true,
          atomicBinlog: { 'indexed-db': records },
          atomicUndo: { 'indexed-db': images }
        }
      }),
      indexedDbBackendPlugin({ dbName }, indexedDbTestFeatures)
    ]
  })
  try {
    const store = host.org(createOrgId()).backend('indexed-db')
    await store.transaction(async (scope) => {
      await scope.set('text', 'one')
      await scope.setBytes('bytes', new Uint8Array([1, 2]))
      await scope.set('text', 'two')
      await scope.putRecord({ value: 'native' }, 'record')
    })
    const logger = loggers.at(-1)!
    const payload = (await logger.binlog.read(1))[0]!.payload as {
      txId: string
      changes: Array<{ target: { channel: string; key: string } }>
    }
    const changes = payload.changes.map(({ target }) => [
      target.channel,
      decodeFlatStorageKey(target.key)
    ])
    const error = await store
      .transaction(async (scope) => {
        await scope.set('text', 'discard')
        throw new RangeError('native browser journal rollback')
      })
      .then(
        () => undefined,
        (failure: unknown) => failure
      )
    const rollback =
      error !== undefined &&
      (await store.get('text')) === 'two' &&
      (await logger.binlog.read(1)).length === 1
    await store.undo(payload.txId)
    return {
      changes,
      rollback,
      restored:
        (await store.get('text')) === null &&
        (await store.getBytes('bytes')) === null &&
        (await store.getRecord('record')) === undefined,
      commits: (await logger.binlog.read(1)).length,
      isolated: (await host.backend('indexed-db').get('text')) === null
    }
  } finally {
    for (const logger of loggers) await logger.shutdown('manual')
    await host.dispose()
  }
}

/** Declaration merging adds only the existing browser harness's callable fixture hooks. */
declare global {
  interface Window {
    runIndexedDbGlobalJournal: typeof runIndexedDbGlobalJournal
    openIndexedDbJournal: typeof openIndexedDbJournal
    appendIndexedDbJournal: typeof appendIndexedDbJournal
    closeIndexedDbJournal: typeof closeIndexedDbJournal
  }
}
Object.assign(window, {
  runIndexedDbGlobalJournal,
  openIndexedDbJournal,
  appendIndexedDbJournal,
  closeIndexedDbJournal
})
