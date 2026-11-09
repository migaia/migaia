import { readFileSync, readdirSync } from 'node:fs'

const source = readFileSync(new URL('../src/define-plugin.ts', import.meta.url), 'utf8')
const distFiles = readdirSync(new URL('../dist/', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (!source.includes('WeakMap<object, IStoredDefinition>'))
  throw new Error('trusted ownership missing')
if (source.includes("from './host-runtime.ts'") || source.includes('HostRuntime'))
  throw new Error('trusted ownership crossed lifecycle boundary')
const exports = Object.keys(packageJson.exports).sort()
if (
  JSON.stringify(exports) !==
  JSON.stringify([
    '.',
    './activation',
    './composition',
    './enablement',
    './feature-dependencies',
    './feature-overlay',
    './feature-overlay/notifications',
    './features',
    './named-pipelines',
    './pipeline-modes/async',
    './pipeline-modes/async-generator',
    './pipeline-modes/generator',
    './pipeline-modes/sync'
  ])
)
  throw new Error(`package export topology mismatch: ${JSON.stringify(exports)}`)
if (!distFiles.includes('define-host.js.map')) throw new Error('functional host sourcemap missing')
const root = await import(new URL('../dist/index.js', import.meta.url))
const composition = await import(
  new URL('../dist/modules/feature-dependencies/composition-entry.js', import.meta.url)
)
if (
  typeof root.definePlugin !== 'function' ||
  typeof root.defineHost !== 'function' ||
  typeof root.PluginHost !== 'function'
)
  throw new Error('root packed surface missing')
if (typeof composition.openComposition !== 'function')
  throw new Error('composition packed surface missing')
console.log(
  JSON.stringify({
    exports,
    sourcemap: 'define-host.js.map',
    composition: true
  })
)
