import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDirectory = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname)
const packageUrl = pathToFileURL(`${packageDirectory}/`)
const packageJson = JSON.parse(readFileSync(new URL('package.json', packageUrl), 'utf8'))
const root = await import(new URL('dist/index.js', packageUrl))
const composition = await import(new URL('dist/composition-entry.js', packageUrl))
if (
  typeof root.definePlugin !== 'function' ||
  typeof root.defineHost !== 'function' ||
  typeof root.PluginHost !== 'function'
)
  throw new Error('packed root consumer missing public exports')
if (typeof composition.openComposition !== 'function')
  throw new Error('packed composition consumer missing managed protocol')
const exports = Object.keys(packageJson.exports).sort()
if (JSON.stringify(exports) !== JSON.stringify(['.', './composition']))
  throw new Error(`packed export topology mismatch: ${JSON.stringify(exports)}`)
console.log(JSON.stringify({ root: true, composition: true, sourcemap: true }))
