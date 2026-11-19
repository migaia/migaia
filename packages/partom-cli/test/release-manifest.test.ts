import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createPartHost } from '@migaia/part-host'
import { createElement, type ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { lastJson, WorkProject } from './release-support.ts'

/** Project TypeScript compiler of this package. */
const TSC = join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsc')

/** Issues printed by a release command. */
type IIssues = { issues: { rule: string; path: string }[] }

/** Exports of the generated client module. */
type IClientModule = {
  manifest: { definitions: string[] }
  chunks: Record<string, () => Promise<void>>
  lazyPartsPlugin: never
  inlined: Uint8Array | undefined
}

describe('partom manifest', () => {
  it('generates the client module with lazy parts, budgets and the remote-in-config check', async () => {
    /** Working copy. */
    const work = new WorkProject()
    try {
      /** Manifest run. */
      const run = work.run(['manifest', '--inline', 'orders-page', '--budgets'])
      expect(run.code, run.stderr).toBe(1)
      /** Size issues. */
      const issues = lastJson<IIssues>(run.stdout).issues
      expect(issues.map((issue) => [issue.rule, issue.path])).toEqual([
        ['budget.size', 'parts/heavy.part.tsx']
      ])
      work.write(
        'tsconfig.gen.json',
        JSON.stringify({ extends: './tsconfig.json', files: ['src/partom-client.gen.ts'] })
      )
      /** Type check of the generated module. */
      const tsc = spawnSync(TSC, ['-p', 'tsconfig.gen.json'], { cwd: work.dir, encoding: 'utf8' })
      expect(tsc.status, tsc.stdout).toBe(0)

      /** Generated module. */
      const client = (await import(join(work.dir, 'src', 'partom-client.gen.ts'))) as IClientModule
      expect(client.manifest.definitions).toEqual(
        expect.arrayContaining(['page@1', 'button@1', 'card@1', 'heavy@1'])
      )
      expect(client.manifest.definitions).not.toContain('notify@1')
      /** Module evaluation log of the part fixtures. */
      const loads = ((globalThis as { partomLoads?: string[] }).partomLoads ??= [])
      /** Host with the lazy parts. */
      const host = await createPartHost({ plugins: [client.lazyPartsPlugin] })
      expect(host.catalog.get('card@1')).toBeDefined()
      expect(host.catalog.get('heavy@1')).toBeDefined()
      expect(loads).toEqual([])
      await client.chunks['card@1']?.()
      expect(loads).toEqual(['card'])
      /** Server renderer; imported by a computed specifier because react-dom ships no types here. */
      const { renderToString } = (await import(['react-dom', 'server'].join('/'))) as {
        renderToString(node: unknown): string
      }
      /** Lazy component of the card. */
      const binding = host.catalog.implementation('react', 'card@1') as {
        component: ComponentType<Record<string, unknown>>
      }
      expect(renderToString(createElement(binding.component, { title: 'Totals' }))).toContain(
        'Totals'
      )
      expect(JSON.parse(new TextDecoder().decode(client.inlined)).blueprints[0].id).toBe(
        'orders-page'
      )
      await host.dispose()

      work.write(
        'partom.config.ts',
        work
          .read('partom.config.ts')
          .replace(
            "import { appPlugin } from './app.tsx'",
            "import { definePartPlugin } from '@migaia/part-host'\nimport { appPlugin } from './app.tsx'\nimport notify from './remote/effects/notify.ts'"
          )
          .replace(
            'plugins: [appPlugin]',
            "plugins: [appPlugin, definePartPlugin({ name: 'extra', effects: [notify] })]"
          )
      )
      /** Manifest with the remote module also in the config. */
      const twice = work.run(['manifest'])
      expect(twice.code).toBe(1)
      expect(lastJson<IIssues>(twice.stdout).issues.map((issue) => issue.rule)).toEqual([
        'release.remote-in-config'
      ])
      work.commit('config imports remote')
      work.git(['tag', 'v2'])
      /** Build with the same config. */
      const build = work.run(['build'])
      expect(build.code).toBe(1)
      expect(lastJson<IIssues>(build.stdout).issues.map((issue) => issue.rule)).toEqual([
        'release.remote-in-config'
      ])
    } finally {
      work.remove()
    }
  })
})
