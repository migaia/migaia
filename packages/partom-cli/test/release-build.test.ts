import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashBytes, type IPartSnapshot } from '@migaia/part-contract'
import { describe, expect, it } from 'vitest'
import { lastJson, WorkProject } from './release-support.ts'

/** Every output file of a build, by relative path. */
function outputs(dir: string): Map<string, string> {
  /** Files by path. */
  const files = new Map<string, string>()
  for (const name of ['snapshot.json', 'sources.json'])
    files.set(name, readFileSync(join(dir, 'partom-build', name), 'utf8'))
  for (const name of readdirSync(join(dir, 'partom-build', 'm')))
    files.set(`m/${name}`, readFileSync(join(dir, 'partom-build', 'm', name), 'utf8'))
  return files
}

describe('partom build', () => {
  it('builds byte-identical output from a clean tag and refuses dirty or untagged trees', async () => {
    /** Working copy. */
    const work = new WorkProject()
    try {
      /** First build. */
      const first = work.run(['build'])
      expect(first.code, first.stderr).toBe(0)
      /** First output. */
      const before = outputs(work.dir)
      /** Second build. */
      const second = work.run(['build'])
      expect(second.code).toBe(0)
      expect(outputs(work.dir)).toEqual(before)
      /** Printed summary. */
      const summary = lastJson<{ snapshot: string; tag: string }>(first.stdout)
      expect(summary.tag).toBe('v1')
      expect(summary.snapshot).toBe(
        await hashBytes(
          new Uint8Array(readFileSync(join(work.dir, 'partom-build', 'snapshot.json')))
        )
      )
      /** Snapshot. */
      const snapshot = work.json<IPartSnapshot>('partom-build/snapshot.json')
      expect([...snapshot.lock.definitions].sort()).toEqual(['button@1', 'notify@1', 'page@1'])
      expect(snapshot.descriptors.map((descriptor) => descriptor.id)).toContain('notify@1')
      expect(first.stdout).not.toContain('event.handler-exists')
      expect(snapshot.lock.modules).toHaveLength(1)
      expect(snapshot.lock.modules[0]?.name).toBe('effects/notify.ts')
      expect(snapshot.lock.modules[0]?.url).toMatch(/^m\/[A-Za-z0-9_-]+\.js$/)
      expect(
        work.json<{ modules: { name: string; source: string }[] }>('partom-build/sources.json')
      ).toEqual({
        modules: [{ name: 'effects/notify.ts', source: work.read('remote/effects/notify.ts') }]
      })

      work.write(
        'blueprints/settings.blueprint.json',
        work.read('blueprints/settings.blueprint.json').replace('Save', 'Store')
      )
      /** Build of a modified tree. */
      const modified = work.run(['build'])
      expect(modified.code).toBe(2)
      expect(modified.stderr).toContain('RELEASE_DIRTY')

      work.commit('untagged')
      /** Build of an untagged commit. */
      const untagged = work.run(['build'])
      expect(untagged.code).toBe(2)
      expect(untagged.stderr).toContain('RELEASE_DIRTY')
    } finally {
      work.remove()
    }
  })
})
