import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const packageDirectory = resolve(testDirectory, '..')
const workspaceDirectory = resolve(packageDirectory, '../..')
const sourcePath = resolve(packageDirectory, 'src/error-code.ts')
const registryPath = resolve(workspaceDirectory, 'docs/contracts/error-codes.md')

const source = await readFile(sourcePath, 'utf8')
const registry = await readFile(registryPath, 'utf8')
const sourceCodes = [...source.matchAll(/\b[A-Za-z][A-Za-z0-9]*:\s*'([A-Z][A-Z0-9_]*)'/g)]
  .map((match) => match[1])
  .sort()
const registryRow = registry.split('\n').find((line) => line.includes('| `@migaia/storage-web` |'))
const registryCodes = registryRow
  ? [...registryRow.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1]).sort()
  : []
const declaredCount =
  registryRow === undefined ? undefined : Number(registryRow.split('|')[2]?.trim())
const matches =
  declaredCount === sourceCodes.length &&
  sourceCodes.length === registryCodes.length &&
  sourceCodes.every((code, index) => code === registryCodes[index])

console.log(
  JSON.stringify({
    sourcePath,
    registryPath,
    sourceCount: sourceCodes.length,
    registryCount: declaredCount,
    registryCodeCount: registryCodes.length,
    matches
  })
)
if (!matches) process.exitCode = 1
