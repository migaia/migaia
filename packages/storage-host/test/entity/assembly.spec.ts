import { describe, expect, it } from 'vitest'
import { defineEntity } from '../../src/entity.js'
import { entityQueryFeature } from '../../src/entity/query-feature.js'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.js'
import { entityKeysetFeature } from '../../src/entity/keyset.js'
import { StorageErrorCode } from '../../src/error-code.js'
import { STORAGE_HOST_SOURCE } from '../../src/errors.js'
import { memoryBackend } from '../helpers/memory.js'

/** Business records keep the same fixture across basic and explicitly assembled repositories. */
type IRow = { id: string; group: string }

/** Every missing unit names its exact public migration entry before any backend work. */
function missing(name: string) {
  return {
    source: STORAGE_HOST_SOURCE,
    code: StorageErrorCode.entityFeatureRequired,
    message: expect.stringContaining(`@migaia/storage-host/entity/${name}`)
  }
}

describe('explicit entity assembly', () => {
  it('keeps definition, connection and ordinary reads/writes usable without optional units', async () => {
    const repository = defineEntity<IRow>({ name: 'basic', key: 'id' }).connect(
      await memoryBackend()
    )
    await repository.put({ id: 'a', group: 'one' })
    expect(await repository.get('a')).toEqual({ id: 'a', group: 'one' })
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
    expect(() => repository.migrate()).toThrow(expect.objectContaining(missing('migration')))
    await repository.remove('a')
    expect(await repository.get('a')).toBeUndefined()
  })

  it('query alone executes the existing where/select/all workload and rejects undeclared keyset/index use', async () => {
    const repository = defineEntity<IRow>({
      name: 'query-only',
      key: 'id',
      features: [entityQueryFeature()]
    }).connect(await memoryBackend())
    await repository.put({ id: 'a', group: 'one' })
    expect(await repository.query().where('group', 'eq', 'one').select('id').all()).toEqual([
      { id: 'a' }
    ])
    expect(() => repository.query().index('missing' as never)).toThrow(
      expect.objectContaining(missing('indexes'))
    )
    await expect(repository.query().page(1)).rejects.toMatchObject(missing('keyset'))
  })

  it('admits keyset only through its independent assembly and keeps the original cursor path', async () => {
    const repository = defineEntity<IRow>({
      name: 'keyset',
      key: 'id',
      features: [entityQueryFeature(), entityKeysetFeature()]
    }).connect(await memoryBackend())
    await repository.put({ id: 'a', group: 'one' })
    await repository.put({ id: 'b', group: 'two' })
    const first = await repository.query().page(1)
    expect(first.items).toEqual([{ id: 'a', group: 'one' }])
    expect(await repository.query().after(first.next!).all()).toEqual([{ id: 'b', group: 'two' }])
  })

  it('rejects missing declaration assemblies before store connection', () => {
    expect(() =>
      defineEntity<IRow>({
        name: 'versions',
        key: 'id',
        version: 2,
        migrations: { 2: (value) => value }
      })
    ).toThrow(expect.objectContaining(missing('migration')))
    expect(() =>
      defineEntity<IRow>()({ name: 'indexed', key: 'id', indexes: { group: { path: 'group' } } })
    ).toThrow(expect.objectContaining(missing('indexes')))
    expect(() =>
      defineEntity<IRow>()({
        name: 'unique',
        key: 'id',
        features: [entityIndexesFeature()],
        indexes: { group: { path: 'group', unique: true } }
      })
    ).toThrow(expect.objectContaining(missing('unique')))
  })
})
