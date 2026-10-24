import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { fromIdbRequest, idbTransactionCommit } from '../../src/utils/idb-request.js'
import { createStorageOperationRuntime } from '@migaia/storage-host/authoring/backend'
import { captureOperationCleanup } from '../helpers/operation-reporter.js'

const openDb = (): Promise<IDBDatabase> => {
  const factory = new IDBFactory()
  return new Promise((resolve) => {
    const request = factory.open(`idb-request-test-${Math.random().toString(36).slice(2)}`)
    request.onupgradeneeded = () => request.result.createObjectStore('kv')
    request.onsuccess = () => resolve(request.result)
  })
}

describe('fromIdbRequest', () => {
  it('resolves with request.result on success', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('v', 'k')
    await idbTransactionCommit(tx, undefined, createStorageOperationRuntime())
    await expect(
      fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('k'),
        undefined,
        createStorageOperationRuntime()
      )
    ).resolves.toBe('v')
  })
  it('rejects when the request errors', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    const pending = fromIdbRequest(
      tx.objectStore('kv').put('v', 'k'),
      undefined,
      createStorageOperationRuntime()
    )
    tx.abort()
    await expect(pending).rejects.toBeDefined()
  })
  it('已 abort 的 signal 立即拒绝', async () => {
    const db = await openDb()
    const controller = new AbortController()
    controller.abort('reason')
    await expect(
      fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('k'),
        { signal: controller.signal },
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('mid-flight abort 通过 addEventListener 触发拒绝', async () => {
    const db = await openDb()
    const controller = new AbortController()
    const pending = fromIdbRequest(
      db.transaction('kv').objectStore('kv').get('k'),
      {
        signal: controller.signal
      },
      createStorageOperationRuntime()
    )
    controller.abort('mid-flight')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('不会丢失 check-subscribe 窗口内的 abort', async () => {
    const db = await openDb()
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      reason: 'request race',
      addEventListener: () => {
        aborted = true
      },
      removeEventListener: () => {}
    }
    await expect(
      fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('k'),
        {
          signal: signal as never
        },
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('listener setup/cleanup 异常遵循共享 operation 协议', async () => {
    const db = await openDb()
    await expect(
      fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('missing'),
        {
          signal: {
            aborted: false,
            addEventListener: () => {
              throw new Error('hostile request listener setup')
            },
            removeEventListener: () => {}
          } as never
        },
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const cleanup = await captureOperationCleanup(() =>
      fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('missing'),
        {
          signal: {
            aborted: false,
            addEventListener: () => {},
            removeEventListener: () => {
              throw new Error('hostile request listener cleanup')
            }
          } as never
        },
        createStorageOperationRuntime()
      )
    )
    expect(cleanup.result).toBeUndefined()
    expect(cleanup.reports).toEqual([
      expect.objectContaining({ message: 'hostile request listener cleanup' })
    ])
  })
})

describe('idbTransactionCommit', () => {
  it('resolves on oncomplete', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('v', 'k')
    await expect(
      idbTransactionCommit(tx, undefined, createStorageOperationRuntime())
    ).resolves.toBeUndefined()
  })
  it('rejects on onabort', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('v', 'k')
    const pending = idbTransactionCommit(tx, undefined, createStorageOperationRuntime())
    tx.abort()
    await expect(pending).rejects.toBeDefined()
  })
  it('非 signal abort 不归类为 ABORTED', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('v', 'k')
    const pending = idbTransactionCommit(tx, undefined, createStorageOperationRuntime())
    tx.abort()
    await expect(pending).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })
  it('已 abort 的 signal 在真实 rollback 后拒绝', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    const controller = new AbortController()
    controller.abort('reason')
    await expect(
      idbTransactionCommit(tx, { signal: controller.signal }, createStorageOperationRuntime())
    ).rejects.toMatchObject({
      code: 'ABORTED'
    })
  })
  it('mid-flight abort 通过 addEventListener 触发拒绝', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('v', 'k')
    const controller = new AbortController()
    const pending = idbTransactionCommit(
      tx,
      { signal: controller.signal },
      createStorageOperationRuntime()
    )
    controller.abort('mid-flight')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('keeps cancellation pending until the original native abort event', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('uncommitted', 'key')
    const controller = new AbortController()
    const reason = new Error('native cancellation')
    const pending = idbTransactionCommit(
      tx,
      { signal: controller.signal },
      createStorageOperationRuntime()
    )
    let terminal = false
    let settled = false
    tx.addEventListener('abort', () => {
      terminal = true
    })
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    controller.abort(reason)
    await Promise.resolve()
    expect(terminal).toBe(false)
    expect(settled).toBe(false)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
    expect(terminal).toBe(true)
    expect(
      await fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('key'),
        undefined,
        createStorageOperationRuntime()
      )
    ).toBeUndefined()
  })
  it('retains the first request error but waits for actual completion when preventDefault permits commit', async () => {
    const db = await openDb()
    const seed = db.transaction('kv', 'readwrite')
    seed.objectStore('kv').put('original', 'existing')
    await idbTransactionCommit(seed, undefined, createStorageOperationRuntime())
    const tx = db.transaction('kv', 'readwrite')
    const failed = tx.objectStore('kv').add('duplicate', 'existing')
    tx.objectStore('kv').put('committed', 'other')
    tx.addEventListener('error', (event) => {
      event.preventDefault()
    })
    const pending = idbTransactionCommit(tx, undefined, createStorageOperationRuntime())
    let terminal = false
    tx.addEventListener('complete', () => {
      terminal = true
    })
    const failure = await pending.catch((error: unknown) => error)
    expect(terminal).toBe(true)
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED', cause: failed.error })
    expect((failure as Error).cause).toBeInstanceOf(DOMException)
    expect(
      await fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('other'),
        undefined,
        createStorageOperationRuntime()
      )
    ).toBe('committed')
  })
  it('不会丢失 check-subscribe 窗口内的 abort', async () => {
    const db = await openDb()
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put('v', 'k')
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      reason: 'transaction race',
      addEventListener: () => {
        aborted = true
      },
      removeEventListener: () => {}
    }
    await expect(
      idbTransactionCommit(
        tx,
        {
          signal: signal as never
        },
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('transaction listener setup/cleanup 异常遵循共享 operation 协议', async () => {
    const db = await openDb()
    const setupTransaction = db.transaction('kv', 'readwrite')
    setupTransaction.objectStore('kv').put('setup', 'setup')
    await expect(
      idbTransactionCommit(
        setupTransaction,
        {
          signal: {
            aborted: false,
            addEventListener: () => {
              throw new Error('hostile transaction listener setup')
            },
            removeEventListener: () => {}
          } as never
        },
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      fromIdbRequest(
        db.transaction('kv').objectStore('kv').get('setup'),
        undefined,
        createStorageOperationRuntime()
      )
    ).resolves.toBeUndefined()

    const cleanupTransaction = db.transaction('kv', 'readwrite')
    cleanupTransaction.objectStore('kv').put('cleanup', 'cleanup')
    const cleanup = await captureOperationCleanup(() =>
      idbTransactionCommit(
        cleanupTransaction,
        {
          signal: {
            aborted: false,
            addEventListener: () => {},
            removeEventListener: () => {
              throw new Error('hostile transaction listener cleanup')
            }
          } as never
        },
        createStorageOperationRuntime()
      )
    )
    expect(cleanup.result).toBeUndefined()
    expect(cleanup.reports).toEqual([
      expect.objectContaining({ message: 'hostile transaction listener cleanup' })
    ])
  })
})
