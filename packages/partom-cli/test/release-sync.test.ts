import { createServer } from 'node:http'
import type { IBlueprint } from '@migaia/part-contract'
import { describe, expect, it } from 'vitest'
import { catalogToken, lastJson, startCatalog, WorkProject } from './release-support.ts'

/** Draft view returned by the catalog. */
type IDraft = {
  blueprints: { id: string; hash: string; document: IBlueprint }[]
  modules: { name: string; hash: string; source?: string }[]
}

/** Props and attrs of the `create` button in an orders-page document. */
function createButton(document: {
  root: { children: { facets: Record<string, Record<string, unknown>> }[] }
}) {
  return document.root.children[0]?.facets
}

/** Reads the draft. */
async function draftOf(url: string, token: string): Promise<IDraft> {
  return (await (
    await fetch(`${url}/p/orders/drafts`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as IDraft
}

/** Sends a changeset setting the create button label and optionally adding a module. */
async function editDraft(
  url: string,
  token: string,
  label: string,
  module?: { name: string; source: string }
): Promise<void> {
  /** Current draft. */
  const draft = await draftOf(url, token)
  /** Draft orders page. */
  const page = draft.blueprints.find(
    (item) => item.id === 'orders-page'
  ) as IDraft['blueprints'][number]
  /** Response. */
  const response = await fetch(`${url}/p/orders/drafts/changesets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      project: 'orders',
      provenance: { authorKind: 'human' },
      artifacts: [
        {
          kind: 'blueprint',
          id: 'orders-page',
          base: page.hash,
          patch: [{ op: 'replace', path: '/root/children/0/facets/props/label', value: label }]
        },
        ...(module === undefined
          ? []
          : [{ kind: 'module', name: module.name, base: null, source: module.source }])
      ]
    })
  })
  expect(response.ok, await response.clone().text()).toBe(true)
}

/** Source of the module the draft adds. */
const EXTRA = `// Draft effect added in the editor.\nimport { defineEffect } from '@migaia/part-host'\n\nexport default defineEffect({\n  id: 'extra@1',\n  run: async (_event, ctx) => {\n    ctx.state.write('page.extra' as never, 'done' as never)\n  }\n})\n`

describe('partom pull and push', () => {
  it('merges the draft by address, reports conflicts and pushes workspace edits', async () => {
    /** Working copy. */
    const work = new WorkProject()
    /** Running catalog. */
    const catalog = await startCatalog(work.dir)
    try {
      /** Write token. */
      const token = catalogToken(catalog.data, 'dev', 'write')
      /** Token environment. */
      const env = { PARTOM_TOKEN: token }
      /** Service flag. */
      const service = ['--service', catalog.url]
      expect(work.run(['build']).code).toBe(0)
      expect(work.run(['publish', ...service], env).code).toBe(0)
      await editDraft(catalog.url, token, 'Draft label', {
        name: 'effects/extra.ts',
        source: EXTRA
      })
      /** Workspace edit of the same button. */
      const page = work.json<{
        root: { children: { facets: Record<string, Record<string, unknown>> }[] }
      }>('blueprints/orders-page.blueprint.json')
      ;(createButton(page) as Record<string, Record<string, unknown>>).attrs = {
        title: 'Local title'
      }
      work.write('blueprints/orders-page.blueprint.json', JSON.stringify(page, null, 2))

      /** First pull. */
      const first = work.run(['pull', ...service], env)
      expect(first.code, first.stdout + first.stderr).toBe(0)
      /** Merged button. */
      const merged = createButton(work.json('blueprints/orders-page.blueprint.json'))
      expect(merged?.props?.label).toBe('Draft label')
      expect(merged?.attrs?.title).toBe('Local title')
      expect(work.read('remote/effects/extra.ts')).toBe(EXTRA)

      await editDraft(catalog.url, token, 'Draft 2')
      work.write(
        'blueprints/orders-page.blueprint.json',
        work.read('blueprints/orders-page.blueprint.json').replace('Draft label', 'Local 2')
      )
      /** Conflicting pull. */
      const second = work.run(['pull', ...service], env)
      expect(second.code).toBe(1)
      expect(
        lastJson<{ conflicts: { facet?: string }[] }>(second.stdout).conflicts.map(
          (item) => item.facet
        )
      ).toContain('props')
      expect(createButton(work.json('blueprints/orders-page.blueprint.json'))?.props?.label).toBe(
        'Local 2'
      )

      work.write(
        'blueprints/settings.blueprint.json',
        work.read('blueprints/settings.blueprint.json').replace('Save', 'Keep')
      )
      /** Push of the workspace edits. */
      const push = work.run(['push', ...service], env)
      expect(push.code, push.stdout + push.stderr).toBe(0)
      expect(lastJson<{ ok: boolean }>(push.stdout).ok).toBe(true)
      /** Draft settings after the push. */
      const settings = (await draftOf(catalog.url, token)).blueprints.find(
        (item) => item.id === 'settings'
      )
      expect(settings?.document).toEqual(work.json('blueprints/settings.blueprint.json'))
    } finally {
      await catalog.stop()
      work.remove()
    }
  })

  it('refuses a draft module whose name leaves the remote root', async () => {
    /** Working copy. */
    const work = new WorkProject()
    /** Fake catalog answering one draft with an unsafe module name. */
    const server = createServer((_request, response) =>
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          base: { snapshot: 'sha256-x', tag: 'v1' },
          conflicts: [],
          blueprints: [],
          modules: [{ name: '../../package.json', hash: 'sha256-y', source: '{}' }]
        })
      )
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      /** Package manifest before the pull. */
      const before = work.read('partom.config.ts')
      /** Pull from the fake catalog. */
      const run = await work.runAsync([
        'pull',
        '--service',
        `http://127.0.0.1:${(server.address() as { port: number }).port}`
      ])
      expect(run.code).toBe(1)
      expect(lastJson<{ failed: { message: string }[] }>(run.stdout).failed[0]?.message).toContain(
        '../../package.json'
      )
      expect(work.read('partom.config.ts')).toBe(before)
    } finally {
      server.close()
      work.remove()
    }
  })
})
