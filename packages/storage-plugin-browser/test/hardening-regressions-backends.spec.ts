/** Round-2 hardening regressions. Permanent. */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import {
  STORAGE_HOST_ERROR_SOURCE,
  STORAGE_BROWSER_ERROR_SOURCE
} from '@migaia/storage-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { describe, expect, it } from 'vitest'
import {
  createCookieTestStore,
  createIndexedDbTestStore,
  createLocalTestStore
} from './helpers/installed-backends.ts'
import { fakeCookieDocument } from '../src/testing/fake-cookie-document.ts'

/** A failed real installation must expose the browser failure without selecting a memory fallback. */
const expectUnavailableInstallation = async (
  pending: Promise<unknown>,
  original: unknown
): Promise<void> => {
  /** Preserve the actual host rejection while inspecting its canonical cause traversal. */
  const failure: unknown = await pending.then(
    () => undefined,
    (cause: unknown) => cause
  )
  expect(failure).toMatchObject({
    source: STORAGE_HOST_ERROR_SOURCE,
    code: 'BACKEND_INSTALL_FAILED'
  })
  expect(walkErrorCauses(failure)).toContainEqual(
    expect.objectContaining({ source: STORAGE_BROWSER_ERROR_SOURCE, code: 'BACKEND_UNAVAILABLE' })
  )
  expect(walkErrorCauses(failure)).toContain(original)
}

describe('#11 Web Storage 不隐式降级 memory', () => {
  it('探测失败时抛 BACKEND_UNAVAILABLE', async () => {
    /** The original denied write remains reachable through host and plugin installation wrappers. */
    const original = new DOMException('nope', 'QuotaExceededError')
    const broken = {
      length: 0,
      getItem: () => null,
      setItem: () => {
        throw original
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null
    }
    await expectUnavailableInstallation(
      createLocalTestStore({ storage: broken, namespace: 'ns' }),
      original
    )
  })

  it('memory 必须由调用方显式选择', async () => {
    /** Denied persistence is a failure; the real host must not substitute a different backend. */
    const original = new DOMException('nope', 'QuotaExceededError')
    const broken = () => ({
      length: 0,
      getItem: () => null,
      setItem: () => {
        throw original
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null
    })
    await expectUnavailableInstallation(
      createLocalTestStore({ storage: broken(), namespace: 'same' }),
      original
    )
  })
})

describe('#12 cookie 4096 上限包含 name、value 与属性', () => {
  it('name+value 远超 4096 抛 VALUE_TOO_LARGE', async () => {
    const doc = fakeCookieDocument()
    const store = await createCookieTestStore({ namespace: 'n'.repeat(2000), document: doc })
    await expect(store.set('k', 'v'.repeat(4090))).rejects.toMatchObject({
      code: 'VALUE_TOO_LARGE'
    })
  })
})

describe('#13 iterate 早退后游标仍把整表读进内存', () => {
  it('只取第一条也会读完全部记录', async () => {
    const store = await createIndexedDbTestStore({
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: `adv2-${Math.random().toString(36).slice(2)}`
    })
    for (let index = 0; index < 50; index += 1) {
      await store.putRecord({ index }, `k${String(index).padStart(3, '0')}`)
    }
    let reads = 0
    for await (const _entry of store.iterateRecords()) {
      reads += 1
      break
    }
    expect(reads).toBe(1)
    // 游标是自驱的：break 之后 onsuccess 仍会把剩余 49 条推完，
    // 没有 cursor 中止路径。下面这次 await 只是让事件循环把它跑完。
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
})

describe('#14 主键类型入口统一校验', () => {
  it('boolean 主键在 indexedDbHost 上抛稳定 StorageError', async () => {
    const store = await createIndexedDbTestStore({
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: `adv2-${Math.random().toString(36).slice(2)}`
    })
    await expect(store.putRecord({ v: 1 }, true as unknown as string)).rejects.toMatchObject({
      name: 'StorageContractError',
      code: 'INVALID_KEY',
      backend: 'indexed-db'
    })
  })
})
