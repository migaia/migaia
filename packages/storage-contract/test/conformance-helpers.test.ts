import { describe, expect, it } from 'vitest'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageIterator
} from '../src/index.js'
import { conformanceRows, type IConformanceHarness } from '../src/conformance/harness.js'
import { conformanceTransactionFailure } from '../src/conformance/legacy.js'
describe('consumer conformance helpers', () => {
  it('retains iterator read failure before original iterator cleanup failure', async () => {
    const primary = new Error('iterator read failed')
    const cleanup = new Error('iterator cleanup failed')
    const iterator: IStorageIterator<never> = {
      next: async () => {
        throw primary
      },
      dispose: async () => {
        throw cleanup
      },
      [Symbol.asyncDispose]: async () => {
        throw cleanup
      },
      [Symbol.asyncIterator]: () => iterator
    }
    await expect(conformanceRows(iterator)).rejects.toBe(primary)
    expect((primary as Error & { errors: unknown[] }).errors).toEqual([cleanup])
  })
  it('observes native transaction causes while rejecting wrong codes and preserving legacy outer errors', async () => {
    const harness: IConformanceHarness = { describe: () => undefined, it: () => undefined, expect }
    const native = { backend: 'sqlite' }
    const original = new StorageContractError(StorageContractErrorCode.invalidArgument)
    const wrapped = Object.assign(
      new Error('native transaction fixture wrapper', { cause: original }),
      { source: 'storage.backend.fixture', code: 'TRANSACTION_FAILED' }
    )
    await conformanceTransactionFailure(
      harness,
      native,
      () => {
        throw wrapped
      },
      'INVALID_ARGUMENT'
    )
    await conformanceTransactionFailure(
      harness,
      native,
      () => Promise.reject(original),
      'INVALID_ARGUMENT'
    )
    await expect(
      conformanceTransactionFailure(
        harness,
        native,
        () => {
          throw wrapped
        },
        'DUPLICATE_KEY'
      )
    ).rejects.toThrow()
    for (const backend of ['memory', 'indexed-db'])
      await expect(
        conformanceTransactionFailure(
          harness,
          { backend },
          () => {
            throw wrapped
          },
          'INVALID_ARGUMENT'
        )
      ).rejects.toThrow()
  })
})
