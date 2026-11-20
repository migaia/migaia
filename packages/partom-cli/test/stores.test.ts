import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { IPartSnapshot } from '@migaia/part-contract'
import { describe, expect, it } from 'vitest'
import { lastJson, WorkProject } from './release-support.ts'

/** TypeScript compiler of this package. */
const TSC = join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsc')

/** Plugin with a `cart` store (Standard Schema) and a `misc` store without schema. */
const STORES_PLUGIN = `
import { definePartPlugin, defineStateStore } from '@migaia/part-host'
import { z } from 'zod'

/** Map handle of a test store. */
const handle = () => new Map<string, unknown>()

export const storesPlugin = definePartPlugin({
  name: 'stores',
  stores: [
    defineStateStore({
      namespace: 'cart',
      schema: z.object({ total: z.number() }),
      create: handle,
      get: (map, key) => map.get(key),
      set: (map, key, value) => void map.set(key, value)
    }),
    defineStateStore({
      namespace: 'misc',
      create: handle,
      get: (map, key) => map.get(key),
      set: (map, key, value) => void map.set(key, value)
    })
  ]
})
`

/** Effects checked against the generated registry. */
const EFFECTS = `
import type { IEffectContext } from '@migaia/part-host'

export function check(ctx: IEffectContext<Record<string, unknown>>): void {
  ctx.state.write('cart.total', 1)
  // @ts-expect-error cart.total is a number
  ctx.state.write('cart.total', 'one')
  /** Values of a store without a schema are unknown. */
  const anything: unknown = ctx.state.read('misc.anything')
  // @ts-expect-error unknown is not assignable to string
  const text: string = ctx.state.read('misc.anything')
  void anything
  void text
}
`

/** Blueprint binding `cart.total` (and optionally an unregistered namespace). */
function blueprint(extra: boolean): string {
  return JSON.stringify({
    id: 'cart-page',
    version: 1,
    root: {
      tag: 'page@1',
      id: 'cart',
      children: [
        {
          tag: 'button@1',
          id: 'total',
          facets: {
            props: {
              label: { $state: 'cart.total' },
              ...(extra ? { x: { $state: 'global.x' } } : {})
            }
          }
        }
      ]
    }
  })
}

describe('state stores in partom (A7)', () => {
  it('types store paths, lists stores in the manifest, not in the lock, and refuses unknown bindings', () => {
    /** Working copy of the release fixture with the store plugin. */
    const work = new WorkProject()
    try {
      work.write('stores.ts', STORES_PLUGIN)
      work.write(
        'partom.config.ts',
        work
          .read('partom.config.ts')
          .replace(
            "import { appPlugin } from './app.tsx'",
            "import { appPlugin } from './app.tsx'\nimport { storesPlugin } from './stores.ts'"
          )
          .replace('plugins: [appPlugin]', 'plugins: [appPlugin, storesPlugin]')
      )
      work.write('blueprints/cart.blueprint.json', blueprint(false))
      work.commit('stores')

      /** Types run. */
      const types = work.run(['types'])
      expect(types.code, types.stderr).toBe(0)
      expect(work.read('partom-env.d.ts')).toContain('"cart.total": number')
      work.write('effects.ts', EFFECTS)
      work.write(
        'tsconfig.stores.json',
        JSON.stringify({ extends: './tsconfig.json', files: ['effects.ts', 'partom-env.d.ts'] })
      )
      /** Type check of the effects. */
      const tsc = spawnSync(TSC, ['-p', 'tsconfig.stores.json'], {
        cwd: work.dir,
        encoding: 'utf8'
      })
      expect(tsc.stdout).toBe('')
      expect(tsc.status).toBe(0)

      /** Manifest run. */
      const manifest = work.run(['manifest'])
      expect(manifest.code, manifest.stderr).toBe(0)
      expect(work.read('src/partom-client.gen.ts')).toContain('"stores":["cart","misc"]')

      work.commit('v2')
      work.git(['tag', 'v2'])
      /** Build run. */
      const build = work.run(['build'])
      expect(build.code, build.stderr).toBe(0)
      /** Built snapshot. */
      const snapshot = work.json<IPartSnapshot>('partom-build/snapshot.json')
      expect('stores' in snapshot.lock).toBe(false)

      work.write('blueprints/cart.blueprint.json', blueprint(true))
      work.commit('v3')
      work.git(['tag', 'v3'])
      /** Build with an unregistered namespace. */
      const refused = work.run(['build'])
      expect(refused.code).toBe(1)
      expect(
        lastJson<{ issues: { rule: string }[] }>(refused.stdout).issues.map((issue) => issue.rule)
      ).toContain('flow.bind-path')
    } finally {
      work.remove()
    }
  })
})
