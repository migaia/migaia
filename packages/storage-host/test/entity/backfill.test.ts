import { describe, expect, it, vi } from 'vitest'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createStorageHost } from '../../src/index.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import {
  registerRecordIndexBackfillStore,
  markRecordIndexBackfillContentionFailure,
  RecordIndexBackfillPhase,
  type IRecordIndexBackfillStore
} from '../../src/entity.js'
import {
  asRecordIndexBackfillStore,
  isBackfillContentionFailure
} from '../../src/entity/backfill.js'

describe('the moved neutral backfill registration', () => {
  it('retains the captured provider and original coded contention identity without invoking native work', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    /** Registration transfers no native transaction or lifecycle authority. */
    const unsupported = new StorageContractError(StorageContractErrorCode.unsupported)
    const native = vi.fn(async (): Promise<never> => {
      throw unsupported
    })
    const provider: IRecordIndexBackfillStore<unknown> = {
      ensureRecordIndexes: native,
      getRecordIndexReadiness: native,
      openBackfillSession: native
    }
    registerRecordIndexBackfillStore(store, provider)
    expect(asRecordIndexBackfillStore(store)).toBe(provider)
    expect(asRecordIndexBackfillStore({})).toBeUndefined()
    markRecordIndexBackfillContentionFailure(unsupported)
    expect(isBackfillContentionFailure(unsupported)).toBe(true)
    expect(
      isBackfillContentionFailure(new StorageContractError(StorageContractErrorCode.unsupported))
    ).toBe(false)
    expect(RecordIndexBackfillPhase).toEqual({ canonical: 'canonical', legacy: 'legacy' })
    expect(native).not.toHaveBeenCalled()
    expect(() => registerRecordIndexBackfillStore(null as never, provider)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(() => markRecordIndexBackfillContentionFailure(null as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  })
})
