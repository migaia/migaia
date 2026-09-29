import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Enumerates source files only, leaving generated output and dependencies aside. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('A9 abort reason read convergence', () => {
  it('uses the shared guarded read at every owned reason site', () => {
    const repository = join(import.meta.dirname, '../../..')
    const files = [
      'packages/utils/src/promise.ts',
      'packages/serialize/src/signal-snapshot.ts',
      'packages/serialize/src/stream.ts',
      'packages/lifecycle/src/observed-subscription.ts',
      'packages/event-subscriber/src/channel.ts',
      'packages/storage-web/src/core/operation.ts',
      'packages/storage-web/src/host/reactive.ts'
    ]
    for (const file of files) {
      const source = readFileSync(join(repository, file), 'utf8')
      expect(source, file).not.toMatch(/\bsignal\??\.reason\b/)
      expect(source, file).toContain('tryReadProperty(')
      expect(source, file).toContain(
        file.includes('packages/utils/') ? "from './error.js'" : "from '@migaia/utils/error'"
      )
    }
    for (const name of readdirSync(join(repository, 'packages'))) {
      const directory = join(repository, 'packages', name, 'src')
      try {
        for (const file of sourceFiles(directory))
          expect(readFileSync(file, 'utf8'), file).not.toMatch(/function tryReadAbortReason\b/)
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT') throw error
      }
    }
  })
})
