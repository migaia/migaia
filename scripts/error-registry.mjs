/** Canonical per-code error registry generator and verifier. */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root used by the CLI and exported helpers. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Generated registry opening marker. */
export const REGISTRY_START = '<!-- error-registry:start -->'
/** Generated registry closing marker. */
export const REGISTRY_END = '<!-- error-registry:end -->'

/** Stable failures exposed by the registry generator and its CLI. */
export const ErrorRegistryErrorCode = {
  /** A declaration has no scenario JSDoc; add the entry's description. */
  jsdocMissing: 'REGISTRY_JSDOC_MISSING',
  /** Two declarations own one semantic pair; remove one declaration. */
  duplicateCode: 'REGISTRY_DUPLICATE_CODE',
  /** The local contract document is absent during a write; restore it first. */
  documentMissing: 'REGISTRY_DOCUMENT_MISSING',
  /** The present document lacks generated markers; regenerate its region. */
  regionMissing: 'REGISTRY_REGION_MISSING',
  /** The generated region differs from source; run the integration write. */
  stale: 'REGISTRY_STALE',
  /** The CLI mode is unknown; choose one supported mode. */
  usage: 'REGISTRY_USAGE'
}

/** Stable diagnostic text shared by errors and the generated contract. */
const RegistryText = {
  /**
   * Existing missing-description text is consumed by registry tests. @param {string} path
   * Declaration path. @param {string} code Error code.
   */
  jsdocMissing: (path, code) => `${path}: error code ${code} is missing descriptive JSDoc`,
  /**
   * Duplicate diagnostics identify the colliding public pair. @param {string} source Source. @param
   * {string} code Error code.
   */
  duplicateCode: (source, code) => `duplicate error code (${source}, ${code})`,
  /**
   * Missing local documents cannot be recreated from declarations alone. @param {string} path
   * Document path.
   */
  documentMissing: (path) => `missing registry: ${path}`,
  /** Existing marker guidance is part of the script's diagnostic contract. */
  regionMissing: 'error registry generated region is missing; run with --write',
  /** Existing stale-region guidance is consumed by registry tests. */
  stale: 'error registry is stale; run with --write',
  /** The CLI lists its complete supported mode set. */
  usage: 'usage: node scripts/error-registry.mjs --write | --check | --check-sources',
  /** Generated docs direct maintainers to the integration owner. */
  generatedNotice: '> 由 `pnpm run registry:write` 生成；手工修改会被 `--check` 拒绝。'
}

/**
 * Adds a stable semantic code without replacing the native Error object.
 *
 * @param {string} code Registry failure code.
 * @param {string} message Stable diagnostic text.
 * @param {Record<string, unknown>} [details] Structured failure details.
 * @returns {Error & { code: string; files?: string[] }} Coded native error.
 */
const withCode = (code, message, details = {}) => {
  /** Native error keeps its original stack and runtime type. */
  const error = new Error(message)
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  for (const [key, value] of Object.entries(details))
    Object.defineProperty(error, key, { value, enumerable: true })
  return /** @type {Error & { code: string; files?: string[] }} */ (error)
}

/**
 * Compares UTF-16 code units without locale or ICU rules.
 *
 * @param {string} left First text.
 * @param {string} right Second text.
 * @returns {number} Ordering indicator.
 */
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Recursively finds canonical error-code declaration files.
 *
 * @param {string} directory Directory to scan.
 * @returns {string[]} Absolute declaration paths.
 */
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

/**
 * Converts a JSDoc body into its first descriptive sentence.
 *
 * @param {string} body JSDoc body without delimiters.
 * @returns {string} Stable scenario text.
 */
const firstSentence = (body) => {
  const text = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
  const boundary = text.search(/[。！？]|[.!?](?:\s|$)/)
  return (boundary < 0 ? text : text.slice(0, boundary + 1)).replaceAll('|', '\\|').trim()
}

/**
 * Reads a layer source declaration, falling back to its package identity.
 *
 * @param {string} file Absolute declaration path.
 * @returns {string} Registry source.
 */
const sourceFor = (file) => {
  /** Optional layer-specific source exported by this error code declaration. */
  const declaredSource = readFileSync(file, 'utf8').match(
    /^export const ERROR_SOURCE = '([^']+)'/m
  )?.[1]
  if (declaredSource) return declaredSource
  /** Package directory containing this error code declaration. */
  const packageDirectory = file.slice(0, file.indexOf('/src/') + 0)
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  return manifest.name
}

/**
 * Parses every `(source, code, scenario)` row and rejects missing or duplicate declarations.
 *
 * @param {string} [root] Repository root.
 * @returns {ReadonlyArray<Readonly<{ source: string; code: string; scenario: string }>>} Sorted
 *   rows.
 */
export const collectErrorRegistry = (root = repositoryRoot) => {
  /** Parsed rows across every package-owned declaration file. */
  const rows = []
  /** First declaration path for each public source/code pair. */
  const owners = new Map()
  /** Declaration files live only below package source trees. */
  const files = findErrorCodeFiles(join(root, 'packages')).sort(codeUnitCompare)
  /**
   * One optional JSDoc block directly followed by a `key: 'CODE'` entry. The JSDoc group may not
   * cross a closing `*\/`, so a file header comment can never be attributed to a later code.
   */
  const entryPattern =
    /(?:\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*)?([A-Za-z][A-Za-z0-9]*)\s*:\s*'([A-Z][A-Z0-9_]*)'/g
  for (const file of files) {
    const source = sourceFor(file)
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(entryPattern)) {
      const scenario = firstSentence(match[1] ?? '')
      if (scenario.length === 0) {
        const path = relative(root, file)
        throw withCode(
          ErrorRegistryErrorCode.jsdocMissing,
          RegistryText.jsdocMissing(path, match[3])
        )
      }
      /** NUL separates the two public identity components without ambiguity. */
      const identity = `${source}\0${match[3]}`
      /** Prior owner makes a duplicate declaration actionable. */
      const prior = owners.get(identity)
      if (prior !== undefined)
        throw withCode(
          ErrorRegistryErrorCode.duplicateCode,
          RegistryText.duplicateCode(source, match[3]),
          { files: [prior, relative(root, file)].sort(codeUnitCompare) }
        )
      owners.set(identity, relative(root, file))
      rows.push({ source, code: match[3], scenario })
    }
  }
  rows.sort(
    (left, right) =>
      codeUnitCompare(left.source, right.source) || codeUnitCompare(left.code, right.code)
  )
  return Object.freeze(rows.map((row) => Object.freeze(row)))
}

/**
 * Validates every source declaration without reading or writing the local docs tree.
 *
 * @param {string} [root] Repository root.
 * @returns {{ source: string; count: number }[]} Source counts in code-unit order.
 */
export const checkErrorRegistrySources = (root = repositoryRoot) => {
  /** Sorted rows are already checked for missing descriptions and duplicate codes. */
  const rows = collectErrorRegistry(root)
  return countRows(rows)
}

/**
 * Renders the generated registry region deterministically.
 *
 * @param {ReadonlyArray<Readonly<{ source: string; code: string; scenario: string }>>} rows Sorted
 *   rows.
 * @returns {string} Complete generated Markdown region.
 */
export const renderErrorRegistry = (rows) =>
  [
    REGISTRY_START,
    '### 4.1 逐码生成区',
    '',
    RegistryText.generatedNotice,
    '',
    '| source | 码数 |',
    '| --- | --- |',
    ...countRows(rows).map(({ source, count }) => `| \`${source}\` | ${count} |`),
    '',
    '| source | code | 场景 |',
    '| --- | --- | --- |',
    ...rows.map(({ source, code, scenario }) => `| \`${source}\` | \`${code}\` | ${scenario} |`),
    REGISTRY_END
  ].join('\n')

/**
 * Derives per-source counts from already sorted rows for the generated summary.
 *
 * @param {ReadonlyArray<Readonly<{ source: string }>>} rows Sorted rows.
 * @returns {{ source: string; count: number }[]} Source counts.
 */
function countRows(rows) {
  /** Count accumulated for each source in row order. */
  const counts = new Map()
  for (const { source } of rows) counts.set(source, (counts.get(source) ?? 0) + 1)
  return [...counts].map(([source, count]) => ({ source, count }))
}

/**
 * Atomically replaces or inserts the generated region in the ignored local contract document.
 *
 * @param {string} [root] Repository root.
 * @returns {void}
 */
export const writeErrorRegistry = (root = repositoryRoot) => {
  const path = join(root, 'docs/contracts/error-codes.md')
  if (!existsSync(path))
    throw withCode(
      ErrorRegistryErrorCode.documentMissing,
      RegistryText.documentMissing(relative(root, path))
    )
  const document = readFileSync(path, 'utf8')
  const generated = renderErrorRegistry(collectErrorRegistry(root))
  const start = document.indexOf(REGISTRY_START)
  const end = document.indexOf(REGISTRY_END)
  const next =
    start >= 0 && end >= start
      ? `${document.slice(0, start)}${generated}${document.slice(end + REGISTRY_END.length)}`
      : document.replace('\n## 5. 什么不是错误码', `\n${generated}\n\n## 5. 什么不是错误码`)
  /** Same-directory temporary file keeps the prior document complete until rename. */
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, next)
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}

/**
 * Validates JSDoc everywhere and, when present, exact generated registry content.
 *
 * @param {string} [root] Repository root.
 * @returns {void}
 */
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
    throw withCode(ErrorRegistryErrorCode.regionMissing, RegistryText.regionMissing)
  const actual = document.slice(start, end + REGISTRY_END.length)
  const expected = renderErrorRegistry(rows)
  if (actual !== expected) throw withCode(ErrorRegistryErrorCode.stale, RegistryText.stale)
}

/** Prints source counts or delegates to the selected registry operation. */
const main = () => {
  const [mode] = process.argv.slice(2)
  if (mode === '--write') return writeErrorRegistry()
  if (mode === '--check') return checkErrorRegistry()
  if (mode === '--check-sources') {
    /** Validated counts printed for package-local gates. */
    const counts = checkErrorRegistrySources()
    for (const { source, count } of counts) console.log(`${source} ${count}`)
    console.log(`sources ok: ${counts.reduce((total, { count }) => total + count, 0)}`)
    return
  }
  throw withCode(ErrorRegistryErrorCode.usage, RegistryText.usage)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(
      error instanceof Error
        ? `${'code' in error ? `${error.code}: ` : ''}${error.message}`
        : String(error)
    )
    process.exitCode = 1
  }
}
