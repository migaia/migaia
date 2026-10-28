import { describe, expect, it } from 'vitest'
import { projectEntityIndexes, snapshotEntityIndexes } from '../../src/entity/index-projection.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageContractErrorCode } from '@migaia/storage-contract'

describe('entity index projection contract', () => {
  it('normalizes every supported projection mode and omits undefined values', () => {
    const indexes = snapshotEntityIndexes<{
      id: string
      email?: string
      tags?: string[]
      profile?: { region?: string }
    }>({
      email: { path: 'email' },
      compound: { paths: ['id', 'profile.region'] },
      tags: { path: 'tags', multiEntry: true },
      customMultiple: {
        select: () => ({ kind: 'multiple', keys: ['alpha', 'beta'] }),
        revision: 2
      },
      customMissing: { select: () => undefined, revision: 1 }
    })

    expect(
      projectEntityIndexes(indexes, { id: 'u1', profile: { region: 'apac' } }, 'memory')
    ).toEqual({
      email: undefined,
      compound: { kind: 'single', key: ['u1', 'apac'] },
      tags: undefined,
      customMultiple: { kind: 'multiple', keys: ['alpha', 'beta'] },
      customMissing: undefined
    })
    expect(
      projectEntityIndexes(
        indexes,
        { id: 'u2', email: 'u2@example.com', tags: ['staff'], profile: { region: 'eu' } },
        'memory'
      )
    ).toEqual({
      email: { kind: 'single', key: 'u2@example.com' },
      compound: { kind: 'single', key: ['u2', 'eu'] },
      tags: { kind: 'multiple', keys: ['staff'] },
      customMultiple: { kind: 'multiple', keys: ['alpha', 'beta'] },
      customMissing: undefined
    })
  })

  it('rejects malformed declaration and explicit projection shapes', () => {
    for (const value of [null, [], 42, 'indexes'])
      expect(() => snapshotEntityIndexes(value)).toThrow(StorageHostErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ __private: { path: 'id' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ '': { path: 'id' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: null })).toThrow(StorageHostErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ bad: [] })).toThrow(StorageHostErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ bad: { path: 'id', paths: ['id'] } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { unique: 'yes', path: 'id' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { multiEntry: 'yes', path: 'id' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { revision: 0, path: 'id' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { select: 'not-a-function' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { select: () => undefined } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() =>
      snapshotEntityIndexes({ bad: { select: () => undefined, revision: 1, multiEntry: true } })
    ).toThrow(StorageHostErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ bad: { paths: [], multiEntry: true } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { paths: 'id' } })).toThrow(
      StorageHostErrorCode.invalidConfig
    )

    for (const [select, errorCode] of [
      [() => 1, StorageHostErrorCode.invalidConfig],
      [() => ({ kind: 'multiple' }), StorageHostErrorCode.invalidConfig],
      [() => ({ kind: 'unknown', key: 'id' }), StorageHostErrorCode.invalidConfig],
      [() => ({ kind: 'single', key: {} }), StorageContractErrorCode.invalidKey]
    ] as const) {
      const indexes = snapshotEntityIndexes<{ id: string }>({ bad: { select, revision: 1 } })
      expect(() => projectEntityIndexes(indexes, { id: 'u1' }, 'memory')).toThrow(errorCode)
    }
  })

  it('rejects invalid multi-entry projection shapes', () => {
    const indexes = snapshotEntityIndexes<{ id: string }>({
      multi: { select: () => ['ok', 1], revision: 1 }
    })
    expect(() => projectEntityIndexes(indexes, { id: 'u1' }, 'memory')).toThrow(
      StorageHostErrorCode.invalidConfig
    )
  })
})
