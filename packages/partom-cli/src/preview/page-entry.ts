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

/** One remote module entry bundled into the editor preview: its stable name and absolute file. */
export type IRemoteEntry = { readonly name: string; readonly file: string }

/**
 * Source of the editor preview entry: the config plugins plus devtools and the project's remote
 * modules as `remote:modules`, handed to the editor bridge with the shared runtime.
 */
export function editorEntrySource(
  configPath: string,
  runtimePath: string,
  origin: string,
  remote: readonly IRemoteEntry[]
): string {
  /** Import lines of the remote entries. */
  const imports = remote.map(
    (entry, index) => `import remote${index} from ${JSON.stringify(entry.file)}`
  )
  /** Entry records of the remote modules. */
  const entries = remote.map(
    (entry, index) => `{ name: ${JSON.stringify(entry.name)}, definitions: list(remote${index}) }`
  )
  return `
import config from ${JSON.stringify(configPath)}
import * as partContract from '@migaia/part-contract'
import * as partHost from '@migaia/part-host'
import { domPlugin } from '@migaia/part-plugin-dom'
import { reactPlugin } from '@migaia/part-plugin-react'
import { devtoolsPlugin } from '@migaia/part-plugin-devtools'
import { loadRemoteModules, remoteModulesPlugin } from '@migaia/part-plugin-remote'
import * as react from 'react'
import * as reactJsxRuntime from 'react/jsx-runtime'
import { startEditorPage } from ${JSON.stringify(runtimePath)}
${imports.join('\n')}
const list = (value) => (Array.isArray(value) ? value : [value])
const own = config.plugins.filter((plugin) => plugin.name !== domPlugin.name && plugin.name !== reactPlugin.name)
void startEditorPage({
  origin: ${JSON.stringify(origin)},
  plugins: [domPlugin, reactPlugin, devtoolsPlugin, ...own, remoteModulesPlugin([${entries.join(', ')}])],
  createPartHost: partHost.createPartHost,
  loadRemoteModules,
  shared: { '@migaia/part-host': partHost, '@migaia/part-contract': partContract, react, 'react/jsx-runtime': reactJsxRuntime }
})
`
}
