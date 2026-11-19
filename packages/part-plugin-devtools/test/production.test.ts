import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production bundle', () => {
  it('resolves the no-op plugin without the development condition', () => {
    /** Temporary entry inside the package, importing the package by name (self-reference). */
    const dir = mkdtempSync(join(import.meta.dirname, '..', '.bundle-'))
    try {
      /** Entry file. */
      const entry = join(dir, 'entry.ts')
      writeFileSync(entry, "export { devtoolsPlugin } from '@migaia/part-plugin-devtools'\n")
      /** Bundle text for flags under a NODE_ENV. */
      const bundle = (flags: string[], mode: string): string =>
        spawnSync('bun', ['build', entry, '--target=browser', ...flags], {
          encoding: 'utf8',
          env: { ...process.env, NODE_ENV: mode }
        }).stdout
      expect(bundle(['--production'], 'production')).not.toContain('part-devtools-panel')
      expect(bundle(['--conditions=development'], 'development')).toContain('part-devtools-panel')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
