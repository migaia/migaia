#!/usr/bin/env bun
// P1: Extract API signatures from .d.ts files

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

/** Maintained task topics owned by the Guide information architecture. */
const GUIDE_TOPICS: Readonly<Record<string, readonly string[]>> = {
  utils: [
    'collector',
    'deadlines-and-abort',
    'retry-and-concurrency',
    'error-identity-and-causes',
    'bytes-and-text',
    'immutable-objects-and-paths',
    'configuration-ownership',
    'function-and-value-guards',
    'strings-and-numbers'
  ],
  tray: [
    'static-composition',
    'readiness-and-errors',
    'resource-ownership',
    'dynamic-host',
    'mutation-and-blocking',
    'physical-cleanup'
  ],
  wasm: [
    'initialization-and-hosts',
    'arena-memory',
    'conversion-boundaries',
    'ownership-and-cleanup'
  ],
  'store-light': [
    'object-store-model',
    'async-fields-and-readiness',
    'snapshots-and-hydration',
    'field-builders-and-mutation',
    'resources-and-suspense',
    'resource-versions-and-lifecycle'
  ],
  'store-keyed': [
    'definitions-and-scopes',
    'derived-and-writable-state',
    'optics-and-split-lists',
    'families-and-cache-identity',
    'preview-and-overrides',
    'release-and-disposal'
  ],
  'store-indexed': [
    'choose-a-collection',
    'tracking-and-cell-lifecycle',
    'array-index-semantics',
    'bulk-replacement-and-pruning',
    'mutation-guards-and-runtime',
    'disposal-and-errors'
  ],
  'store-middleware': [
    'binding-and-shared-policy',
    'events-and-plugins',
    'actions-and-mutation-boundaries',
    'snapshot-clone-policies',
    'devtools-and-state-commands',
    'pipeline-errors-and-reentrancy',
    'shutdown-and-ownership'
  ],
  'store-persist': [
    'choose-an-adapter',
    'hydration-and-startup-races',
    'partialize-merge-and-migrations',
    'write-queue-debounce-and-flush',
    'codecs-and-storage-capabilities',
    'keyed-families-and-clear',
    'retry-errors-and-shutdown'
  ],
  'store-react': [
    'provider-ownership-and-readiness',
    'selectors-and-concurrent-tracking',
    'atoms-and-definitions',
    'resources-and-suspense',
    'registry-and-dependency-injection',
    'features-and-config',
    'ssr-strict-mode-and-shutdown'
  ],
  'store-ssr': [
    'request-isolation-and-runtime',
    'register-and-own-state',
    'hydrate-and-dehydrate',
    'await-resources-and-timeouts',
    'embed-and-read-state',
    'custom-codecs-and-abort',
    'validation-security-and-trusted-path',
    'shutdown-errors-and-streaming'
  ],
  'store-devtools': [
    'session-and-history',
    'actions-and-runtime-trace',
    'time-travel-and-side-effects',
    'dependency-and-observer-trees',
    'clone-redaction-and-failure-containment',
    'command-bridge-boundary',
    'performance-and-disposal'
  ],
  'store-worker': [
    'choose-an-offload-path',
    'adapter-requests-and-cancellation',
    'worker-handlers-and-lifecycle',
    'resource-computed-and-cache',
    'serialization-worker-pipeline',
    'byte-copy-and-transfer-ownership',
    'errors-timeouts-and-cleanup',
    'performance-and-shutdown-order'
  ],
  'store-wasm': [
    'initialization-and-provider-readiness',
    'choose-a-field-layout',
    'number-boolean-and-string-fields',
    'array-granularity-and-bulk-writes',
    'record-layout-and-field-tracking',
    'memory-safety-views-and-capacity',
    'errors-rollback-and-disposal',
    'performance-and-when-not-to-use'
  ],
  'store-shared': [
    'environment-and-buffer-handoff',
    'shared-signal-and-sync',
    'shared-array-and-reactive-cells',
    'seqlock-and-contention',
    'dirty-pages-and-sparse-sync',
    'watch-waitasync-and-fallback',
    'atomic-update-and-low-level-primitives',
    'ownership-pruning-and-disposal',
    'security-capacity-and-recovery'
  ],
  capability: ['graph', 'graph-dynamic', 'graph-topology'],
  reactive: ['reactive', 'runtime'],
  lifecycle: ['scope', 'disposal', 'abort', 'quiescence', 'scheduler', 'generation', 'errors'],
  'event-subscriber': ['subscriptions', 'async-invocation'],
  'middleware-pipeline': ['sync-and-async', 'generators', 'cancellation-and-errors'],
  resource: ['caching-and-refresh', 'suspense-and-ssr', 'cancellation-and-retry'],
  serialize: [
    'chunk-shapes-and-wire-conversion',
    'registry-and-plugins',
    'streaming-and-backpressure',
    'shutdown-and-errors'
  ],
  'storage-contract': [
    'capability-narrowing',
    'safe-operations-and-keys',
    'records-indexes-and-transactions',
    'change-feed-and-subscription-ownership',
    'codecs-and-errors'
  ],
  'plugin-host': [
    'install-and-compose',
    'configuration-and-shared',
    'pipelines',
    'removal-and-rollback'
  ],
  logger: [
    'entries-hooks-and-sinks',
    'plugins-and-batching',
    'pipelines',
    'flush-and-shutdown',
    'runtime-and-forwarding'
  ],
  'web-rpc': [
    'endpoint-composition',
    'calls-and-cancellation',
    'providers-and-contracts',
    'transports-and-security',
    'discovery-and-control',
    'chunking-and-backpressure',
    'replay-retry-and-lifecycle'
  ],
  'storage-web': [
    'indexeddb-and-transactions',
    'entity-schema-and-codecs',
    'host-and-plugins',
    'reactive-live-queries',
    'cookies-and-security',
    'cancellation-errors-and-shutdown'
  ]
}

/** Converts maintained Markdown prose into safe website text without repository-only wording. */
function markdownText(value: string): string {
  return sanitizePublicText(value)
    .replace(/<a\s+[^>]*><\/a>/gi, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^>\s?/, '')
    .trim()
}

/** Splits dense maintained prose at sentence boundaries for a readable scanning rhythm. */
function proseParagraphs(value: string, maximumLength = 420): string[] {
  const rawSentences = value.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [value]
  const sentences = rawSentences.flatMap((sentence) => {
    if (sentence.length <= maximumLength) return [sentence]
    const clauses = sentence.match(/[^，、；;,]+[，、；;,]?/g) ?? [sentence]
    const chunks: string[] = []
    let chunk = ''
    for (const clause of clauses) {
      if (chunk && `${chunk}${clause}`.length > maximumLength) {
        chunks.push(chunk)
        chunk = clause
      } else chunk += clause
    }
    if (chunk) chunks.push(chunk)
    return chunks
  })
  const paragraphs: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const next = `${current}${sentence}`.trim()
    if (current && next.length > maximumLength) {
      paragraphs.push(current)
      current = sentence.trim()
    } else current = next
  }
  if (current) paragraphs.push(current)
  return paragraphs
}

type IMaintainedBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; headers: string[]; rows: string[][] }

type IMaintainedSection = {
  id: string
  heading: string
  blocks: IMaintainedBlock[]
}

/** Parses the maintained README/USEGUIDE subset into ordered semantic blocks. */
function maintainedDocument(filePath: string) {
  if (!existsSync(filePath)) return null
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  const sections: IMaintainedSection[] = []
  let section: IMaintainedSection = {
    id: 'introduction',
    heading: 'Introduction',
    blocks: []
  }
  let paragraph: string[] = []
  let list: string[] = []
  let table: string[][] = []
  let code: string[] | null = null
  let language = 'text'
  /** Active Markdown heading ancestry used to retain semantic parent sections. */
  const headingAncestors: string[] = []
  /** Commits buffered prose while preserving its original block order. */
  const flush = () => {
    if (paragraph.length > 0) {
      const text = markdownText(paragraph.join(' '))
      for (const readableParagraph of proseParagraphs(text))
        section.blocks.push({ type: 'paragraph', text: readableParagraph })
      paragraph = []
    }
    if (list.length > 0) {
      section.blocks.push({ type: 'list', items: list.map(markdownText).filter(Boolean) })
      list = []
    }
    if (table.length > 0) {
      const [headers, ...rows] = table
      if (headers) section.blocks.push({ type: 'table', headers, rows })
      table = []
    }
  }
  /** Commits the current section only when it contains maintained reader content. */
  const commitSection = () => {
    flush()
    if (section.blocks.length > 0) sections.push(section)
  }
  for (const line of lines) {
    const fence = line.match(/^```([\w-]*)/)
    if (fence) {
      if (code) {
        section.blocks.push({
          type: 'code',
          language,
          code: sanitizePublicText(code.join('\n').trim())
        })
        code = null
      } else {
        flush()
        code = []
        language = fence[1] || 'text'
      }
      continue
    }
    if (code) {
      code.push(line)
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      commitSection()
      const title = markdownText(heading[2].replace(/`/g, ''))
      const level = heading[1].length
      headingAncestors.length = level - 1
      const advancedParent = headingAncestors.find((ancestor) =>
        /高阶组合示例|高阶用法|进阶用法|性能特征|advanced usage|performance/i.test(ancestor)
      )
      headingAncestors[level - 1] = title
      const readerHeading = advancedParent ? `${advancedParent} · ${title}` : title
      section = {
        id: readerHeading
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
          .replace(/^-|-$/g, ''),
        heading: readerHeading,
        blocks: []
      }
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (paragraph.length > 0) flush()
      list.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line)) continue
      if (paragraph.length > 0 || list.length > 0) flush()
      table.push(line.trim().slice(1, -1).split('|').map(markdownText))
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    if (/^\s*(?:<a\s|---+$)/.test(line)) continue
    paragraph.push(line.trim())
  }
  commitSection()
  return { sections }
}

/** Returns searchable text for one maintained section without discarding code examples. */
function maintainedSectionText(section: IMaintainedSection): string {
  return `${section.heading} ${section.blocks
    .map((block) => {
      if (block.type === 'paragraph') return block.text
      if (block.type === 'list') return block.items.join(' ')
      if (block.type === 'table') return [...block.headers, ...block.rows.flat()].join(' ')
      return block.code
    })
    .join(' ')}`
}

/** Binds source-maintained task and configuration sections to the API they explain. */
function maintainedGuidanceForSymbol(
  documentation: {
    guide: ReturnType<typeof maintainedDocument>
    readme: ReturnType<typeof maintainedDocument>
  },
  symbolName: string
): IMaintainedSection[] {
  const normalizedName = symbolName.toLocaleLowerCase('en-US')
  const relatedHeading =
    /(?:style|config|option|preset|error|lifecycle|配置|选项|风格|错误|生命周期)/i
  const selected = [documentation.guide, documentation.readme]
    .flatMap((document) => document?.sections ?? [])
    .filter((section) => {
      const heading = section.heading.toLocaleLowerCase('en-US')
      const content = maintainedSectionText(section)
      return (
        heading === normalizedName ||
        (relatedHeading.test(section.heading) && content.includes(symbolName))
      )
    })
  return Array.from(
    new Map(
      selected.map((section) => [`${section.heading}:${JSON.stringify(section.blocks)}`, section])
    ).values()
  )
}

/** Finds every maintained section that explicitly names one public API. */
function maintainedContextForSymbol(
  documentation: {
    guide: ReturnType<typeof maintainedDocument>
    readme: ReturnType<typeof maintainedDocument>
  },
  symbolName: string
): IMaintainedSection[] {
  return Array.from(
    new Map(
      [documentation.guide, documentation.readme]
        .flatMap((document) => document?.sections ?? [])
        .filter((section) => maintainedSectionText(section).includes(symbolName))
        .map((section) => [`${section.heading}:${JSON.stringify(section.blocks)}`, section])
    ).values()
  )
}

/** Scores reader demand from maintained documentation rather than alphabetical declaration order. */
function maintainedUsageScore(
  documentation: {
    guide: ReturnType<typeof maintainedDocument>
    readme: ReturnType<typeof maintainedDocument>
  },
  symbolName: string
): number {
  const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const occurrence = new RegExp(`\\b${escapedName}\\b`, 'g')
  const documentScore = (
    document: ReturnType<typeof maintainedDocument>,
    documentWeight: number
  ): number =>
    (document?.sections ?? []).reduce((total, section) => {
      const text = maintainedSectionText(section)
      const mentions = text.match(occurrence)?.length ?? 0
      if (mentions === 0) return total
      const headingBonus = section.heading.includes(symbolName) ? 8 : 0
      const exampleBonus = section.blocks.some(
        (block) => block.type === 'code' && block.code.includes(symbolName)
      )
        ? 6
        : 0
      return total + mentions * documentWeight + headingBonus + exampleBonus
    }, 0)
  return documentScore(documentation.guide, 4) + documentScore(documentation.readme, 2)
}

/** Selects maintained executable examples and rejects declaration-shaped placeholders. */
function maintainedExamplesForSymbol(
  sections: readonly IMaintainedSection[],
  symbolName: string,
  kind: string
): string[] {
  const executableUse =
    kind === 'class'
      ? new RegExp(`\\bnew\\s+${symbolName}\\b`)
      : kind === 'function'
        ? new RegExp(
            `^(?!\\s*(?:declare\\s+)?function\\s+${symbolName}\\b).*\\b${symbolName}(?:<[^\\n>]+>)?\\s*\\(`,
            'm'
          )
        : new RegExp(`\\b${symbolName}\\b`)
  return Array.from(
    new Set(
      sections
        .flatMap((section) => section.blocks)
        .filter(
          (block): block is Extract<IMaintainedBlock, { type: 'code' }> => block.type === 'code'
        )
        .map((block) => block.code.trim())
        .filter((code) => code.length > 0 && executableUse.test(code))
    )
  )
}

/** Builds a field-level options index from maintained declarations and explanatory prose. */
function maintainedConfiguration(
  sections: readonly IMaintainedSection[],
  declaredFields: readonly {
    name: string
    type: string
    optional: boolean
    description: string
  }[] = []
) {
  const fields = new Map<
    string,
    { name: string; type: string; optional: boolean; description: string }
  >()
  for (const field of declaredFields) fields.set(field.name, field)
  const explanations = sections.flatMap((section) =>
    section.blocks.flatMap((block) => {
      if (block.type === 'paragraph') return [block.text]
      if (block.type === 'list') return block.items
      if (block.type === 'table') return block.rows.map((row) => row.join(' — '))
      return []
    })
  )
  return [...fields.values()].map((field) => {
    const maintainedDescription = explanations.find(
      (explanation) =>
        explanation.includes(`options.${field.name}`) ||
        new RegExp(`\\x60[^\\x60]*\\b${field.name}\\b[^\\x60]*\\x60`).test(explanation) ||
        explanation.startsWith(`${field.name} `) ||
        (field.name === 'style' && /^style\s/i.test(explanation))
    )
    const description = maintainedDescription ?? field.description
    return {
      ...field,
      description,
      descriptionEn:
        maintainedDescription && !/[\u3400-\u9fff]/.test(maintainedDescription)
          ? maintainedDescription
          : !/[\u3400-\u9fff]/.test(field.description)
            ? field.description
            : '',
      descriptionZh:
        maintainedDescription && /[\u3400-\u9fff]/.test(maintainedDescription)
          ? maintainedDescription
          : /[\u3400-\u9fff]/.test(field.description)
            ? field.description
            : ''
    }
  })
}

/** Extracts public fields and their source JSDoc from an options/config object declaration. */
function declarationConfigurationFields(signature: string, includeMutable = false) {
  const fields: Array<{
    name: string
    type: string
    optional: boolean
    description: string
  }> = []
  const fieldRanges: Array<{ name: string; start: number; end: number }> = []
  const propertyPattern = includeMutable
    ? /\b(?:readonly\s+)?(\w+)(\?)?\s*:/g
    : /readonly\s+(\w+)(\?)?\s*:/g
  const syntax = signature.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))
  for (const match of syntax.matchAll(propertyPattern)) {
    const rawName = match[1]
    if (!rawName || match.index === undefined) continue
    let roundDepthAtField = 0
    let squareDepthAtField = 0
    for (const character of signature.slice(0, match.index)) {
      if (character === '(') roundDepthAtField += 1
      else if (character === ')') roundDepthAtField = Math.max(0, roundDepthAtField - 1)
      else if (character === '[') squareDepthAtField += 1
      else if (character === ']') squareDepthAtField = Math.max(0, squareDepthAtField - 1)
    }
    if (roundDepthAtField > 0 || squareDepthAtField > 0) continue
    const typeStart = match.index + match[0].length
    let angleDepth = 0
    let roundDepth = 0
    let squareDepth = 0
    let curlyDepth = 0
    let typeEnd = signature.length
    for (let index = typeStart; index < signature.length; index += 1) {
      const character = signature[index]
      if (character === '<') angleDepth += 1
      else if (character === '>') angleDepth = Math.max(0, angleDepth - 1)
      else if (character === '(') roundDepth += 1
      else if (character === ')') roundDepth = Math.max(0, roundDepth - 1)
      else if (character === '[') squareDepth += 1
      else if (character === ']') squareDepth = Math.max(0, squareDepth - 1)
      else if (character === '{') curlyDepth += 1
      else if (character === '}') {
        if (curlyDepth === 0) {
          typeEnd = index
          break
        }
        curlyDepth -= 1
      } else if (
        character === ';' &&
        angleDepth === 0 &&
        roundDepth === 0 &&
        squareDepth === 0 &&
        curlyDepth === 0
      ) {
        typeEnd = index
        break
      }
    }
    const prefix = signature.slice(0, match.index)
    const docStart = prefix.lastIndexOf('/**')
    const docEnd = docStart >= 0 ? prefix.indexOf('*/', docStart) : -1
    const description =
      docStart >= 0 && docEnd >= 0 && !prefix.slice(docEnd + 2).trim()
        ? prefix
            .slice(docStart + 3, docEnd)
            .replace(/^\s*\* ?/gm, '')
            .replace(/\s+/g, ' ')
            .trim()
        : ''
    const parent = fieldRanges
      .filter((range) => match.index! > range.start && match.index! < range.end)
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0]
    const name = parent ? `${parent.name}.${rawName}` : rawName
    const fieldType = signature.slice(typeStart, typeEnd).replace(/\s+/g, ' ').trim()
    fields.push({
      name,
      type: fieldType,
      optional: match[2] === '?',
      description
    })
    if (/^(?:Readonly<)?\s*\{/.test(fieldType))
      fieldRanges.push({ name, start: typeStart, end: typeEnd })
  }
  return fields
}

/** Resolves Options/Config object fields referenced by one runtime declaration. */
function configurationFromDeclarations(
  candidate: Readonly<Record<string, unknown>>,
  candidates: readonly Readonly<Record<string, unknown>>[],
  sourceDescriptions: ReadonlyMap<string, string>
) {
  if (candidate.kind === 'type' || candidate.kind === 'interface') return []
  const includeMutable = /(?:^|[/\\])packages[/\\](?:logger|plugin-host|reactive)[/\\]/.test(
    String(candidate.source)
  )
  const declarationsByName = new Map(
    candidates
      .filter((record) => record.kind === 'type' || record.kind === 'interface')
      .map((record) => [String(record.name), record])
  )
  const candidateSignature = String(candidate.signature)
  const configurationOwnerSignature =
    candidate.kind === 'class' ? classConstructorSignature(candidateSignature) : candidateSignature
  const pending = Array.from(
    new Set(configurationOwnerSignature.match(/\bI[A-Za-z0-9]*(?:Options|Config)\b/g) ?? [])
  ).map((name) => ({ name, prefix: '' }))
  const visited = new Set<string>()
  const fields = new Map<
    string,
    { name: string; type: string; optional: boolean; description: string }
  >()
  while (pending.length > 0) {
    const next = pending.shift()
    if (!next) continue
    const { name, prefix } = next
    const visitKey = `${prefix}:${name}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)
    const declaration = declarationsByName.get(name)
    if (!declaration) continue
    const signature = String(declaration.signature)
    for (const field of declarationConfigurationFields(signature, includeMutable)) {
      const leafName = field.name.split('.').at(-1) ?? field.name
      const fieldName = prefix ? `${prefix}.${field.name}` : field.name
      if (!fields.has(fieldName))
        fields.set(fieldName, {
          ...field,
          name: fieldName,
          description:
            field.description ||
            sourceDescriptions.get(`${name}:${field.name}`) ||
            sourceDescriptions.get(`${name}:${leafName}`) ||
            sourceDescriptions.get(leafName) ||
            ''
        })
      for (const dependency of field.type.match(/\bI[A-Za-z0-9]*(?:Options|Config)\b/g) ?? [])
        pending.push({ name: dependency, prefix: fieldName })
    }
    for (const dependency of signature.match(/\bI[A-Za-z0-9]*(?:Options|Config)\b/g) ?? []) {
      const referencedByField = declarationConfigurationFields(signature, includeMutable).some(
        (field) => field.type.includes(dependency)
      )
      if (!referencedByField) pending.push({ name: dependency, prefix })
    }
  }
  return [...fields.values()]
}

/** Reads current package source JSDoc so documentation does not depend on a prebuilt declaration. */
function sourceConfigurationDescriptions(directory: string): Map<string, string> {
  const sourceRoot = join(directory, 'src')
  if (!existsSync(sourceRoot)) return new Map()
  const candidates = new Map<string, Set<string>>()
  const includeMutable = /[/\\](?:logger|plugin-host|reactive)$/.test(directory)
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name)
      if (entry.isDirectory()) {
        visit(entryPath)
        continue
      }
      if (!/\.(?:ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
      const source = readFileSync(entryPath, 'utf8')
      const typeStarts = Array.from(source.matchAll(/export\s+type\s+(I\w*(?:Options|Config))\b/g))
      for (let index = 0; index < typeStarts.length; index += 1) {
        const start = typeStarts[index]
        const name = start?.[1]
        if (!start || !name || start.index === undefined) continue
        const end = declarationEnd(source, start.index, 'type')
        const declaration = source.slice(start.index, end)
        for (const field of declarationConfigurationFields(declaration, includeMutable)) {
          if (!field.description) continue
          const key = `${name}:${field.name}`
          const descriptions = candidates.get(key) ?? new Set<string>()
          descriptions.add(field.description)
          candidates.set(key, descriptions)
        }
      }
      for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*readonly\s+(\w+)(?:\?)?\s*:/g)) {
        const name = match[2]
        const description = (match[1] ?? '')
          .replace(/^\s*\* ?/gm, '')
          .replace(/\s+/g, ' ')
          .trim()
        if (!name || !description) continue
        const descriptions = candidates.get(name) ?? new Set<string>()
        descriptions.add(description)
        candidates.set(name, descriptions)
      }
    }
  }
  visit(sourceRoot)
  return new Map(
    [...candidates]
      .filter(([, descriptions]) => descriptions.size === 1)
      .map(([name, descriptions]) => [name, [...descriptions][0] ?? ''])
  )
}

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

/** Produces a stable semantic URL segment, adding kind only for case-folding collisions. */
function symbolRouteSlug(
  symbol: Readonly<Record<string, unknown>>,
  siblings: readonly Readonly<Record<string, unknown>>[]
): string {
  const collisions = siblings.filter(
    (candidate) =>
      String(candidate.name).toLocaleLowerCase('en-US') ===
      String(symbol.name).toLocaleLowerCase('en-US')
  )
  return `${encodeURIComponent(String(symbol.name))}${collisions.length > 1 ? `-${String(symbol.kind)}` : ''}`
}

/** Converts a declaration name into a stable fragment without inventing meaning. */
function symbolFragment(module: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
  return `${module}--${safeName || 'symbol'}`
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
    if (')]}'.includes(character)) depth -= 1
    if (character === '>' && depth > 0) depth -= 1
    if ((character === ',' && depth === 0) || index === text.length) {
      const parameter = text.slice(start, index).trim()
      if (parameter) {
        const match = parameter.match(/^([A-Za-z_$][\w$]*)(\?)?\s*(?::\s*(.*))?$/)
        const name = match?.[1] ?? parameter
        const type = match?.[3]?.trim() || 'unknown'
        values.push({ name, type, optional: Boolean(match?.[2]) })
      }
      start = index + 1
    }
  }
  return values
}

/** Extracts public constructor parameters from one class declaration. */
function classConstructorParameters(signature: string) {
  const constructorStart = signature.search(/\bconstructor\s*\(/)
  if (constructorStart < 0) return []
  return declarationParameters(signature.slice(constructorStart))
}

/** Returns only the public constructor declaration from a class signature. */
function classConstructorSignature(signature: string): string {
  const constructorStart = signature.search(/\bconstructor\s*\(/)
  if (constructorStart < 0) return ''
  const constructorSignature = signature.slice(constructorStart)
  const open = constructorSignature.indexOf('(')
  const close = closingParenthesis(constructorSignature, open)
  return close < 0 ? constructorSignature : constructorSignature.slice(0, close + 1)
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
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|namespace)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declarationPattern)) {
    const kind = match[1]
    const name = match[2]
    const declarationStart = match.index ?? 0
    const lineStart = source.lastIndexOf('\n', declarationStart) + 1
    const end = declarationEnd(source, declarationStart, kind)
    const signature = source.slice(declarationStart, end).trim().replace(/\s+/g, ' ')
    const parameterDetails =
      kind === 'function'
        ? declarationParameters(signature)
        : kind === 'class'
          ? classConstructorParameters(signature)
          : []
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
    ...source.matchAll(/export\s+(?:type\s+)?(\*|\{([^}]+)\})\s+from\s+['"]([^'"]+)['"]/g)
  ]
  for (const reexport of reexports) {
    const specifier = reexport[3]
    if (!specifier.startsWith('.')) continue
    const target = resolve(join(filePath, '..'), specifier.replace(/\.js$/, '') + '.d.ts')
    if (!existsSync(target)) continue
    const targetRecords = declarationSymbols(target, new Set(visited))
    if (reexport[1] === '*') {
      records.push(...targetRecords)
      continue
    }
    const bindings = (reexport[2] ?? '').split(',').map((binding) => {
      const normalized = binding.trim().replace(/^type\s+/, '')
      const [imported, exported = imported] = normalized.split(/\s+as\s+/)
      return { imported: imported.trim(), exported: exported.trim() }
    })
    for (const binding of bindings) {
      for (const record of targetRecords.filter(
        (candidate) => String(candidate.name) === binding.imported
      )) {
        const signature = String(record.signature).replace(
          new RegExp(`\\b${binding.imported}\\b`),
          binding.exported
        )
        records.push({
          ...record,
          name: binding.exported,
          signature,
          aliasOf: binding.imported
        })
      }
    }
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
  const documentedPurpose = sanitizePublicText(String(record.purpose ?? '').trim())
  const overloadParameterDetails = Array.isArray(record.overloadParameterDetails)
    ? (record.overloadParameterDetails as Array<
        Array<{ name: string; type: string; optional: boolean }>
      >)
    : [
        Array.isArray(record.parameterDetails)
          ? (record.parameterDetails as Array<{ name: string; type: string; optional: boolean }>)
          : []
      ]
  const parameterDetails = Array.from(
    new Map(
      overloadParameterDetails
        .flat()
        .map((parameter) => [
          `${parameter.name}:${parameter.type}:${parameter.optional ? 'optional' : 'required'}`,
          parameter
        ])
    ).values()
  )
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
  const advanced =
    String(record.advanced ?? '').trim() ||
    `No additional advanced behavior is declared for ${name}.`
  const importPath =
    exportPath === '.' ? packageName : `${packageName}/${exportPath.replace(/^\.\//, '')}`
  const maintainedPurpose =
    documentedPurpose &&
    documentedPurpose.length <= 420 &&
    !/\bpackages?\b|\.\.\/packages|zh-cn/i.test(documentedPurpose)
      ? documentedPurpose
      : `${name} is part of this module's public ${kind} contract.`
  const purpose = maintainedPurpose
  const whenUse = `Use ${name} when its ${kind} contract and declared inputs match the result you need.`
  const notUse = `Choose a different public symbol when ${name} does not match the required inputs or return contract.`
  const core = `The structured inputs, output, errors, and lifecycle facts below define the public contract for ${name}.`
  return {
    purpose,
    core,
    advanced,
    parameters,
    returns,
    errors,
    lifecycleConcurrency,
    examples: [],
    whenToUse: whenUse,
    notUse,
    parameterDetails,
    sections: [
      { id: 'introduction', title: '介绍', content: purpose },
      {
        id: 'getting-started',
        title: '上手',
        content: `Import ${name} from ${importPath}, then follow a maintained task example for your use case.`
      },
      { id: 'when-to-use', title: '适用场景', content: `${whenUse} ${notUse}` },
      {
        id: 'quick-implementation',
        title: '快速实现',
        content: `Use a maintained ${kind} example that demonstrates real inputs and observable behavior.`
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
  const sourceDescriptions = sourceConfigurationDescriptions(directory)
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
      declaredConfiguration: configurationFromDeclarations(
        candidate,
        groupedCandidates,
        sourceDescriptions
      ),
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
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'package.json'))
    )
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
        documentation: {
          readme: maintainedDocument(join(directory, 'README.md')),
          guide: maintainedDocument(join(directory, 'USEGUIDE.md'))
        },
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
        ...(domain === 'docs'
          ? [
              {
                path: `/${locale}/${domain}/${library.slug}/overview`,
                locale,
                domain,
                library: library.slug
              }
            ]
          : []),
        ...(domain === 'guides'
          ? [
              {
                path: `/${locale}/${domain}/${library.slug}/getting-started`,
                locale,
                domain,
                library: library.slug
              },
              ...(GUIDE_TOPICS[library.slug] ?? []).map((topic) => ({
                path: `/${locale}/${domain}/${library.slug}/${topic}`,
                locale,
                domain,
                library: library.slug
              }))
            ]
          : []),
        ...library.exports
          .filter(() => domain === 'docs')
          .flatMap((exportPath) => {
            const moduleSlug = moduleRouteSlug(exportPath)
            const modulePath = `/${locale}/${domain}/${library.slug}${moduleSlug === 'index' ? '' : `/${moduleSlug}`}`
            const moduleEntry = {
              path: modulePath,
              locale,
              domain,
              library: library.slug
            }
            if (domain !== 'docs') return [moduleEntry]
            /**
             * All module declarations need prerender admission, while the page keeps typing
             * subordinate.
             */
            const moduleSymbols = library.publicSymbols.filter(
              (symbol) => symbol.exportPath === exportPath
            )
            const symbolEntries = moduleSymbols.map((symbol) => {
              return {
                path: `${modulePath}/${symbolRouteSlug(symbol, moduleSymbols)}`,
                locale,
                domain,
                library: library.slug
              }
            })
            return [moduleEntry, ...symbolEntries]
          })
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
  const rawApis = libraries.flatMap((library) =>
    library.exports.map((exportPath) => {
      const slug = moduleRouteSlug(exportPath)
      const ownerSymbols = library.publicSymbols.filter(
        (symbol) => symbol.exportPath === exportPath
      )
      const symbols = ownerSymbols.map((symbol) => {
        const { isExplicitLeaf: _isExplicitLeaf, identity, ...publicSymbol } = symbol
        const guidance = maintainedGuidanceForSymbol(library.documentation, String(symbol.name))
        const maintainedContext = maintainedContextForSymbol(
          library.documentation,
          String(symbol.name)
        )
        const maintainedExamples = maintainedExamplesForSymbol(
          maintainedContext,
          String(symbol.name),
          String(symbol.kind)
        )
        return {
          ...publicSymbol,
          identity,
          guidance,
          examples: maintainedExamples,
          usageScore: maintainedUsageScore(library.documentation, String(symbol.name)),
          configuration: maintainedConfiguration(
            maintainedContext,
            Array.isArray(symbol.declaredConfiguration) ? symbol.declaredConfiguration : []
          ),
          fragment: symbolFragment(`${library.slug}-${slug}`, symbolRouteSlug(symbol, ownerSymbols))
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
          const ownerSymbol = library.publicSymbols.find(
            (symbol) => symbol.identity === ownerIdentity && symbol.exportPath === ownerExportPath
          )
          const ownerSiblings = library.publicSymbols.filter(
            (symbol) => symbol.exportPath === ownerExportPath
          )
          const ownerFragment = symbolFragment(
            `${library.slug}-${ownerModule}`,
            ownerSymbol ? symbolRouteSlug(ownerSymbol, ownerSiblings) : aliasName
          )
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
        architecturePath: `/en/architecture/${library.slug}`,
        symbols,
        aliases
      }
    })
  )
  /** Reuses one canonical field explanation across aliases and preset entry points in a library. */
  const descriptionCandidates = new Map<string, Set<string>>()
  const descriptionCandidatesEn = new Map<string, Set<string>>()
  const descriptionCandidatesZh = new Map<string, Set<string>>()
  for (const api of rawApis)
    for (const symbol of api.symbols)
      for (const field of symbol.configuration) {
        if (!field.description) continue
        const key = `${api.library}:${field.name}:${field.type}`
        const candidates = descriptionCandidates.get(key) ?? new Set<string>()
        candidates.add(field.description)
        descriptionCandidates.set(key, candidates)
        for (const [localizedDescription, target] of [
          [field.descriptionEn, descriptionCandidatesEn],
          [field.descriptionZh, descriptionCandidatesZh]
        ] as const) {
          if (!localizedDescription) continue
          const localizedCandidates = target.get(key) ?? new Set<string>()
          localizedCandidates.add(localizedDescription)
          target.set(key, localizedCandidates)
        }
      }
  /** Maintained descriptions for setupHost fields whose declaration comments live above aliases. */
  const setupHostDescriptions: Readonly<Record<string, string>> = {
    setupTimeoutMs: 'Maximum time allowed for core creation and the initial plugin transaction.',
    signal: 'Abort signal that cancels setup and triggers rollback of resources already created.',
    core: 'Factory that creates the domain core before any plugin installer runs.',
    plugins:
      'Initial plugin definitions installed together before the returned view becomes visible.',
    'host.diagnostic': 'Optional sink for queue, lifecycle, and pipeline diagnostics.',
    'host.pipeline.mode': 'Selects the admitted pipeline execution mode for the new host.'
  }
  const apis = rawApis.map((api) => ({
    ...api,
    symbols: api.symbols.map((symbol) => {
      const configuration = symbol.configuration
        .filter((field) => !field.name.startsWith('__'))
        .map((field) => {
          const candidates = descriptionCandidates.get(`${api.library}:${field.name}:${field.type}`)
          const candidatesEn = descriptionCandidatesEn.get(
            `${api.library}:${field.name}:${field.type}`
          )
          const candidatesZh = descriptionCandidatesZh.get(
            `${api.library}:${field.name}:${field.type}`
          )
          const setupHostDescription =
            api.library === 'plugin-host' && api.module === 'defined'
              ? setupHostDescriptions[field.name]
              : undefined
          return {
            ...field,
            description:
              field.description ||
              (candidates?.size === 1 ? ([...candidates][0] ?? '') : '') ||
              setupHostDescription ||
              '',
            descriptionEn:
              field.descriptionEn ||
              (candidatesEn?.size === 1 ? ([...candidatesEn][0] ?? '') : '') ||
              setupHostDescription ||
              '',
            descriptionZh:
              field.descriptionZh || (candidatesZh?.size === 1 ? ([...candidatesZh][0] ?? '') : '')
          }
        })
      return {
        ...symbol,
        configuration: configuration.map((field) => {
          if (field.description) return field
          const children = configuration.filter((candidate) =>
            candidate.name.startsWith(`${field.name}.`)
          )
          return children.length > 0
            ? {
                ...field,
                description: `Groups ${children.map((child) => `\`${child.name}\``).join(', ')}; configure the nested fields below.`,
                descriptionEn: `Groups ${children.map((child) => `\`${child.name}\``).join(', ')}; configure the nested fields below.`
              }
            : field
        })
      }
    })
  }))
  const domainRoutes = routeEntries.filter((entry) => entry.library)
  const apiRoutes = apis.flatMap((api) => {
    const docsPaths = LOCALES.map(
      (locale) => `/${locale}/docs/${api.library}${api.module === 'index' ? '' : `/${api.module}`}`
    )
    const guidePaths = LOCALES.map((locale) => `/${locale}/guides/${api.library}/getting-started`)
    const architecturePaths = LOCALES.map((locale) => `/${locale}/architecture/${api.library}`)
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
        const ownerPath = `/${LOCALES[index]}/docs/${api.library}${alias.ownerModule === 'index' ? '' : `/${alias.ownerModule}`}`
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
  /** Narrow public import owners used to keep reader examples tree-shaking friendly. */
  const exampleImports = {
    version: 1,
    packages: Object.fromEntries(
      libraries.map((library) => {
        const packageName = `@migaia/${library.slug}`
        const candidates = new Map<string, string[]>()
        for (const api of apiManifest.apis.filter(
          (candidate) => candidate.library === library.slug && candidate.exportPath !== '.'
        )) {
          for (const symbol of api.symbols) {
            const symbolRecord = symbol as Record<string, unknown>
            const symbolName = String(symbolRecord.name)
            const source = String(symbolRecord.source)
            const wildcardPath = api.exportPath.includes('*')
              ? `./${source.replace(`packages/${library.slug}/dist/`, '').replace(/\.d\.ts$/u, '')}`
              : api.exportPath
            const importPath = `${packageName}/${wildcardPath.replace(/^\.\//u, '')}`
            const paths = candidates.get(symbolName) ?? []
            paths.push(importPath)
            candidates.set(symbolName, paths)
          }
        }
        return [
          packageName,
          Object.fromEntries(
            [...candidates.entries()]
              .map(([symbol, paths]) => [
                symbol,
                [...new Set(paths)].sort(
                  (left, right) => left.length - right.length || left.localeCompare(right)
                )[0]
              ])
              .sort(([left], [right]) => left.localeCompare(right))
          )
        ]
      })
    )
  }
  /** Lightweight navigation facts that never carry maintained documents or API bodies. */
  const libraryIndexManifest = {
    version: 1,
    libraries: libraryManifest.libraries.map(
      ({ documentation: _documentation, ...library }) => library
    )
  }
  /** Per-library payloads loaded only after a route selects its canonical library. */
  const libraryShardDirectory = resolve(manifestDirectory, 'libraries')
  mkdirSync(libraryShardDirectory, { recursive: true })
  for (const library of libraryManifest.libraries) {
    const shard = {
      version: 1,
      library,
      apis: apiManifest.apis.filter((api) => api.library === library.slug)
    }
    writeFileSync(
      resolve(libraryShardDirectory, `${library.slug}.json`),
      `${JSON.stringify(shard, null, 2)}\n`
    )
  }
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
    'library-index': libraryIndexManifest,
    'example-imports': exampleImports,
    apis: apiManifest,
    routes,
    relationships
  })) {
    writeFileSync(resolve(manifestDirectory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
  }
}

/** Runs the repository formatter over generated JSON so repeat runs share one byte form. */
function formatGeneratedJson() {
  /** Current per-library shards emitted by the canonical generator. */
  const libraryShards = readdirSync(resolve('src/generated/manifests/libraries')).map((name) =>
    resolve('src/generated/manifests/libraries', name)
  )
  const files = [
    ...PACKAGES.map((pkg) => resolve('src/generated/signatures', `${pkg}.json`)),
    ...[
      'content',
      'libraries',
      'library-index',
      'example-imports',
      'apis',
      'routes',
      'relationships'
    ].map((name) => resolve('src/generated/manifests', `${name}.json`)),
    ...libraryShards
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
