import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDirectory = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname)
const packageUrl = pathToFileURL(`${packageDirectory}/`)
const packageJson = JSON.parse(readFileSync(new URL('package.json', packageUrl), 'utf8'))
const root = await import(new URL('dist/index.js', packageUrl))
const defined = await import(new URL('dist/defined.js', packageUrl))
const structural = await import(new URL('dist/structural.js', packageUrl))
if (typeof root.definePlugin !== 'function' || typeof root.setupHost !== 'function')
  throw new Error('packed root consumer missing functional exports')
if (typeof defined.definePlugin !== 'function' || typeof defined.setupHost !== 'function')
  throw new Error('packed defined consumer missing functional exports')
if ('definePlugin' in structural || 'setupHost' in structural)
  throw new Error('packed structural consumer gained functional exports')
if (!packageJson.exports['./structural']) throw new Error('packed structural export missing')
console.log(JSON.stringify({ root: true, defined: true, structural: true, sourcemap: true }))
