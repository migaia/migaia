import { readFileSync, readdirSync } from 'node:fs'

const source = readFileSync(new URL('../src/define-plugin.ts', import.meta.url), 'utf8')
const structural = readFileSync(new URL('../src/structural.ts', import.meta.url), 'utf8')
const defined = readFileSync(new URL('../src/defined.ts', import.meta.url), 'utf8')
const distFiles = readdirSync(new URL('../dist/', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (!source.includes('WeakMap<object, IStoredDefinition>'))
  throw new Error('trusted ownership missing')
if (source.includes("from './host-runtime.js'") || source.includes('HostRuntime'))
  throw new Error('trusted ownership crossed lifecycle boundary')
if (structural.includes('definePlugin') || structural.includes('setupHost'))
  throw new Error('structural entry imported functional ownership')
if (defined.includes("from './structural.js'"))
  throw new Error('defined entry crossed structural ownership')
for (const entry of ['.', './defined', './structural'])
  if (!packageJson.exports[entry]) throw new Error(`missing package export ${entry}`)
if (!distFiles.includes('setup-host.js.map')) throw new Error('functional sourcemap missing')
const root = await import(new URL('../dist/index.js', import.meta.url))
const definedDist = await import(new URL('../dist/defined.js', import.meta.url))
const structuralDist = await import(new URL('../dist/structural.js', import.meta.url))
if (typeof root.definePlugin !== 'function' || typeof root.setupHost !== 'function')
  throw new Error('functional packed surface missing')
if (typeof definedDist.definePlugin !== 'function' || typeof definedDist.setupHost !== 'function')
  throw new Error('defined packed surface missing')
if ('definePlugin' in structuralDist || 'setupHost' in structuralDist)
  throw new Error('structural packed surface gained functional exports')
console.log(
  JSON.stringify({
    exports: Object.keys(packageJson.exports),
    sourcemap: 'setup-host.js.map',
    structuralFunctionalExports: false
  })
)
