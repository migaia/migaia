import { describe, expect, it } from 'vitest'
import { catalogToken, lastJson, startCatalog, WorkProject } from './release-support.ts'

/** One history entry of the catalog. */
type IHistory = { tag: string; snapshot: string; action: string }[]

describe('publish, promote, rollback and history', () => {
  it('moves environments through the catalog and maps service failures to exit codes', async () => {
    /** Working copy. */
    const work = new WorkProject()
    /** Running catalog. */
    const catalog = await startCatalog(work.dir)
    try {
      /** Write token. */
      const token = catalogToken(catalog.data, 'dev,staging', 'write')
      /** Token environment. */
      const env = { PARTOM_TOKEN: token }
      /** Service flag. */
      const service = ['--service', catalog.url]
      expect(work.run(['build']).code).toBe(0)
      /** First publish. */
      const v1 = work.run(['publish', ...service], env)
      expect(v1.code, v1.stderr).toBe(0)

      work.write(
        'blueprints/settings.blueprint.json',
        work.read('blueprints/settings.blueprint.json').replace('Save', 'Store')
      )
      work.commit('v2')
      work.git(['tag', 'v2'])
      expect(work.run(['build']).code).toBe(0)
      expect(work.run(['publish', ...service, '--env', 'dev'], env).code).toBe(0)
      expect(work.run(['promote', ...service, '--env', 'staging', '--from', 'dev'], env).code).toBe(
        0
      )
      /** Rollback to v1 by tag. */
      const rollback = work.run(['rollback', ...service, '--env', 'dev', '--to', 'v1'], env)
      expect(rollback.code, rollback.stderr).toBe(0)
      expect(lastJson<{ tag: string }>(rollback.stdout).tag).toBe('v1')

      /** History of dev. */
      const history = work.run(['history', ...service, '--env', 'dev'], env)
      expect(lastJson<IHistory>(history.stdout)[0]?.tag).toBe('v1')
      expect(
        lastJson<IHistory>(work.run(['history', ...service, '--env', 'staging'], env).stdout)[0]
          ?.tag
      ).toBe('v2')
      /** Draft based on v1 with module sources. */
      const draft = (await (
        await fetch(`${catalog.url}/p/orders/drafts`, {
          headers: { authorization: `Bearer ${token}` }
        })
      ).json()) as { base: { tag: string }; modules: { source?: string }[] }
      expect(draft.base.tag).toBe('v1')
      expect(draft.modules[0]?.source).toContain('notify@1')

      expect(work.run(['rollback', ...service, '--env', 'dev', '--to', 'v9'], env).code).toBe(1)
      /** Publish without a token. */
      const anonymous = work.run(['publish', ...service])
      expect(anonymous.code).toBe(1)
      expect(anonymous.stderr).toContain('AUTH_REQUIRED')

      await catalog.stop()
      /** History with the service stopped. */
      const down = work.run(['history', ...service, '--env', 'dev'], env)
      expect(down.code).toBe(2)
      expect(down.stderr).toContain('SERVICE_UNREACHABLE')
    } finally {
      await catalog.stop()
      work.remove()
    }
  })
})
