import { describe, expect, it } from 'vitest'
import { StorageErrorCode } from '../../src/error-code.js'
import { storageWebErrorCodeInventory } from '../fixtures/error-code-registry.js'

describe('storage-web error registry', () => {
  it('SWV2-T31 keeps source codes and tracked package inventory synchronized', () => {
    expect(Object.values(StorageErrorCode).sort()).toEqual([...storageWebErrorCodeInventory].sort())
  })
})
