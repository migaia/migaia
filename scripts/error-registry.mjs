/** Canonical per-code error registry generator and verifier. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root used by the CLI and exported helpers. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Generated registry opening marker. */
export const REGISTRY_START = '<!-- error-registry:start -->'
/** Generated registry closing marker. */
export const REGISTRY_END = '<!-- error-registry:end -->'

/** Recursively finds canonical error-code declaration files. */
const findErrorCodeFiles = (directory) => {
  /** Files found under this directory. */
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...findErrorCodeFiles(path))
    else if (entry.name === 'error-code.ts') files.push(path)
  }
  return files
}

/** Converts a JSDoc body into its first descriptive sentence. */
const firstSentence = (body) => {
  const text = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
  const boundary = text.search(/[。！？]|[.!?](?:\s|$)/)
  return (boundary < 0 ? text : text.slice(0, boundary + 1)).replaceAll('|', '\\|').trim()
}

/** Reads one package source identifier, including capability's graph submodule. */
const sourceFor = (file, root) => {
  const packageDirectory = file.slice(0, file.indexOf('/src/') + 0)
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  return file.endsWith('/capability/src/graph/error-code.ts')
    ? `${manifest.name}/graph`
    : manifest.name
}

/** Parses every `(source, code, scenario)` row and rejects missing entry JSDoc. */
export const collectErrorRegistry = (root = repositoryRoot) => {
  /** Parsed rows across every package-owned declaration file. */
  const rows = []
  /** Declaration files live only below package source trees. */
  const files = findErrorCodeFiles(join(root, 'packages')).sort()
  const entryPattern =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?([A-Za-z][A-Za-z0-9]*)\s*:\s*'([A-Z][A-Z0-9_]*)'/g
  for (const file of files) {
    const source = sourceFor(file, root)
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(entryPattern)) {
      const scenario = firstSentence(match[1] ?? '')
      if (scenario.length === 0) {
        const path = relative(root, file)
        throw new Error(`${path}: error code ${match[3]} is missing descriptive JSDoc`)
      }
      rows.push({ source, code: match[3], scenario })
    }
  }
  rows.sort(
    (left, right) => left.source.localeCompare(right.source) || left.code.localeCompare(right.code)
  )
  return Object.freeze(rows.map((row) => Object.freeze(row)))
}

/** Renders the generated registry region deterministically. */
export const renderErrorRegistry = (rows) =>
  [
    REGISTRY_START,
    '### 4.1 逐码生成区',
    '',
    '> 由 `node scripts/error-registry.mjs --write` 生成；手工修改会被 `--check` 拒绝。',
    '',
    '| source | code | 场景 |',
    '| --- | --- | --- |',
    ...rows.map(({ source, code, scenario }) => `| \`${source}\` | \`${code}\` | ${scenario} |`),
    REGISTRY_END
  ].join('\n')

/** Replaces or inserts the generated region in the ignored local contract document. */
export const writeErrorRegistry = (root = repositoryRoot) => {
  const path = join(root, 'docs/contracts/error-codes.md')
  if (!existsSync(path)) throw new Error(`missing registry: ${relative(root, path)}`)
  const document = readFileSync(path, 'utf8')
  const generated = renderErrorRegistry(collectErrorRegistry(root))
  const start = document.indexOf(REGISTRY_START)
  const end = document.indexOf(REGISTRY_END)
  const next =
    start >= 0 && end >= start
      ? `${document.slice(0, start)}${generated}${document.slice(end + REGISTRY_END.length)}`
      : document.replace('\n## 5. 什么不是错误码', `\n${generated}\n\n## 5. 什么不是错误码`)
  writeFileSync(path, next)
}

/** Validates JSDoc everywhere and, when present, exact generated registry content. */
export const checkErrorRegistry = (root = repositoryRoot) => {
  const rows = collectErrorRegistry(root)
  const path = join(root, 'docs/contracts/error-codes.md')
  if (!existsSync(path)) {
    console.warn(`error registry is absent: ${relative(root, path)}`)
    return
  }
  const document = readFileSync(path, 'utf8')
  const start = document.indexOf(REGISTRY_START)
  const end = document.indexOf(REGISTRY_END)
  if (start < 0 || end < start)
    throw new Error('error registry generated region is missing; run with --write')
  const actual = document.slice(start, end + REGISTRY_END.length)
  const expected = renderErrorRegistry(rows)
  if (actual !== expected) throw new Error('error registry is stale; run with --write')
}

/** CLI dispatcher. */
const main = () => {
  const [mode] = process.argv.slice(2)
  if (mode === '--write') return writeErrorRegistry()
  if (mode === '--check') return checkErrorRegistry()
  throw new Error('usage: node scripts/error-registry.mjs --write | --check')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
