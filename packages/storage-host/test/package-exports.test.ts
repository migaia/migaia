import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
/** The repository baseline remains the existing owner of runtime export expectations. */
const baseline = JSON.parse(
  readFileSync(
    new URL('../../../scripts/fixtures/public-exports.baseline.json', import.meta.url),
    'utf8'
  )
) as { packages: Record<string, Record<string, string[]>> }
describe('storage host package exports', () => {
  it('loads the actual neutral package root with the declared public runtime surface', async () => {
    /** Dynamic self-import exercises the built package entry rather than an internal source alias. */
    const runtime = await import('@migaia/storage-host')
    expect(Object.keys(runtime).sort()).toEqual(baseline.packages['@migaia/storage-host']!['.'])
    expect(runtime.STORAGE_HOST_SOURCE).toBe('@migaia/storage-host')
    await using host = await runtime.createStorageHost()
    expect(host.backends().size).toBe(0)
  })
  it('loads schema and codec adapters through the actual neutral entity entry', async () => {
    /** Package resolution proves adapters do not require a browser or Web package entry. */
    const runtime = await import('@migaia/storage-host/entity')
    expect(Object.keys(runtime).sort()).toEqual(
      baseline.packages['@migaia/storage-host']!['./entity']
    )
    expect(runtime.jsonCodec.name).toBe('json@1')
    expect(runtime.REPOSITORY_KEY_PREFIX).toBe('__storage_web_entity_v2__')
    expect(runtime.repositoryMigrationKey('users')).toBe('repository:users:migration')
    await expect(runtime.jsonCodec.encode({ ready: true })).resolves.toBe('{"ready":true}')
  })
})
