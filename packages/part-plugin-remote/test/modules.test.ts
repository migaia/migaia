import type { IRemoteModuleRef } from '@migaia/part-contract'
import { createPartHost } from '@migaia/part-host'
import { describe, expect, it } from 'vitest'
import { currentRemoteModules, loadRemoteModules, type ITrust } from '../src/index.ts'
import {
  answer,
  appPlugin,
  blueprint,
  codes,
  commandLog,
  memoryCache,
  moduleRef,
  MODULES,
  remoteHost,
  SERVICE,
  SHARED,
  snapshotText
} from './support.ts'

/** Application trust of the fixture modules. */
const TRUST: ITrust = {
  'effects/notify.ts': { tier: 'restricted', grants: { resources: ['orders@1:create'] } },
  'effects/audit.ts': { tier: 'isolated', grants: { state: ['page.audit'] } }
}

/** Snapshot text of a tag with the given module references. */
function version(tag: string, modules: readonly IRemoteModuleRef[]): string {
  return snapshotText({
    tag,
    blueprints: [
      blueprint('orders', { $derive: 'total@1' }, { click: 'notify@1', focus: 'audit@1' })
    ],
    definitions: ['button@1', 'notify@1', 'audit@1', 'total@1'],
    modules
  })
}

/** Derived total read through the host. */
function total(host: { state: { resolve(node: never, value: unknown): unknown } }): unknown {
  return host.state.resolve({} as never, { $derive: 'total@1' })
}

describe('remote modules and trust tiers', () => {
  it('applies the application trust, runs isolated effects in the Worker and replaces modules per version', async () => {
    commandLog.length = 0
    /** Cache backend. */
    const cache = await memoryCache()
    await answer('modules', { snapshot: version('v1', MODULES.remote) })
    /** Host under test. */
    const harness = await remoteHost({ cache, env: 'modules', trust: TRUST })
    await harness.remote.ready()
    harness.host.state.write('page.a', 1)
    harness.host.state.write('page.b', 2)

    await harness.host.dispatch('orders-button', 'click', undefined)
    expect(commandLog).toEqual(['create:v1'])
    expect(codes(harness.reported)).toContain('EFFECT_FORBIDDEN')
    expect(harness.host.catalog.get('audit@1')?.descriptor.tier).toBe('isolated')
    await harness.host.dispatch('orders-button', 'focus', undefined).catch(() => undefined)
    expect(harness.host.state.read('page.audit')).toBe('v1')
    expect(harness.host.state.read('page.other')).toBeUndefined()
    expect(total(harness.host)).toBe(3)

    await answer('modules', { snapshot: version('v2', MODULES.v2) })
    await harness.remote.revalidate()
    expect(harness.remote.current()?.tag).toBe('v2')
    expect(codes(harness.reported)).not.toContain('CATALOG_CONFLICT')
    await harness.host.dispatch('orders-button', 'click', undefined)
    expect(commandLog).toEqual(['create:v1', 'create:v2'])
    await harness.host.dispatch('orders-button', 'focus', undefined)
    expect(harness.host.state.read('page.audit')).toBe('v2')
    expect(total(harness.host)).toBe(30)
    expect(
      currentRemoteModules(harness.host)
        ?.map((entry) => entry.name)
        .sort()
    ).toEqual(['derives/sum.ts', 'effects/audit.ts', 'effects/notify.ts'])
    for (const ref of MODULES.remote)
      expect(await cache.getBytes(`part-remote:module:${ref.id}`)).toBeNull()

    /** V2 with a wrong integrity on the moved derive module. */
    const broken = MODULES.v2.map((ref) =>
      ref.name === 'derives/sum.ts'
        ? {
            ...ref,
            integrity: `${ref.integrity.slice(0, -2)}${ref.integrity.at(-2) === 'A' ? 'B' : 'A'}${ref.integrity.at(-1)}`
          }
        : ref
    )
    await answer('modules', { snapshot: version('v3', broken) })
    await expect(harness.remote.revalidate()).rejects.toMatchObject({
      code: 'REMOTE_MODULE_INTEGRITY'
    })
    expect(harness.remote.current()?.tag).toBe('v2')
    await harness.host.dispose()
  })

  it('loadRemoteModules replaces only the modules it is given', async () => {
    commandLog.length = 0
    /** Plain host, as an editor preview has. */
    const host = await createPartHost({ plugins: [appPlugin] })
    /** Load options. */
    const options = {
      base: `${SERVICE}/p/orders/`,
      shared: SHARED,
      trust: { 'effects/notify.ts': { tier: 'page' } } satisfies ITrust
    }
    await loadRemoteModules(
      host,
      [moduleRef('remote', 'effects/notify.ts'), moduleRef('remote', 'derives/total.ts')],
      options
    )
    await host.blueprint.load(blueprint('preview', 'p', { click: 'notify@1' }))
    host.state.write('page.a', 1)
    host.state.write('page.b', 2)
    await loadRemoteModules(host, [moduleRef('v2', 'effects/notify.ts')], options)
    expect(total(host)).toBe(3)
    await host.dispatch('preview-button', 'click', undefined)
    expect(commandLog).toEqual(['create:v2'])
    await host.dispose()
  })
})
