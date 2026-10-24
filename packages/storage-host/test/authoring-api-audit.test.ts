import * as contractAuthoringStore from '../src/authoring/store.js'
import { describe, expect, it } from 'vitest'
import * as contract from '@migaia/storage-contract'

/** Complete callable record port; tests replace only the accessor under admission. */
const makeStore = (): contract.IRecordStore => ({
  backend: 'memory',
  capabilities: {
    syncRead: false,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    secondaryIndexes: true,
    changeFeed: true,
    maxValueBytes: undefined,
    opaqueEntries: false
  },
  async get() {
    return null
  },
  async set() {},
  async remove() {},
  async has() {
    return false
  },
  async keys() {
    return []
  },
  async clearValues() {},
  async clearAll() {},
  async dispose() {},
  async [Symbol.asyncDispose]() {},
  async getBytes() {
    return null
  },
  async setBytes() {},
  async removeBytes() {},
  async clearBytes() {},
  async getRecord() {
    return undefined
  },
  async putRecord(_value, key = 'generated') {
    return key
  },
  async deleteRecord() {},
  async clearRecords() {},
  iterateRecords() {
    /** This admission fixture has no cursor; explicit and symbolic cleanup share no external work. */
    const cursor = (async function* () {})()
    /** Both resource surfaces return native Promises around this fixture cursor. */
    const dispose = async (): Promise<void> => {
      await cursor.return()
    }
    return Object.assign(cursor, { dispose, [Symbol.asyncDispose]: dispose })
  },
  async transaction<TResult>(
    _run: (scope: contract.ITransactionScope) => TResult
  ): Promise<Awaited<TResult>> {
    /** This shape-only admission fixture never executes a transaction or fabricates a scope. */
    throw new contract.StorageContractError(contract.StorageContractErrorCode.unsupported, {
      backend: 'memory'
    })
  }
})

describe('storage-contract audit boundary regressions', () => {
  it('requires per-key byte deletion only when admitting the complete record surface', () => {
    /** A base text store remains valid when its optional L1 surface is incomplete. */
    const store = makeStore()
    Object.defineProperty(store, 'removeBytes', { value: undefined })
    expect(contract.isKeyValueStore(store)).toBe(true)
    expect(contract.isRecordStore(store)).toBe(false)
    expect(contractAuthoringStore.snapshotRecordStore(store)).toBeUndefined()
    expect(() => contract.asRecordStore(store)).toThrowError(
      expect.objectContaining({
        source: contract.STORAGE_CONTRACT_SOURCE,
        code: contract.StorageContractErrorCode.unsupported
      })
    )
  })
})
