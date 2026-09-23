import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Workspace-local delivery documents are intentionally absent from published checkouts. */
const docsPath = resolve(import.meta.dirname, '../../../../docs')

if (!existsSync(docsPath)) {
  process.stdout.write('test:control-plane skipped: workspace-local docs/ is absent\n')
} else {
  /** Run only the segregated delivery checks with their own Vitest collection config. */
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', 'test/control-plane', '--config', 'vitest.control-plane.config.ts'],
    { cwd: resolve(import.meta.dirname, '../..'), stdio: 'inherit' }
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
