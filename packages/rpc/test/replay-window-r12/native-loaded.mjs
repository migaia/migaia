import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { threadId } from 'node:worker_threads'

/** Startup loader records actual dist source returned to Node, independently in each isolate. */
const loaded = new Map()
/** Each isolate has an independent startup anchor; this file is a --import preload, not a late hook. */
const startupUTC = new Date().toISOString()
registerHooks({
  load(url, context, nextLoad) {
    /** The untouched loader result is returned; only startup module bytes are fingerprinted. */
    const result = nextLoad(url, context)
    if (
      url.startsWith('file:') &&
      url.includes('/packages/') &&
      url.includes('/dist/') &&
      result.source != null
    ) {
      const path = realpathSync(fileURLToPath(url))
      const sourcePath = path.replace('/dist/', '/src/').replace(/\.js$/u, '.ts')
      const actual = createHash('sha256')
        .update(typeof result.source === 'string' ? result.source : Buffer.from(result.source))
        .digest('hex')
      const disk = createHash('sha256').update(readFileSync(path)).digest('hex')
      loaded.set(path, {
        path,
        actualSHA256: actual,
        diskSHA256: disk,
        matches: actual === disk,
        ...(existsSync(sourcePath)
          ? {
              sourcePath,
              sourceSHA256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex')
            }
          : { sourceMapping: 'bundled-or-generated' })
      })
    }
    return result
  }
})

/**
 * Returns fingerprints of modules actually loaded through this isolate's Node loader.
 *
 * @returns {{ pid: number; threadId: number; startupUTC: string; modules: object[] }} Startup-only
 *   E3 evidence.
 */
export function loadedModules() {
  return { pid: process.pid, threadId, startupUTC, modules: [...loaded.values()] }
}
