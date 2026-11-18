import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Path of the pre-bundled page runtime embedded in the executable, set by the platform entry.
 * `undefined` when running from source, where the TypeScript runtime module is used directly.
 */
let embeddedRuntime: string | undefined

/** Records the embedded page runtime; only executable entries call this. */
export function setPreviewRuntime(path: string): void {
  embeddedRuntime = path
}

/**
 * Path of a page runtime module the bundler can read: the source module, or in the executable a
 * copy of the embedded bundle written into the preview directory.
 */
export async function runtimeModule(previewDir: string): Promise<string> {
  if (embeddedRuntime === undefined) return join(import.meta.dir, 'page', 'runtime.ts')
  /** Copy inside the preview directory. */
  const target = join(previewDir, 'runtime.js')
  writeFileSync(target, await Bun.file(embeddedRuntime).text())
  return target
}

/** Source of the generated page entry: project config and packages handed to the runtime. */
export function pageEntrySource(configPath: string, runtimePath: string): string {
  return `
import config from ${JSON.stringify(configPath)}
import { createPartHost } from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { reactPlugin } from '@migaia/part-plugin-react'
import { startPreviewPage } from ${JSON.stringify(runtimePath)}
void startPreviewPage({ config, createPartHost, domPlugin, reactPlugin })
`
}
