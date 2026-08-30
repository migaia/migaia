#!/usr/bin/env bun
// P1: Extract API signatures from .d.ts files

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { format } from 'oxfmt'

const PACKAGES = [
  'utils',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'reactive',
  'serialize',
  'storage-contract',
  'plugin-host',
  'resource',
  'web-rpc',
  'logger',
  'storage-web'
]

/** Stable route families owned by the React Router route module. */
const ROUTE_FAMILIES = [
  { domain: 'docs', path: '/:lang/docs/*' },
  { domain: 'guides', path: '/:lang/guides/*' },
  { domain: 'architecture', path: '/:lang/architecture/*' }
]

/** Languages with canonical URL prefixes in every generated route. */
const LOCALES = ['en', 'zh'] as const

/** Domain names shared by navigation, route generation, and cross-domain edges. */
const DOMAINS = ['docs', 'guides', 'architecture'] as const

/** Removes repository-only terminology from public documentation projections. */
function sanitizePublicText(value: string): string {
  return value
    .replace(/\.\.\/packages/gi, '../modules')
    .replace(/\bpackages?\b/gi, 'module')
    .replace(/\bzh-cn\b/gi, 'zh')
}

/** Converts an export subpath into a URL-safe stable module fragment. */
function moduleRouteSlug(exportPath: string): string {
  if (exportPath === '.') return 'index'
  return (
    exportPath
      .replace(/^\.\//, '')
      .split('/')
      .join('-')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'index'
  )
}

/** Converts a declaration name into a stable fragment without inventing meaning. */
function symbolFragment(module: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
  return `${module}--${safeName || 'symbol'}`
}

/** Adds a short source-derived suffix so same-name declarations cannot share a fragment. */
function uniqueSymbolFragment(module: string, name: string, identity: string): string {
  const base = symbolFragment(module, name)
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 10)
  return `${base}--${suffix}`
}

/** Extracts the nearest maintained JSDoc text for a declaration when present. */
function declarationDoc(source: string, offset: number): string | null {
  const prefix = source.slice(0, offset)
  const start = prefix.lastIndexOf('/**')
  if (start < 0) return null
  const end = prefix.indexOf('*/', start)
  if (end < 0 || prefix.slice(end + 2).trim()) return null
  return prefix
    .slice(start + 3, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim())
    .filter(Boolean)
    .join(' ')
}

/** Extracts source-backed parameter names, types, and optionality from a declaration signature. */
function declarationParameters(signature: string) {
  const open = signature.indexOf('(')
  if (open < 0) return []
  let depth = 0
  let close = -1
  for (let index = open; index < signature.length; index += 1) {
    const character = signature[index]
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0) {
        close = index
        break
      }
    }
  }
  if (close < 0) return []
  const text = signature.slice(open + 1, close)
  const values: Array<{ name: string; type: string; optional: boolean }> = []
  let start = 0
  depth = 0
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index]
    if ('([{<'.includes(character)) depth += 1
    if (')]}>'.includes(character)) depth -= 1
    if ((character === ',' && depth === 0) || index === text.length) {
      const parameter = text.slice(start, index).trim()
      if (parameter) {
        const match = parameter.match(/^([A-Za-z_$][\w$]*)(\?)?\s*(?::\s*(.*))?$/)
        const name = match?.[1] ?? parameter
        const type = match?.[3]?.trim() || 'unknown'
        values.push({ name, type, optional: Boolean(match?.[2]) || parameter.includes('=') })
      }
      start = index + 1
    }
  }
  return values
}

/** Returns the matching close delimiter for a declaration parameter list. */
function closingParenthesis(signature: string, open: number): number {
  let depth = 0
  for (let index = open; index < signature.length; index += 1) {
    if (signature[index] === '(') depth += 1
    else if (signature[index] === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** Finds the end of one declaration while respecting nested syntax and comments. */
function declarationEnd(source: string, start: number, kind: string): number {
  let parentheses = 0
  let brackets = 0
  let braces = 0
  let quote: string | null = null
  let lineComment = false
  let blockComment = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '(') parentheses += 1
    else if (character === ')') parentheses = Math.max(0, parentheses - 1)
    else if (character === '[') brackets += 1
    else if (character === ']') brackets = Math.max(0, brackets - 1)
    else if (character === '{') braces += 1
    else if (character === '}') {
      braces = Math.max(0, braces - 1)
      if (
        braces === 0 &&
        parentheses === 0 &&
        brackets === 0 &&
        ['class', 'interface', 'namespace'].includes(kind)
      ) {
        return index + 1
      }
    } else if (character === ';' && parentheses === 0 && brackets === 0 && braces === 0) {
      return index + 1
    }
  }
  return source.length
}

/** Extracts balanced, source-backed declaration records from a declaration file. */
function declarationSymbols(filePath: string, visited = new Set<string>()) {
  if (visited.has(filePath)) return []
  visited.add(filePath)
  const source = readFileSync(filePath, 'utf8')
  const records: Array<Record<string, unknown>> = []
  const declarationPattern =
    /export\s+(?:declare\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|namespace)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declarationPattern)) {
    const kind = match[1]
    const name = match[2]
    const declarationStart = match.index ?? 0
    const lineStart = source.lastIndexOf('\n', declarationStart) + 1
    const end = declarationEnd(source, declarationStart, kind)
    const signature = source.slice(declarationStart, end).trim().replace(/\s+/g, ' ')
    const parameterDetails = kind === 'function' ? declarationParameters(signature) : []
    const parameters = parameterDetails.map((parameter) => parameter.name)
    const open = signature.indexOf('(')
    const close = open < 0 ? -1 : closingParenthesis(signature, open)
    const returnText =
      kind !== 'function' || close < 0
        ? ''
        : signature
            .slice(close + 1)
            .replace(/^\s*:\s*/, '')
            .replace(/;\s*$/, '')
            .trim()
    records.push({
      name,
      kind,
      signature,
      declarationLine: source.slice(0, lineStart).split('\n').length,
      source: filePath,
      purpose: declarationDoc(source, match.index ?? 0),
      core: signature,
      advanced: null,
      parameters,
      parameterDetails,
      returns: returnText || null,
      errors: [],
      lifecycleConcurrency: null,
      examples: []
    })
  }
  const reexports = [
    ...source.matchAll(/export\s+(?:type\s+)?(?:\*|\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/g)
  ]
  for (const reexport of reexports) {
    const specifier = reexport[1]
    if (!specifier.startsWith('.')) continue
    const target = resolve(join(filePath, '..'), specifier.replace(/\.js$/, '') + '.d.ts')
    if (existsSync(target)) records.push(...declarationSymbols(target, visited))
  }
  return records
}

/** Builds six ordered, source-backed-or-explicit symbol sections for C25/C26. */
function buildSymbolSections(
  record: Record<string, unknown>,
  packageName: string,
  exportPath: string
) {
  const name = String(record.name)
  const kind = String(record.kind)
  const source = String(record.source)
  const declarationLine = String(record.declarationLine)
  const sourceFile = source.split('/').at(-1) ?? source
  const sourceLabel = `${sourceFile}:${declarationLine}`
  const documentedPurpose = sanitizePublicText(String(record.purpose ?? '').trim())
  const overloadSignatures = Array.isArray(record.overloadSignatures)
    ? record.overloadSignatures.map(String)
    : [String(record.signature)]
  const overloadParameterDetails = Array.isArray(record.overloadParameterDetails)
    ? (record.overloadParameterDetails as Array<
        Array<{ name: string; type: string; optional: boolean }>
      >)
    : [
        Array.isArray(record.parameterDetails)
          ? (record.parameterDetails as Array<{ name: string; type: string; optional: boolean }>)
          : []
      ]
  const parameterDetails = overloadParameterDetails.flat()
  const parameterFacts = Array.from(
    new Set(
      parameterDetails.map(
        (parameter) =>
          `${parameter.name}: ${sanitizePublicText(parameter.type)}${parameter.optional ? ' (optional)' : ''}`
      )
    )
  )
  const parameters =
    parameterFacts.length > 0 ? parameterFacts : [`This ${kind} declaration has no parameters.`]
  const overloadReturns = Array.isArray(record.overloadReturns)
    ? record.overloadReturns.map(String).filter(Boolean)
    : [String(record.returns ?? '').trim()].filter(Boolean)
  const returns =
    overloadReturns.length > 0
      ? Array.from(new Set(overloadReturns.map(sanitizePublicText))).join(' | ')
      : `No explicit return annotation is declared for this ${kind}.`
  const errors =
    Array.isArray(record.errors) && record.errors.length > 0
      ? record.errors.map(String)
      : [`No documented errors are declared for ${name}.`]
  const lifecycleConcurrency =
    String(record.lifecycleConcurrency ?? '').trim() ||
    `No lifecycle or concurrency behavior is declared for ${name}.`
  const contractReference = createHash('sha256')
    .update(`${exportPath}:${source}:${name}:${overloadSignatures.join('|')}`)
    .digest('hex')
    .slice(0, 8)
  const advanced =
    String(record.advanced ?? '').trim() ||
    `No additional advanced behavior is declared for ${name} · ${contractReference}.`
  const importPath =
    exportPath === '.' ? packageName : `${packageName}/${exportPath.replace(/^\.\//, '')}`
  const argumentFor = (parameter: { name: string; type: string; optional: boolean }) => {
    if (parameter.optional) return 'undefined'
    if (/string/i.test(parameter.type)) return "'value'"
    if (/boolean/i.test(parameter.type)) return 'false'
    if (/number|bigint/i.test(parameter.type)) return '0'
    if (/=>|\bFunction\b/i.test(parameter.type)) return '() => undefined'
    if (/\[\]|Array|ReadonlyArray|Iterable/i.test(parameter.type)) return '[]'
    if (/object|Record|Map|Set|\{/.test(parameter.type)) return '{}'
    return `{} as ${sanitizePublicText(parameter.type)}`
  }
  const examples = overloadParameterDetails.map((details) => {
    const args = details.map(argumentFor).join(', ')
    return kind === 'function'
      ? `import { ${name} } from '${importPath}'\n\n${name}(${args})`
      : kind === 'class'
        ? `import { ${name} } from '${importPath}'\n\nnew ${name}(${args})`
        : kind === 'namespace'
          ? `import * as ${name} from '${importPath}'`
          : ['const', 'let', 'var'].includes(kind)
            ? `import { ${name} } from '${importPath}'\n\nvoid ${name}`
            : `import type { ${name} } from '${importPath}'\n\ntype Example = ${name}`
  })
  const uniqueExamples = Array.from(new Set(examples))
  const maintainedPurpose =
    documentedPurpose &&
    documentedPurpose.length <= 420 &&
    !/\bpackages?\b|\.\.\/packages|zh-cn/i.test(documentedPurpose)
      ? documentedPurpose
      : `${name} is part of this module's public ${kind} contract.`
  const declarationOwner = `${exportPath} · ${sourceLabel} · ${contractReference}`
  const purpose = `${maintainedPurpose} Declaration: ${declarationOwner}.`
  const whenUse = `Use ${name} from ${declarationOwner} when its ${kind} contract and declared inputs match the result you need.`
  const notUse = `Choose a different public symbol instead of ${name} from ${declarationOwner} when the required inputs or return contract do not match.`
  const core = `The core contract for ${name} · ${contractReference} is represented by the structured parameters, returns, errors, and lifecycle fields.`
  return {
    purpose,
    core,
    advanced,
    parameters,
    returns,
    errors,
    lifecycleConcurrency,
    examples: uniqueExamples,
    whenToUse: whenUse,
    notUse,
    parameterDetails,
    sections: [
      { id: 'introduction', title: '介绍', content: purpose },
      {
        id: 'getting-started',
        title: '上手',
        content: `Import ${name} from ${importPath}, then start with the smallest valid input shown below.`,
        example: uniqueExamples[0]
      },
      { id: 'when-to-use', title: '适用场景', content: `${whenUse} ${notUse}` },
      {
        id: 'quick-implementation',
        title: '快速实现',
        content: `Start from this source-backed ${kind} example and replace only the inputs required by your use case.`,
        example: uniqueExamples[0]
      },
      { id: 'core-usage', title: '核心用法', content: core },
      { id: 'advanced-usage', title: '高阶用法', content: advanced }
    ]
  }
}

/** Resolves an exports.types target, including declaration wildcard entries. */
function declarationFiles(directory: string, typeTarget: unknown): string[] {
  if (typeof typeTarget !== 'string') return []
  const absolute = resolve(directory, typeTarget)
  if (!typeTarget.includes('*')) return existsSync(absolute) ? [absolute] : []
  const wildcardIndex = absolute.indexOf('*')
  const prefix = absolute.slice(0, wildcardIndex)
  const suffix = absolute.slice(wildcardIndex + 1)
  const parent = resolve(prefix)
  if (!existsSync(parent)) return []
  return readdirSync(parent)
    .filter((name) => `${prefix}${name}${suffix}` === absolute.replace('*', name))
    .map((name) => join(parent, name))
    .filter((filePath) => filePath.endsWith('.d.ts'))
    .sort()
}

/** Builds canonical public symbols and alias-only export records from every export entry. */
function buildPublicSymbols(directory: string, manifest: Record<string, any>, exports: string[]) {
  const candidates: Array<Record<string, unknown>> = []
  const packageName =
    typeof manifest.name === 'string' ? manifest.name : `@migaia/${directory.split('/').at(-1)}`
  for (const exportPath of exports) {
    const target = manifest.exports?.[exportPath]
    const types = typeof target === 'string' ? target : target?.types
    for (const filePath of declarationFiles(directory, types)) {
      for (const record of declarationSymbols(filePath)) {
        const source = relative(resolve('..'), String(record.source)).split('\\').join('/')
        const targetFile =
          typeof types === 'string' && !types.includes('*') ? resolve(directory, types) : ''
        const isExplicitLeaf = targetFile === String(record.source)
        candidates.push({
          ...record,
          exportPath,
          source,
          isExplicitLeaf
        })
      }
    }
  }
  const overloadGroups = new Map<string, Array<Record<string, unknown>>>()
  for (const candidate of candidates) {
    const groupKey = `${String(candidate.source)}:${String(candidate.name)}:${String(candidate.exportPath)}`
    const group = overloadGroups.get(groupKey) ?? []
    group.push(candidate)
    overloadGroups.set(groupKey, group)
  }
  const groupedCandidates: Array<Record<string, unknown>> = []
  for (const group of overloadGroups.values()) {
    const ordered = [...group].sort(
      (left, right) => Number(left.declarationLine) - Number(right.declarationLine)
    )
    const first = ordered[0]
    if (!first) continue
    const signatures = Array.from(new Set(ordered.map((record) => String(record.signature))))
    const purposes = Array.from(
      new Set(ordered.map((record) => String(record.purpose ?? '').trim()).filter(Boolean))
    )
    const parameterSets = ordered.map((record) =>
      Array.isArray(record.parameterDetails) ? record.parameterDetails : []
    )
    const returns = Array.from(
      new Set(ordered.map((record) => String(record.returns ?? '').trim()).filter(Boolean))
    )
    groupedCandidates.push({
      ...first,
      signature: signatures.join('\n'),
      overloadSignatures: signatures,
      overloadParameterDetails: parameterSets,
      overloadReturns: returns,
      purpose: purposes.join(' '),
      declarationLine: Math.min(...ordered.map((record) => Number(record.declarationLine)))
    })
  }
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const candidate of groupedCandidates) {
    const groupKey = `${String(candidate.source)}:${String(candidate.name)}`
    const group = groups.get(groupKey) ?? []
    const exportPath = String(candidate.exportPath)
    const sourceSignature = String(candidate.signature)
    const identity = `${String(candidate.source)}:${String(candidate.name)}:${sourceSignature}`
    const details = buildSymbolSections({ ...candidate, identity }, packageName, exportPath)
    group.push({
      ...candidate,
      ...details,
      identity,
      signature: sanitizePublicText(sourceSignature),
      overloadSignatures: Array.isArray(candidate.overloadSignatures)
        ? candidate.overloadSignatures.map((signature) => sanitizePublicText(String(signature)))
        : undefined
    })
    groups.set(groupKey, group)
  }
  const ownerRank = (candidate: Record<string, unknown>) => {
    const exportPath = String(candidate.exportPath)
    const depth = exportPath === '.' ? 0 : exportPath.split('/').length
    if (candidate.isExplicitLeaf === true) return [0, depth, exportPath]
    if (exportPath !== '.') return [1, depth, exportPath]
    return [2, 0, exportPath]
  }
  const compareCandidates = (left: Record<string, unknown>, right: Record<string, unknown>) => {
    const leftRank = ownerRank(left)
    const rightRank = ownerRank(right)
    for (let index = 0; index < leftRank.length; index += 1) {
      if (leftRank[index] < rightRank[index]) return -1
      if (leftRank[index] > rightRank[index]) return 1
    }
    return String(left.exportPath).localeCompare(String(right.exportPath))
  }
  const symbols: Array<Record<string, unknown>> = []
  const aliases: Array<Record<string, unknown>> = []
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareCandidates)
    const owner = ordered[0]
    if (!owner) continue
    symbols.push(owner)
    for (const alias of ordered.slice(1)) {
      aliases.push({
        identity: owner.identity,
        name: alias.name,
        signature: alias.signature,
        source: alias.source,
        exportPath: alias.exportPath,
        ownerExportPath: owner.exportPath,
        ownerModule: moduleRouteSlug(String(owner.exportPath))
      })
    }
  }
  return {
    symbols: symbols.sort((left, right) =>
      `${String(left.exportPath)}:${String(left.name)}`.localeCompare(
        `${String(right.exportPath)}:${String(right.name)}`
      )
    ),
    aliases: aliases.sort((left, right) =>
      `${String(left.exportPath)}:${String(left.name)}`.localeCompare(
        `${String(right.exportPath)}:${String(right.name)}`
      )
    )
  }
}

/** Recursively returns content files in lexical order for reproducible manifests. */
function collectContentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .flatMap((entry) => {
      const entryPath = resolve(directory, entry.name)
      if (entry.isDirectory()) return collectContentFiles(entryPath)
      return /\.(?:md|mdx)$/.test(entry.name) ? [entryPath] : []
    })
}

/** Builds the maintained content inventory without inferring missing product facts. */
function buildContentEntries(contentRoot: string) {
  return collectContentFiles(contentRoot).map((filePath) => {
    const source = relative(resolve('.'), filePath).split('\\').join('/')
    const segments = source.split('/')
    const locale = segments[2]
    const library = segments[4]
    const fileName = segments.at(-1) ?? ''
    const slug = fileName === 'README.md' ? '' : fileName.replace(/\.(?:md|mdx)$/, '')
    return {
      locale,
      library,
      source,
      slug,
      format: fileName.endsWith('.mdx') ? 'mdx' : 'md'
    }
  })
}

/** Reads the current workspace library directories without inventing missing metadata. */
function buildLibraryEntries() {
  const packagesRoot = resolve('..', 'packages')
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((entry) => {
      const directory = join(packagesRoot, entry.name)
      const manifestPath = join(directory, 'package.json')
      const manifest = (() => {
        try {
          return JSON.parse(readFileSync(manifestPath, 'utf8'))
        } catch {
          return {}
        }
      })()
      const exports = Object.keys(manifest.exports ?? {}).sort()
      return {
        slug: entry.name,
        description: typeof manifest.description === 'string' ? manifest.description : null,
        version: typeof manifest.version === 'string' ? manifest.version : null,
        exports,
        ...(() => {
          const publicSymbols = buildPublicSymbols(directory, manifest, exports)
          return { publicSymbols: publicSymbols.symbols, publicAliases: publicSymbols.aliases }
        })(),
        source: manifest.name ? relative(resolve('.'), manifestPath).split('\\').join('/') : null
      }
    })
}

/** Writes content, route, and relationship projections through this canonical generator. */
async function generateManifests() {
  const contentRoot = resolve('src/content')
  const entries = buildContentEntries(contentRoot)
  const libraries = buildLibraryEntries()
  const manifestDirectory = resolve('src/generated/manifests')
  mkdirSync(manifestDirectory, { recursive: true })

  const content = {
    version: 1,
    entries
  }
  const knownLibraries = new Set(libraries.map((library) => library.slug))
  const routeEntriesRaw = LOCALES.flatMap((locale) =>
    DOMAINS.flatMap((domain) => [
      { path: `/${locale}/${domain}`, locale, domain, library: null },
      ...libraries.flatMap((library) => [
        { path: `/${locale}/${domain}/${library.slug}`, locale, domain, library: library.slug },
        {
          path: `/${locale}/${domain}/${library.slug}/overview`,
          locale,
          domain,
          library: library.slug
        },
        ...(domain === 'guides'
          ? [
              {
                path: `/${locale}/${domain}/${library.slug}/getting-started`,
                locale,
                domain,
                library: library.slug
              }
            ]
          : domain === 'architecture'
            ? [
                {
                  path: `/${locale}/${domain}/${library.slug}/ownership`,
                  locale,
                  domain,
                  library: library.slug
                }
              ]
            : []),
        ...library.exports.map((exportPath) => ({
          path: `/${locale}/${domain}/${library.slug}/${moduleRouteSlug(exportPath)}`,
          locale,
          domain,
          library: library.slug
        }))
      ])
    ])
  )
  const routeEntries = Array.from(
    new Map(routeEntriesRaw.map((entry) => [entry.path, entry])).values()
  )
  const contentRouteEntries = entries
    .filter((entry) => knownLibraries.has(entry.library))
    .map((entry) => ({
      path: `/${entry.locale}/docs/${entry.library}${entry.slug ? `/${entry.slug}` : ''}`,
      locale: entry.locale,
      domain: 'docs',
      library: entry.library
    }))
  const allRouteEntries = Array.from(
    new Map([...routeEntries, ...contentRouteEntries].map((entry) => [entry.path, entry])).values()
  )
  const routes = {
    version: 1,
    locales: [...LOCALES],
    families: ROUTE_FAMILIES,
    entries: allRouteEntries.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    )
  }
  const apis = libraries.flatMap((library) =>
    library.exports.map((exportPath) => {
      const slug = moduleRouteSlug(exportPath)
      const ownerSymbols = library.publicSymbols.filter(
        (symbol) => symbol.exportPath === exportPath
      )
      const symbols = ownerSymbols.map((symbol) => {
        const { isExplicitLeaf: _isExplicitLeaf, identity, ...publicSymbol } = symbol
        return {
          ...publicSymbol,
          identity,
          fragment: uniqueSymbolFragment(slug, String(symbol.name), String(identity))
        }
      })
      const aliases = library.publicAliases
        .filter((alias) => alias.exportPath === exportPath)
        .map((alias) => {
          const ownerIdentity = String(alias.identity)
          const aliasName = String(alias.name)
          const aliasSignature = String(alias.signature)
          const aliasSource = String(alias.source)
          const aliasExportPath = String(alias.exportPath)
          const ownerExportPath = String(alias.ownerExportPath)
          const ownerModule = String(alias.ownerModule)
          const ownerFragment = uniqueSymbolFragment(ownerModule, aliasName, ownerIdentity)
          return {
            identity: ownerIdentity,
            name: aliasName,
            signature: aliasSignature,
            source: aliasSource,
            exportPath: aliasExportPath,
            ownerExportPath,
            ownerModule,
            ownerFragment
          }
        })
      return {
        id: `${library.slug}:${slug}`,
        library: library.slug,
        module: slug,
        exportPath,
        sections: [
          'introduction',
          'getting-started',
          'when-to-use',
          'quick-implementation',
          'core-usage',
          'advanced-usage'
        ],
        guidePath: `/en/guides/${library.slug}/getting-started`,
        architecturePath: `/en/architecture/${library.slug}/ownership`,
        symbols,
        aliases
      }
    })
  )
  const domainRoutes = routeEntries.filter((entry) => entry.library)
  const apiRoutes = apis.flatMap((api) => {
    const docsPaths = LOCALES.map((locale) => `/${locale}/docs/${api.library}/${api.module}`)
    const guidePaths = LOCALES.map((locale) => `/${locale}/guides/${api.library}/getting-started`)
    const architecturePaths = LOCALES.map(
      (locale) => `/${locale}/architecture/${api.library}/ownership`
    )
    return docsPaths.flatMap((path, index) => [
      { from: path, to: guidePaths[index], type: 'api-guide' },
      { from: guidePaths[index], to: path, type: 'guide-api' },
      { from: path, to: architecturePaths[index], type: 'api-architecture' },
      { from: architecturePaths[index], to: path, type: 'architecture-api' },
      ...api.symbols.flatMap((symbol) => [
        { from: path, to: `${path}#${symbol.fragment}`, type: 'api-symbol' },
        { from: `${path}#${symbol.fragment}`, to: path, type: 'symbol-api' },
        {
          from: `${path}#${symbol.fragment}`,
          to: guidePaths[index],
          type: 'symbol-guide'
        },
        {
          from: guidePaths[index],
          to: `${path}#${symbol.fragment}`,
          type: 'guide-symbol'
        },
        {
          from: `${path}#${symbol.fragment}`,
          to: architecturePaths[index],
          type: 'symbol-architecture'
        },
        {
          from: architecturePaths[index],
          to: `${path}#${symbol.fragment}`,
          type: 'architecture-symbol'
        }
      ]),
      ...api.aliases.flatMap((alias) => {
        const ownerPath = `/${LOCALES[index]}/docs/${api.library}/${alias.ownerModule}`
        const aliasPath = `${path}#${alias.name}`
        const ownerTarget = `${ownerPath}#${alias.ownerFragment}`
        return [
          { from: aliasPath, to: ownerTarget, type: 'symbol-alias' },
          { from: ownerTarget, to: aliasPath, type: 'alias-symbol' }
        ]
      })
    ])
  })
  const relationships = {
    version: 1,
    edges: [
      ...entries
        .filter((entry) => knownLibraries.has(entry.library))
        .map((entry) => {
          const path = `/${entry.locale}/docs/${entry.library}${entry.slug ? `/${entry.slug}` : ''}`
          return [
            { from: path, to: entry.source, type: 'route-content' },
            { from: entry.source, to: path, type: 'content-route' }
          ]
        }),
      ...domainRoutes.flatMap((entry) => {
        const peer = domainRoutes.find(
          (candidate) =>
            candidate.locale === entry.locale &&
            candidate.library === entry.library &&
            candidate.domain !== entry.domain
        )
        return peer
          ? [
              { from: entry.path, to: peer.path, type: 'domain-peer' },
              { from: peer.path, to: entry.path, type: 'domain-peer' }
            ]
          : []
      }),
      ...apiRoutes
    ].flat()
  }

  const libraryManifest = {
    version: 1,
    libraries: libraries.map(
      ({
        source: _source,
        publicSymbols: _publicSymbols,
        publicAliases: _publicAliases,
        ...library
      }) => library
    )
  }
  const apiManifest = { version: 1, apis }
  const formattableApis = apiManifest.apis as unknown as Array<{
    library: string
    module: string
    symbols: Array<{
      name: string
      signature: string
      sections: Array<{ example?: string }>
    }>
  }>
  for (const api of formattableApis) {
    for (const symbol of api.symbols) {
      const formattedSignature = await format(`${symbol.name}.d.ts`, symbol.signature, {
        printWidth: 88,
        semi: true,
        singleQuote: true
      })
      if (formattedSignature.errors.length > 0) {
        throw new Error(`Unable to format ${api.library}/${api.module}#${symbol.name}`)
      }
      symbol.signature = formattedSignature.code.trim()
      for (const section of symbol.sections) {
        if (!section.example) continue
        const formattedExample = await format(`${symbol.name}.ts`, section.example, {
          printWidth: 88,
          semi: false,
          singleQuote: true
        })
        if (formattedExample.errors.length > 0) {
          throw new Error(`Unable to format example ${api.library}/${api.module}#${symbol.name}`)
        }
        section.example = formattedExample.code.trim()
      }
    }
  }
  for (const [name, value] of Object.entries({
    content,
    libraries: libraryManifest,
    apis: apiManifest,
    routes,
    relationships
  })) {
    writeFileSync(resolve(manifestDirectory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
  }
}

/** Runs the repository formatter over generated JSON so repeat runs share one byte form. */
function formatGeneratedJson() {
  const files = [
    ...PACKAGES.map((pkg) => resolve('src/generated/signatures', `${pkg}.json`)),
    ...['content', 'libraries', 'apis', 'routes', 'relationships'].map((name) =>
      resolve('src/generated/manifests', `${name}.json`)
    )
  ]
  const result = spawnSync('oxfmt', files, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('generated JSON formatting failed')
    process.exit(result.status || 1)
  }
}

async function generateSignatures() {
  const dir = resolve('src/generated/signatures')
  mkdirSync(dir, { recursive: true })

  for (const pkg of PACKAGES) {
    const output = { package: pkg, exports: [] }
    writeFileSync(resolve(dir, `${pkg}.json`), `${JSON.stringify(output, null, 2)}\n`)
    console.log(`✓ ${pkg}`)
  }
  await generateManifests()
  formatGeneratedJson()
}

generateSignatures().catch((e) => {
  console.error(e)
  process.exit(1)
})
