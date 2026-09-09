import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = new URL('.', import.meta.url)
const fixturePath = resolve(directory.pathname, 'canonical.json')
const outputPath = resolve(directory.pathname, 'portable-values.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const output = {
  schema: 'migaia.rpc',
  version: fixture.version,
  cases: fixture.cases,
  invalid: fixture.invalid
}
const serialized = `${JSON.stringify(output, null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8')
  if (current !== serialized) process.exitCode = 1
} else {
  writeFileSync(outputPath, serialized)
}
