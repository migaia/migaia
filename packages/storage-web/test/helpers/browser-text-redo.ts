import { Logger, type ILoggerCore } from '@migaia/logger'
import { wal, type IWalExt } from '@migaia/logger/plugins/durable'
import { walkErrorCauses } from '@migaia/utils/error'
import { kv } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { localStorageBackendPlugin } from '../../src/local-storage.js'

/** The opener retains the actual WAL object and its sole persistent native resource. */
type ITextRedoLogger = Pick<
  ILoggerCore,
  'dispatchRaw' | 'onFailure' | 'hook' | 'flush' | 'defer' | 'shutdown'
> &
  IWalExt
/** The opener alone retains this original logger and native resource lifetime. */
type ITextRedoOwner = {
  readonly logger: ReturnType<typeof createLogger>
  readonly namespace: string
  close(): Promise<void>
}
/** Durable storage remains the original IDB namespace resource, never a second page-local cache. */
const createLogger = (store: Awaited<ReturnType<typeof storageLogStore>>): ITextRedoLogger =>
  new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [wal({ store })]
  })

/** Open one real persistent carrier; only this page owns its lifetime. */
async function prepareTextRedoOwner(namespace: string, dbName: string) {
  const carrierHost = await createStorageHost({ plugins: [indexedDbBackendPlugin({ dbName })] })
  const carrier = await storageLogStore(carrierHost, 'indexed-db', { prefix: 'wal' })
  const logger = createLogger(carrier)
  await logger.wal.ready()
  window.textRedoOwner = {
    logger,
    namespace,
    close: async () => {
      await logger.shutdown('manual')
      await carrier.dispose()
      await carrierHost.dispose()
    }
  }
  return { pending: (await logger.wal.pending()).length, lastSeq: await carrier.lastSeq() }
}

/** Fail the second real Storage assignment after the durable intent has already been appended. */
async function failTextRedoAssignment() {
  const owner = window.textRedoOwner!
  const created = await createStorageHost({
    plugins: [localStorageBackendPlugin({ namespace: owner.namespace, redo: true })],
    journal: { logger: owner.logger, namespace: owner.namespace, redoWal: owner.logger.wal }
  }).then(
    (host) => ({ host }),
    (error: unknown) => ({
      failure: walkErrorCauses(error).map((error) =>
        typeof error === 'object' && error !== null
          ? {
              source: (error as { source?: string }).source,
              code: (error as { code?: string }).code,
              name: (error as Error).name,
              message: (error as Error).message
            }
          : { message: String(error) }
      )
    })
  )
  if ('failure' in created) return created
  const { host } = created
  const native = Storage.prototype.setItem
  let calls = 0
  Storage.prototype.setItem = function (key, value) {
    if (++calls === 2)
      throw new DOMException('native redo assignment failure', 'QuotaExceededError')
    Reflect.apply(native, this, [key, value])
  }
  try {
    let code: string | undefined
    try {
      await host
        .backend('local')
        .use(kv)
        .setMany([
          { key: 'a', value: 'first' },
          { key: 'b', value: 'second' }
        ])
    } catch (error) {
      code = (error as { code?: string }).code
    }
    return { code, pending: (await owner.logger.wal.pending()).length, assignments: calls }
  } finally {
    Storage.prototype.setItem = native
    await host.dispose()
  }
}

/** Borrow the opener's exact logger object through same-origin access; no transport/cache is added. */
async function recoverTextRedoFromOpener() {
  const owner = (window.opener as Window).textRedoOwner!
  const logger = owner.logger
  const selected = logger.wal
  const host = await createStorageHost({
    plugins: [localStorageBackendPlugin({ namespace: owner.namespace, redo: true })],
    journal: { logger, namespace: owner.namespace, redoWal: selected }
  })
  try {
    return {
      sameLogger: logger === (window.opener as Window).textRedoOwner!.logger,
      sameWal: selected === (window.opener as Window).textRedoOwner!.logger.wal,
      values: await host.backend('local').use(kv).getMany(['a', 'b']),
      pending: (await selected.pending()).length
    }
  } finally {
    await host.dispose()
  }
}

/** A fresh page owner may reopen only after the original persistent resource is fully released. */
async function closeTextRedoOwner() {
  const owner = window.textRedoOwner
  window.textRedoOwner = undefined
  await owner?.close()
}

declare global {
  interface Window {
    textRedoOwner?: ITextRedoOwner
    prepareTextRedoOwner: typeof prepareTextRedoOwner
    failTextRedoAssignment: typeof failTextRedoAssignment
    recoverTextRedoFromOpener: typeof recoverTextRedoFromOpener
    closeTextRedoOwner: typeof closeTextRedoOwner
  }
}

window.prepareTextRedoOwner = prepareTextRedoOwner
window.failTextRedoAssignment = failTextRedoAssignment
window.recoverTextRedoFromOpener = recoverTextRedoFromOpener
window.closeTextRedoOwner = closeTextRedoOwner
