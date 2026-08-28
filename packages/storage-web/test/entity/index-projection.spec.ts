import { describe, expect, it } from 'vitest'
import { projectEntityIndexes, snapshotEntityIndexes } from '../../src/entity/index-projection.js'
import { StorageErrorCode } from '../../src/types/errors.js'
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
      expect(() => snapshotEntityIndexes(value)).toThrow(StorageErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ __private: { path: 'id' } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ '': { path: 'id' } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: null })).toThrow(StorageErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ bad: [] })).toThrow(StorageErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ bad: { path: 'id', paths: ['id'] } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { unique: 'yes', path: 'id' } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { multiEntry: 'yes', path: 'id' } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { revision: 0, path: 'id' } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { select: 'not-a-function' } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { select: () => undefined } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() =>
      snapshotEntityIndexes({ bad: { select: () => undefined, revision: 1, multiEntry: true } })
    ).toThrow(StorageErrorCode.invalidConfig)
    expect(() => snapshotEntityIndexes({ bad: { paths: [], multiEntry: true } })).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => snapshotEntityIndexes({ bad: { paths: 'id' } })).toThrow(
      StorageErrorCode.invalidConfig
    )

    const getterFailure = new Error('index descriptor getter failed')
    expect(() =>
      snapshotEntityIndexes({
        bad: Object.defineProperty({}, 'path', {
          enumerable: true,
          get: () => {
            throw getterFailure
          }
        })
      })
    ).toThrow(StorageErrorCode.invalidConfig)

    for (const [select, errorCode] of [
      [() => 1, StorageErrorCode.invalidConfig],
      [() => ({ kind: 'multiple' }), StorageErrorCode.invalidConfig],
      [() => ({ kind: 'unknown', key: 'id' }), StorageErrorCode.invalidConfig],
      [() => ({ kind: 'single', key: {} }), StorageContractErrorCode.invalidKey]
    ] as const) {
      const indexes = snapshotEntityIndexes<{ id: string }>({ bad: { select, revision: 1 } })
      expect(() => projectEntityIndexes(indexes, { id: 'u1' }, 'memory')).toThrow(errorCode)
    }
  })

  it('preserves selector getter failures and rejects invalid multi-entry keys', () => {
    const selectorError = new Error('selector projection getter failed')
    const hostile = snapshotEntityIndexes<{ id: string }>({
      selector: {
        select: () =>
          Object.defineProperty({}, 'kind', {
            enumerable: true,
            get: () => {
              throw selectorError
            }
          }),
        revision: 1
      },
      multi: { select: () => ['ok', 1], revision: 1 }
    })
    expect(() => projectEntityIndexes(hostile, { id: 'u1' }, 'memory')).toThrow(
      StorageErrorCode.invalidConfig
    )
    expect(() => projectEntityIndexes({ multi: hostile.multi! }, { id: 'u1' }, 'memory')).toThrow(
      StorageErrorCode.invalidConfig
    )
  })
})
