import { describe, expect, it } from 'vitest'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { storageWebErrorCodeInventory } from '../fixtures/error-code-registry.ts'

describe('storage-plugin-browser error registry', () => {
  it('keeps source codes and tracked package inventory synchronized', () => {
    expect(Object.values(StorageBrowserErrorCode).sort()).toEqual(
      [...storageWebErrorCodeInventory].sort()
    )
  })
})
