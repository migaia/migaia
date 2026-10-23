import { describe, expect, it } from 'vitest'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../src/index.js'
import type { IBackendRevisionPort } from '../src/authoring/backend.js'
import { catalog } from './helpers/catalog.js'

/** Real installations issue revision facts without transferring resource ownership to a member. */
async function fixture(shared?: IBackendRevisionPort, org?: string) {
  /** Only the installed core may issue a new physical revision map. */
  let core!: IStoragePluginCore
  /** The native backend group may retain and share an existing original port. */
  let revisions!: IBackendRevisionPort
  /** The real catalog remains the resource owned by this host registration. */
  const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store']>()('catalog')
  const descriptor = (installed: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => undefined }),
    install: () => {
      core = installed
      revisions = shared ?? installed.createRevisionPort()
      installed.registerStore(catalog(installed).store)
      return {}
    }
  })
  const host = await createStorageHost({ org, plugins: [definePlugin('revisions', descriptor)] })
  return { host, core, revisions }
}

describe('physical backend revision facts', () => {
  it('retains key tombstones and clear epochs within the original physical owner', async () => {
    const first = await fixture()
    await using _firstHost = first.host
    const second = await fixture(first.revisions)
    await using _secondHost = second.host
    const isolated = await fixture(undefined, '10000000-0000-0000-0000-000000000000')
    await using _isolatedHost = isolated.host
    expect(first.core.defaultOrgId).toBe('00000000-0000-0000-0000-000000000000')
    expect(isolated.core.defaultOrgId).toBe('10000000-0000-0000-0000-000000000000')
    expect(Object.getOwnPropertyDescriptor(first.core, 'defaultOrgId')?.set).toBeUndefined()
    expect(first.revisions.read('record', 'captured-wire')).toBe(0)
    expect(first.revisions.epoch('record')).toBe(0)
    first.revisions.write('record', 'captured-wire')
    second.revisions.write('record', 'captured-wire')
    expect(first.revisions.read('record', 'captured-wire')).toBe(2)
    expect(first.revisions.read('text', 'captured-wire')).toBe(0)
    expect(isolated.revisions.read('record', 'captured-wire')).toBe(0)
    first.revisions.clear('record')
    expect(second.revisions.epoch('record')).toBe(1)
    expect(second.revisions.read('record', 'captured-wire')).toBe(0)
    second.revisions.write('record', 'captured-wire')
    expect(first.revisions.read('record', 'captured-wire')).toBe(1)
    expect(first.revisions.epoch('record')).toBe(1)
    first.revisions.clear('bytes')
    expect(first.revisions.epoch('bytes')).toBe(1)
    expect(first.revisions.epoch('record')).toBe(1)
    await first.host.dispose()
    second.revisions.write('record', 'captured-wire')
    expect(second.revisions.read('record', 'captured-wire')).toBe(2)
    expect(() => first.core.createRevisionPort()).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    expect(first.revisions).not.toHaveProperty('dispose')
    expect(Object.isFrozen(first.revisions)).toBe(true)
  })
})
