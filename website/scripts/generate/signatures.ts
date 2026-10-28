#!/usr/bin/env bun
// Extract API signatures from .d.ts files

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { format } from 'oxfmt'
import { referenceFor } from '../../app/reference/index.ts'
import type { IMemberDoc } from '../../app/reference/contract.ts'

const PACKAGES = [
  'utils',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'reactive',
  'serialize',
  'storage-contract',
  'storage-host',
  'storage-plugin-redis',
  'storage-plugin-postgres',
  'storage-plugin-sqlite',
  'storage-plugin-qdrant',
  'storage-plugin-sparql',
  'storage-plugin-object',
  'storage-plugin-cache',
  'storage-plugin-archive',
  'plugin-host',
  'resource',
  'rpc-contract',
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser',
  'rpc-plugin-coroutines',
  'rpc-plugin-pool',
  'rpc-plugin-devtools',
  'log-host',
  'log-plugin-console',
  'log-plugin-http',
  'log-plugin-file',
  'log-plugin-process',
  'log-plugin-reasoning',
  'log-plugin-durable',
  'store-persist',
  'store-wasm',
  'storage-web'
]

/** These retired documentation owners have no routes, aliases, or successful-generation shards. */
const RETIRED_LIBRARIES = [
  'rpc-core',
  'rpc-process',
  'rpc-threads',
  'rpc-browser',
  'rpc-pool',
  'rpc-devtools',
  'logger'
]

/** Validates optional direct-entry arguments before any generator path can write projections. */
export function parseSelectedLibrary(args: readonly string[]): string | null {
  if (args.length === 0) return null
  if (args.length !== 2 || args[0] !== '--library' || !PACKAGES.includes(args[1])) {
    throw new Error('Expected --library followed by one known library slug')
  }
  return args[1]
}

/** Optional library owner selected for a bounded direct regeneration. */
const selectedLibrary = import.meta.main ? parseSelectedLibrary(process.argv.slice(2)) : null

/** Tests whether a generated route or source path contains one exact library path segment. */
function hasLibraryPathSegment(value: unknown, library: string) {
  return typeof value === 'string' && new RegExp(`(?:^|/)${library}(?:/|$)`, 'u').test(value)
}

/** Reads an existing aggregate projection before replacing only its selected library-owned portion. */
function readGeneratedJson(path: string) {
  if (!existsSync(path)) throw new Error(`Missing generated projection ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

/** Replaces selected owner records in place so untouched aggregate ordering remains byte-stable. */
export function replaceOwnedEntries(
  previous: unknown[],
  next: unknown[],
  owns: (entry: unknown) => boolean,
  label: string
) {
  const replacements = next.filter(owns)
  if (replacements.length === 0) throw new Error(`Missing ${label}`)
  let index = 0
  const merged: unknown[] = []
  for (const entry of previous) {
    if (!owns(entry)) {
      merged.push(entry)
      continue
    }
    const replacement = replacements[index++]
    if (replacement !== undefined) merged.push(replacement)
  }
  return [...merged, ...replacements.slice(index)]
}

/** Merges a selected library projection while preserving nonselected aggregate data and order. */
function mergeLibraryProjection(name: string, next: Record<string, unknown>, library: string) {
  const path = resolve('src/generated/manifests', `${name}.json`)
  const previous = readGeneratedJson(path)
  if (name === 'content') {
    const entries = next.entries
    const priorEntries = previous.entries
    if (!Array.isArray(entries) || !Array.isArray(priorEntries))
      throw new Error(`Invalid ${name} entries`)
    if (!entries.some((entry) => (entry as { library?: unknown }).library === library)) {
      if (!priorEntries.some((entry) => (entry as { library?: unknown }).library === library))
        return previous
      throw new Error(`Missing ${library} ${name} entries`)
    }
    return {
      ...previous,
      entries: replaceOwnedEntries(
        priorEntries,
        entries,
        (entry) => (entry as { library?: unknown }).library === library,
        `${library} ${name} entries`
      )
    }
  }
  if (name === 'libraries' || name === 'library-index') {
    const libraries = next.libraries
    const priorLibraries = previous.libraries
    if (!Array.isArray(libraries) || !Array.isArray(priorLibraries))
      throw new Error(`Invalid ${name} libraries`)
    if (!libraries.some((entry) => (entry as { slug?: unknown }).slug === library)) {
      throw new Error(`Missing ${library} ${name} entry`)
    }
    return {
      ...previous,
      libraries: replaceOwnedEntries(
        priorLibraries,
        libraries,
        (entry) => (entry as { slug?: unknown }).slug === library,
        `${library} ${name} entry`
      )
    }
  }
  if (name === 'apis') {
    const apis = next.apis
    const priorApis = previous.apis
    if (!Array.isArray(apis) || !Array.isArray(priorApis)) throw new Error('Invalid apis entries')
    if (!apis.some((entry) => (entry as { library?: unknown }).library === library)) {
      throw new Error(`Missing ${library} apis entries`)
    }
    return {
      ...previous,
      apis: replaceOwnedEntries(
        priorApis,
        apis,
        (entry) => (entry as { library?: unknown }).library === library,
        `${library} apis entries`
      )
    }
  }
  if (name === 'routes') {
    const entries = next.entries
    const priorEntries = previous.entries
    if (!Array.isArray(entries) || !Array.isArray(priorEntries))
      throw new Error('Invalid routes entries')
    if (!entries.some((entry) => (entry as { library?: unknown }).library === library)) {
      throw new Error(`Missing ${library} routes entries`)
    }
    return {
      ...previous,
      entries: replaceOwnedEntries(
        priorEntries,
        entries,
        (entry) => (entry as { library?: unknown }).library === library,
        `${library} routes entries`
      )
    }
  }
  if (name === 'example-imports') {
    const packageName = `@migaia/${library}`
    const packages = next.packages
    const priorPackages = previous.packages
    if (
      !packages ||
      typeof packages !== 'object' ||
      !priorPackages ||
      typeof priorPackages !== 'object' ||
      !(packageName in packages)
    )
      throw new Error('Invalid example-imports packages')
    return {
      ...previous,
      packages: {
        ...priorPackages,
        [packageName]: (packages as Record<string, unknown>)[packageName]
      }
    }
  }
  if (name === 'relationships') {
    const edges = next.edges
    const priorEdges = previous.edges
    if (!Array.isArray(edges) || !Array.isArray(priorEdges))
      throw new Error('Invalid relationships edges')
    const ownsEdge = (edge: unknown) => {
      const record = edge as { from?: unknown; to?: unknown }
      return (
        hasLibraryPathSegment(record.from, library) || hasLibraryPathSegment(record.to, library)
      )
    }
    if (!edges.some(ownsEdge)) throw new Error(`Missing ${library} relationships edges`)
    return {
      ...previous,
      edges: replaceOwnedEntries(priorEdges, edges, ownsEdge, `${library} relationships edges`)
    }
  }
  throw new Error(`Unknown generated projection ${name}`)
}

/** Writes a full projection or a validated library-owned merge for scoped regeneration. */
function writeGeneratedProjection(name: string, value: Record<string, unknown>) {
  const output = selectedLibrary ? mergeLibraryProjection(name, value, selectedLibrary) : value
  writeFileSync(
    resolve('src/generated/manifests', `${name}.json`),
    `${JSON.stringify(output, null, 2)}\n`
  )
}

/** Stable route families owned by the React Router route module. */
const ROUTE_FAMILIES = [{ domain: 'docs', path: '/:lang/docs/*' }]

/** Languages with canonical URL prefixes in every generated route. */
const LOCALES = ['en', 'zh'] as const

/**
 * The single public content domain. Each library owns `/docs/<library>` (learning path),
 * `/docs/<library>/<topic>` (guides) and `/docs/<library>/api/...` (API reference).
 */
const DOMAINS = ['docs'] as const

/** Path segment that separates API reference pages from guide topics inside one library. */
const API_SEGMENT = 'api'

/** Maintained task topics owned by the Guide information architecture. */
const GUIDE_TOPICS: Readonly<Record<string, readonly string[]>> = {
  utils: [
    'collector',
    'deadlines-and-abort',
    'retry-and-concurrency',
    'error-identity-and-causes',
    'bytes-and-text',
    'immutable-objects-and-paths',
    'type-utilities',
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
    'physical-cleanup',
    'loaders-and-adapters',
    'runtime-tasks',
    'instances-and-routing',
    'native-thread-and-process',
    'topics-and-events'
  ],
  supervision: [
    'budget-and-queues',
    'supervisor-control',
    'restart-and-health',
    'profiles-and-hooks',
    'coroutine-tasks',
    'coroutine-heartbeat',
    'thread-profile',
    'process-profile',
    'process-output-and-usage',
    'process-recovery',
    'process-prewarm',
    'process-parent-loss',
    'troubleshooting'
  ],
  wasm: [
    'initialization-and-hosts',
    'arena-memory',
    'conversion-boundaries',
    'ownership-and-cleanup',
    'troubleshooting'
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
  capability: ['graph', 'graph-dynamic', 'graph-topology', 'graph-dependency', 'troubleshooting'],
  reactive: ['reactive', 'runtime', 'troubleshooting'],
  lifecycle: [
    'graceful-shutdown',
    'scope',
    'disposal',
    'abort',
    'quiescence',
    'scheduler',
    'generation',
    'application-load-state',
    'mutation-queue',
    'errors',
    'troubleshooting'
  ],
  'event-subscriber': [
    'subscriptions',
    'publish-and-errors',
    'async-invocation',
    'hub',
    'troubleshooting'
  ],
  'micro-hub': [
    'state-and-commands',
    'events-and-requests',
    'persist-and-resources',
    'web-components',
    'troubleshooting'
  ],
  'middleware-pipeline': ['sync-and-async', 'generators', 'cancellation-and-errors'],
  resource: [
    'caching-and-refresh',
    'suspense-and-ssr',
    'cancellation-and-retry',
    'troubleshooting'
  ],
  serialize: [
    'chunk-shapes-and-wire-conversion',
    'registry-and-plugins',
    'streaming-and-backpressure',
    'portable-values',
    'codecs',
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
    'configuration',
    'pipelines',
    'removal-and-rollback',
    'troubleshooting'
  ],
  'log-host': [
    'create-a-host',
    'levels-and-entry-policies',
    'output-scopes-and-delivery',
    'define-an-output',
    'errors-and-lifecycle',
    'forwarding-and-configuration'
  ],
  'log-plugin-file': [
    'installation-and-defaults',
    'injecting-a-writer',
    'options-and-rotation',
    'errors-and-shutdown'
  ],
  'log-plugin-reasoning': [
    'creation-and-phase-methods',
    'writer-and-scheduling',
    'completed-entries-and-outputs',
    'failures-and-release'
  ],
  'log-plugin-durable': [
    'standalone-stores-and-ownership',
    'files-and-runtimes',
    'plugins',
    'native-adapters-and-diagnostics'
  ],
  'rpc-host': ['host-and-plugins', 'transports-and-security', 'calls-and-cancellation'],
  'rpc-contract': [
    'descriptors-and-envelopes',
    'portable-values',
    'framing-and-streams',
    'wire-errors-and-metadata',
    'runtime-bindings',
    'binary-messages',
    'real-world-bindings',
    'fetch',
    'websocket',
    'sse',
    'process'
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
  /** Opaque code spans survive Markdown link/emphasis removal, including bracket calls and names. */
  const codeSpans: string[] = []
  /** Private-use markers keep Markdown transformations outside each original code span. */
  const prose = value.replace(/`+[^`]*`+/g, (code) => {
    codeSpans.push(code)
    return `\uE000${codeSpans.length - 1}\uE001`
  })
  return sanitizePublicText(prose)
    .replace(/<a\s+[^>]*><\/a>/gi, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^>\s?/, '')
    .replace(/\uE000(\d+)\uE001/g, (_, index) => codeSpans[Number(index)])
    .trim()
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
      // Source paragraphs already own their boundaries; punctuation inside code is not a delimiter.
      section.blocks.push({ type: 'paragraph', text })
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

/** Keep the repository-only retired-package comparison out of current website API projections. */
function publicMaintainedGuide(filePath: string, library: string) {
  /** The canonical parser still owns Markdown parsing and every current task section. */
  const document = maintainedDocument(filePath)
  if (!document || library !== 'log-host') return document
  return {
    sections: document.sections.filter(
      (section) => !/^(?:Migrating from |从 ).*@migaia\/logger/.test(section.heading)
    )
  }
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
  sourceDescriptions: ReadonlyMap<string, string>,
  resolveSurface: (
    expression: string,
    file: string
  ) => { members: Array<Record<string, unknown>>; composes: string[] }
) {
  if (candidate.kind === 'type' || candidate.kind === 'interface') return []
  /** Foreign-package protocols are linked type nodes, not recursively copied configuration. */
  const packageOwner = String(candidate.source).match(/^packages\/[^/]+\//)?.[0]
  /** Type names resolve only in the type namespace; a same-named constant is not its value union. */
  const declarations = new Map(
    candidates
      .filter(
        (record) =>
          (record.kind === 'type' || record.kind === 'interface') &&
          (!packageOwner || String(record.source).startsWith(packageOwner))
      )
      .map((record) => [String(record.name), record])
  )
  /** Every callable overload contributes its actual parameters, never names from its return type. */
  const parameters = [
    ...(Array.isArray(candidate.parameterDetails) ? candidate.parameterDetails : []),
    ...(Array.isArray(candidate.overloadParameterDetails)
      ? candidate.overloadParameterDetails.flat()
      : []),
    ...(candidate.kind === 'const' && /:\s*(?:<[^;]*>\s*)?\(/.test(String(candidate.signature))
      ? declarationParameters(String(candidate.signature))
      : [])
  ] as Array<{ name: string; type: string; configurationType?: string }>
  /** Canonical members, shared with normal API projection instead of another property regex. */
  const membersOf = (
    expression: string,
    seen = new Set<string>()
  ): Array<Record<string, unknown>> => {
    const text = expression.trim()
    if (seen.has(text)) return []
    const visited = new Set(seen).add(text)
    /** Indexed access selects only the named property's actual type, not its whole owner. */
    const indexed = text.match(/^([A-Za-z_$][\w$]*)\[['"]([^'"]+)['"]\]$/)
    if (indexed) {
      const member = membersOf(indexed[1], visited).find((value) => value.name === indexed[2])
      return member ? membersOf(String(member.returns), visited) : []
    }
    /** Named declarations carry their own members plus declared compositions. */
    const declaration = declarations.get(
      text.match(/^([A-Za-z_$][\w$]*)(?:<[\s\S]*>)?$/)?.[1] ?? ''
    )
    const shape = declaration
      ? {
          members: (declaration.members as Array<Record<string, unknown>>) ?? [],
          composes: (declaration.composes as string[]) ?? []
        }
      : resolveSurface(text, resolve('..', String(candidate.source)))
    const members = [...shape.members]
    for (const base of shape.composes) {
      /** Respect utility keys before a configuration table can expose any field. */
      const projection = base.match(/^(Omit|Pick)<([\s\S]*)>$/)
      if (projection) {
        const [reference = '', keys = ''] = splitTopLevel(projection[2], ',')
        const selected = new Set(
          splitTopLevel(keys, '|').map((key) => key.replace(/^['"]|['"]$/g, ''))
        )
        members.push(
          ...membersOf(reference, visited).filter(
            (member) => selected.has(String(member.name)) === (projection[1] === 'Pick')
          )
        )
        continue
      }
      /** A typeof object is explicit value-namespace access, unlike a bare enum type reference. */
      const queried = base.match(/^typeof\s+([A-Za-z_$][\w$]*)$/)?.[1]
      if (queried) {
        const value = candidates.find(
          (record) => record.name === queried && record.kind === 'const'
        )
        if (value) members.push(...((value.members as Array<Record<string, unknown>>) ?? []))
      } else members.push(...membersOf(base, visited))
    }
    /** Union branches may forbid a field with never; keep the reachable branch's actual type. */
    const combined = new Map<string, Record<string, unknown>>()
    for (const member of members) {
      const name = String(member.name)
      const previous = combined.get(name)
      if (!previous) combined.set(name, member)
      else {
        const reachable = String(member.returns) === 'never' ? previous : member
        combined.set(name, {
          ...reachable,
          optional: Boolean(previous.optional || member.optional)
        })
      }
    }
    return [...combined.values()]
  }
  /** One stable public field projection, recursively expanded only through object-valued fields. */
  const fields = new Map<
    string,
    { name: string; type: string; optional: boolean; description: string }
  >()
  const visit = (expression: string, prefix: string, seen: Set<string>): void => {
    if (seen.has(expression)) return
    const visited = new Set(seen).add(expression)
    for (const member of membersOf(expression)) {
      const name = String(member.name)
      const fieldName = prefix ? `${prefix}.${name}` : name
      const signature = String(member.signature)
      const method = member.kind === 'method'
      const type = method
        ? `(${((member.parameterDetails as Array<{ name: string; type: string; optional: boolean }>) ?? []).map((parameter) => `${parameter.name}${parameter.optional ? '?' : ''}: ${parameter.type}`).join(', ')}) => ${String(member.returns)}`
        : String(member.returns)
      const owner = expression.match(/^([A-Za-z_$][\w$]*)/)?.[1] ?? ''
      if (!fields.has(fieldName))
        fields.set(fieldName, {
          name: fieldName,
          type,
          optional: member.optional === true || /^(?:readonly\s+)?[\w$]+\?\s*[:(<]/.test(signature),
          description:
            String(member.description ?? '') ||
            sourceDescriptions.get(`${owner}:${name}`) ||
            sourceDescriptions.get(name) ||
            ''
        })
      /**
       * Supplied signals, schedulers and instances retain their own type nodes, not option
       * defaults.
       */
      if (
        !method &&
        (/^(?:Readonly<)?\s*\{/.test(type) ||
          /^I[\w$]*(?:Options|Config)(?:<[\s\S]*>)?$/.test(type) ||
          /^(?:Omit|Pick)<I[\w$]*(?:Options|Config),/.test(type) ||
          /^[A-Za-z_$][\w$]*\[['"]\w+['"]\]$/.test(type))
      )
        visit(type, fieldName, visited)
    }
  }
  for (const parameter of parameters) {
    /** A factory input or callback that happens to mention an Options type is not the options bag. */
    if (
      !/^(?:options|config|props)$/.test(parameter.name) &&
      !/^I[\w$]*(?:Options|Config|Props)(?:<[\s\S]*>)?$/.test(parameter.type)
    )
      continue
    visit(parameter.configurationType ?? parameter.type, '', new Set())
  }
  return [...fields.values()]
}

/** Reads current package source JSDoc so documentation does not depend on a prebuilt declaration. */
function sourceConfigurationDescriptions(directory: string): Map<string, string> {
  const sourceRoot = join(directory, 'src')
  if (!existsSync(sourceRoot)) return new Map()
  const candidates = new Map<string, Set<string>>()
  /** Options may be mutable in any owning package. */
  const includeMutable = true
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

/** Preserves public export hierarchy while sanitizing each URL segment. */
function moduleRouteSlug(exportPath: string): string {
  if (exportPath === '.') return 'index'
  return exportPath
    .replace(/^\.\//, '')
    .split('/')
    .map((segment) =>
      segment
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .filter(Boolean)
    .join('/')
}

/**
 * Produces a stable semantic URL segment, adding kind for case-folding collisions and for a
 * root-entry symbol whose name equals a subpath module's first segment, because the route resolver
 * gives that segment to the module page.
 */
function symbolRouteSlug(
  symbol: Readonly<Record<string, unknown>>,
  siblings: readonly Readonly<Record<string, unknown>>[],
  reservedSegments: ReadonlySet<string> = new Set()
): string {
  /** Siblings whose names differ from this symbol only by letter case. */
  const collisions = siblings.filter(
    (candidate) =>
      String(candidate.name).toLocaleLowerCase('en-US') ===
      String(symbol.name).toLocaleLowerCase('en-US')
  )
  /** True when the plain name would resolve to a subpath module page instead of this symbol. */
  const reserved = reservedSegments.has(String(symbol.name).toLocaleLowerCase('en-US'))
  return `${encodeURIComponent(String(symbol.name))}${collisions.length > 1 || reserved ? `-${String(symbol.kind)}` : ''}`
}

/**
 * First route segments of a library's subpath modules, which root-entry symbols must not use as
 * their own segment. Empty for subpath modules, whose symbols live below the module segment.
 */
function reservedRouteSegments(
  exports: readonly string[],
  exportPath: unknown
): ReadonlySet<string> {
  if (moduleRouteSlug(String(exportPath)) !== 'index') return new Set()
  return new Set(
    exports
      .map((entry) => moduleRouteSlug(entry))
      .filter((slug) => slug !== 'index')
      .map((slug) => slug.split('/')[0]!.toLocaleLowerCase('en-US'))
  )
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

/** Extracts JSDoc immediately preceding one class member declaration. */
function classMemberDoc(source: string, offset: number): string | null {
  const prefix = source.slice(0, offset)
  const start = prefix.lastIndexOf('/**')
  if (start < 0) return null
  const end = prefix.indexOf('*/', start)
  if (end < 0 || prefix.slice(end + 2).trim()) return null
  return prefix
    .slice(start + 3, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim())
    .filter((line) => line && !line.startsWith('@'))
    .join(' ')
}

/**
 * Finds the `(` that opens a declaration's parameter list, skipping parentheses inside the generic
 * parameter list (`once<T extends (...args: never[]) => unknown>(fn: T)`). The `>` of an arrow `=>`
 * does not close a generic bracket. Returns -1 when there is none.
 */
function parameterListStart(signature: string) {
  let angleDepth = 0
  for (let index = 0; index < signature.length; index += 1) {
    const character = signature[index]
    if (character === '<') angleDepth += 1
    else if (character === '>' && signature[index - 1] !== '=') angleDepth -= 1
    else if (character === '(' && angleDepth === 0) return index
  }
  return -1
}

/** Extracts source-backed parameter names, types, and optionality from a declaration signature. */
function declarationParameters(signature: string) {
  const open = parameterListStart(signature)
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
  const values: Array<{
    name: string
    type: string
    optional: boolean
    configurationType?: string
  }> = []
  let start = 0
  depth = 0
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index]
    if ('([{<'.includes(character)) depth += 1
    if (')]}'.includes(character)) depth -= 1
    if (character === '>' && depth > 0 && text[index - 1] !== '=') depth -= 1
    if ((character === ',' && depth === 0) || index === text.length) {
      const parameter = text.slice(start, index).trim()
      if (parameter) {
        /** Object destructuring has one props bag, not a parameter named after its whole pattern. */
        const destructured = parameter.match(/^\{[\s\S]*\}\s*:\s*([\s\S]+)$/)
        if (destructured) {
          values.push({ name: 'props', type: destructured[1].trim(), optional: false })
          start = index + 1
          continue
        }
        // A rest parameter (`...plugins: T[]`) is documented under its bare name.
        const match = parameter.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)(\?)?\s*(?::\s*([\s\S]*))?$/)
        const name = match?.[1] ?? parameter
        const type = match?.[3]?.trim() || 'unknown'
        values.push({ name, type, optional: Boolean(match?.[2]) })
      }
      start = index + 1
    }
  }
  /** Generic config parameters expose their declared input bound, not only a legacy overload. */
  const header = signature.slice(0, open)
  /** Only complete named bounds can project configuration; keyof/readonly fragments are not types. */
  const genericStart = header.indexOf('<')
  const constraints =
    genericStart < 0
      ? []
      : splitTopLevel(header.slice(genericStart + 1, header.lastIndexOf('>')), ',').flatMap(
          (parameter) => {
            const match = parameter.match(/^(?:const\s+)?([A-Za-z_$][\w$]*)\s+extends\s+([\s\S]+)$/)
            if (!match) return []
            /** A generic default is separate from its constraint, even when either contains commas. */
            const assignment = topLevelOffsets(match[2], '=')[0]
            const bound = match[2].slice(0, assignment ?? match[2].length).trim()
            return namedTypeReference(bound) ? [[match[1], bound]] : []
          }
        )
  for (const parameter of values) {
    let projection = parameter.type
    for (const [name, bound] of constraints) if (projection === name) projection = bound
    if (projection !== parameter.type) parameter.configurationType = projection
  }
  return values
}

/** Extracts public constructor parameters from one class declaration. */
function classConstructorParameters(signature: string) {
  const constructorStart = signature.search(/\bconstructor\s*\(/)
  if (constructorStart < 0) return []
  return declarationParameters(signature.slice(constructorStart))
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

/** Projects public methods and properties from a declaration class body. */
function classMembers(declaration: string) {
  const bodyStart = declaration.indexOf('{')
  const bodyEnd = declaration.lastIndexOf('}')
  if (bodyStart < 0 || bodyEnd <= bodyStart) return []
  const body = declaration.slice(bodyStart + 1, bodyEnd)
  const members: Array<Record<string, unknown>> = []
  let cursor = 0
  while (cursor < body.length) {
    while (/\s/.test(body[cursor] ?? '')) cursor += 1
    if (body.startsWith('/**', cursor) || body.startsWith('/*', cursor)) {
      const commentEnd = body.indexOf('*/', cursor + 2)
      if (commentEnd < 0) break
      cursor = commentEnd + 2
      continue
    }
    if (body.startsWith('//', cursor)) {
      const commentEnd = body.indexOf('\n', cursor + 2)
      cursor = commentEnd < 0 ? body.length : commentEnd + 1
      continue
    }
    if (cursor >= body.length) break
    const start = cursor
    const end = declarationEnd(body, start, 'member')
    if (end <= start) break
    cursor = end
    const signature = body.slice(start, end).trim().replace(/\s+/g, ' ')
    if (
      !signature ||
      signature.startsWith('#') ||
      // `__name` members are type-only phantom slots (installed-plugin tuples), not runtime API.
      /^(?:readonly\s+)?__/.test(signature) ||
      /^(?:private|protected)\b/.test(signature) ||
      /^(?:public\s+)?constructor\b/.test(signature)
    ) {
      continue
    }
    const normalized = signature.replace(
      /^(?:(?:public|static|abstract|override|readonly)\s+)*/,
      ''
    )
    const accessor = normalized.match(/^(get|set)\s+([A-Za-z_$][\w$]*)\s*\(/)
    const method = normalized.match(
      /^([A-Za-z_$][\w$]*|\[Symbol\.(?:asyncDispose|dispose)\])\??(?:<[^;]*?>)?\s*\(/
    )
    // Object-literal property types (`execution: { a: number; b: number }`) contain `;`, so the
    // type is everything after the colon up to the member's own final semicolon.
    // Quoted keys (`readonly 'async-generator': …`) are real members; the name drops its quotes.
    const property = normalized.match(
      /^([A-Za-z_$][\w$]*|'[^']+'|"[^"]+")[!?]?\s*:\s*([\s\S]+?);?$/
    )
    const name = accessor?.[2] ?? method?.[1] ?? property?.[1]?.replace(/^(['"])(.*)\1$/, '$2')
    if (!name) continue
    const kind = accessor?.[1] ?? (method ? 'method' : 'property')
    const open = parameterListStart(signature)
    const close = open < 0 ? -1 : closingParenthesis(signature, open)
    const parameterDetails = method || accessor ? declarationParameters(signature) : []
    const returns = property
      ? property[2].trim()
      : accessor?.[1] === 'set'
        ? 'void'
        : close < 0
          ? 'unknown'
          : signature
              .slice(close + 1)
              .replace(/^\s*:\s*/, '')
              .replace(/;\s*$/, '')
              .trim() || 'unknown'
    members.push({
      name,
      kind,
      optional: /^(?:[\w$]+|'[^']+'|"[^"]+")\?\s*[:(<]/.test(normalized),
      signature,
      description: classMemberDoc(body, start),
      parameterDetails,
      returns
    })
  }
  return members
}

/**
 * Returns the offsets of one separator (`&`, `|`, `,`, `=`, `{`) that sit at nesting depth zero,
 * ignoring separators nested in braces, brackets, parentheses, generics, and string literals.
 */
function topLevelOffsets(expression: string, separator: string): number[] {
  /** Comments are prose, so quotes and brackets inside them cannot affect type nesting. */
  expression = expression.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))
  const offsets: number[] = []
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = null
    } else if (depth === 0 && character === separator) offsets.push(index)
    else if (character === '"' || character === "'" || character === '`') quote = character
    else if ('{[(<'.includes(character)) depth += 1
    // `=>` closes no generic, so an arrow inside a function type keeps the depth balanced.
    else if ('}])'.includes(character) || (character === '>' && expression[index - 1] !== '='))
      depth = Math.max(0, depth - 1)
  }
  return offsets
}

/** Splits a type expression on one top-level separator into trimmed, non-empty parts. */
function splitTopLevel(expression: string, separator: string): string[] {
  /** Part boundaries: each separator plus both ends of the expression. */
  const bounds = [-1, ...topLevelOffsets(expression, separator), expression.length]
  return bounds
    .slice(1)
    .map((end, index) => expression.slice(bounds[index] + 1, end).trim())
    .filter(Boolean)
}

/** Returns the bare name of a named type reference such as `IFoo<T>` or `ns.IFoo`, else null. */
function namedTypeReference(part: string): string | null {
  return part.match(/^(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\s*(?:<[\s\S]*>)?$/)?.[1] ?? null
}

/**
 * Projects the instance surface of an `interface` or object-shaped `type` declaration so factory
 * results (channels, runtimes, pipelines) document their methods like classes do.
 *
 * `members` holds the declaration's own literal members; `composes` names the types it extends or
 * intersects, which the site resolves to inherit their members. Object union branches retain their
 * declared members; conditional and primitive unions have no object surface.
 */
function typeMemberShape(declaration: string, kind: 'type' | 'interface') {
  /** Empty projection for declarations without one object-shaped instance surface. */
  const none = { members: [] as Array<Record<string, unknown>>, composes: [] as string[] }
  /** Header text before the body, with the leading `export declare` keywords and name removed. */
  const header = declaration.replace(
    /^export\s+(?:declare\s+)?(?:type|interface)\s+[A-Za-z_$][\w$]*/,
    ''
  )
  if (kind === 'interface') {
    /** Interface body starts at the first brace outside the generic parameter list. */
    const bodyStart = topLevelOffsets(header, '{')[0] ?? -1
    if (bodyStart < 0) return none
    /** `extends A<T>, B` names inherited instance surfaces. */
    const heritage = header
      .slice(0, bodyStart)
      .replace(/^\s*<[\s\S]*?>\s*(?=extends\b|$)/, '')
      .match(/\bextends\b([\s\S]*)$/)?.[1]
    return {
      members: classMembers(header.slice(bodyStart)),
      composes: heritage
        ? splitTopLevel(heritage, ',')
            .map(namedTypeReference)
            .filter((name): name is string => Boolean(name))
        : []
    }
  }
  /** The alias target follows the first `=` that is not part of a generic default or arrow. */
  const assignment = topLevelOffsets(header, '=')[0] ?? -1
  return typeExpressionShape(
    assignment < 0
      ? ''
      : header
          .slice(assignment + 1)
          .replace(/;\s*$/, '')
          .trim()
  )
}

/**
 * Projects one type expression (an alias target or a `const` value type) into its instance surface.
 * Constructor types (`new (...) => T`) project the instance type `T` they construct.
 */
function typeExpressionShape(expression: string): {
  members: Array<Record<string, unknown>>
  composes: string[]
} {
  /** Empty projection for expressions without one object-shaped instance surface. */
  const none = { members: [] as Array<Record<string, unknown>>, composes: [] as string[] }
  /** A constructor type's instance surface follows its top-level `=>`. */
  const arrow = /^(?:abstract\s+)?new\b/.test(expression)
    ? topLevelOffsets(expression, '=').find((offset) => expression[offset + 1] === '>')
    : undefined
  /** `Readonly<{ ... }>` wraps the same instance surface, so the wrapper is peeled first. */
  const peel = (part: string): string => {
    /** Only remove a wrapper that encloses the entire expression, never two intersected wrappers. */
    const text = part.trim()
    if (
      text.startsWith('Readonly<') &&
      text.endsWith('>') &&
      splitTopLevel(text, '&').length === 1 &&
      splitTopLevel(text, '|').length === 1
    )
      return peel(text.replace(/^Readonly<([\s\S]*)>$/, '$1'))
    if (text.startsWith('(') && closingParenthesis(text, 0) === text.length - 1)
      return peel(text.slice(1, -1))
    return text
  }
  const target = peel(arrow === undefined ? expression : expression.slice(arrow + 2).trim())
  if (!target || splitTopLevel(target, '?').length > 1) return none
  /** A typeof alias exposes the real constant object's fields and methods. */
  const queried = target.match(/^typeof\s+([A-Za-z_$][\w$]*)$/)?.[1]
  if (queried) return { members: [], composes: [`typeof ${queried}`] }
  /** A union of object variants exposes each real member without inventing callable parameters. */
  const variants = splitTopLevel(target, '|')
  if (variants.length > 1) {
    const shapes = variants.map((part) => typeExpressionShape(part))
    if (shapes.some((shape) => shape.members.length === 0 && shape.composes.length === 0))
      return none
    return {
      members: shapes.flatMap((shape) => shape.members),
      composes: shapes.flatMap((shape) => shape.composes)
    }
  }
  /** Object literals contribute members; named references are inherited surfaces. */
  const parts = splitTopLevel(target, '&').map(peel)
  if (parts.length > 1) {
    const shapes = parts.map((part) => typeExpressionShape(part))
    return {
      members: shapes.flatMap((shape) => shape.members),
      composes: shapes.flatMap((shape) => shape.composes)
    }
  }
  /** Parse each utility separately: a trailing intersection is not part of its omitted key list. */
  if (/^(?:Omit|Pick|Partial|Required|Extract)</.test(target) || /\[['"][^'"]+['"]\]$/.test(target))
    return { members: [], composes: [target] }
  /** `{ ... }[TMode]` looks one member type up; the literal's keys are not the alias's members. */
  if (target.startsWith('{') && target.endsWith(']')) return none
  return {
    members: parts.filter((part) => part.startsWith('{')).flatMap((part) => classMembers(part)),
    composes: parts
      .filter((part) => !part.startsWith('{'))
      .map(namedTypeReference)
      .filter((name): name is string => Boolean(name))
  }
}

/** Names the base class a class declaration extends, so its inherited members can be shown. */
function classHeritage(declaration: string): string[] {
  /** Class header text before its body. */
  const header = declaration.slice(0, topLevelOffsets(declaration, '{')[0] ?? declaration.length)
  /** `extends` clause after the generic parameter list, stopping at `implements`. */
  const base = header
    .replace(/^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*\s*/, '')
    .replace(/^<[\s\S]*?>\s*(?=extends\b|implements\b|$)/, '')
    .match(/^extends\s+([\s\S]*?)(?:\bimplements\b|$)/)?.[1]
  /** The base reference keeps only its bare name. */
  const name = base ? namedTypeReference(base.trim()) : null
  return name ? [name] : []
}

/**
 * Inlines members that a public class or type inherits from non-public declarations of the same
 * package (for example `PluginHost extends RuntimeHost`), so the reader sees the whole instance
 * surface. Public bases stay in `composes` because the site links and merges them itself.
 */
function inlinePrivateSurfaces(directory: string, symbols: Array<Record<string, unknown>>) {
  /** Public names in this package; these are merged on the site instead of copied here. */
  const publicNames = new Set(symbols.map((symbol) => String(symbol.name)))
  /** Only same-entry public bases are available to the route's local symbol pool. */
  let entryPath = ''
  /** Declarations per emitted typing file, keyed by local name. */
  const declarations = new Map<string, Map<string, { kind: string; text: string }>>()
  /** Import aliases per file (`import { A as B }`), mapping the local name to its real owner. */
  const imports = new Map<string, Map<string, { file: string; name: string }>>()
  /** Indexed fields resolve their named types in the declaring file, never a namesake elsewhere. */
  const memberOrigins = new WeakMap<Record<string, unknown>, string>()
  /** Lists every emitted declaration file under one directory. */
  const typingFiles = (root: string): string[] =>
    existsSync(root)
      ? readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? typingFiles(join(root, entry.name))
            : entry.name.endsWith('.d.ts')
              ? [join(root, entry.name)]
              : []
        )
      : []
  /** Load only declaration files reached through package imports; never execute the exported code. */
  const loadDeclarations = (filePath: string): void => {
    if (declarations.has(filePath) || !existsSync(filePath)) return
    const source = readFileSync(filePath, 'utf8')
    /** This file's own declarations. */
    const local = new Map<string, { kind: string; text: string }>()
    for (const match of source.matchAll(
      /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|type|interface|const|function)\s+([A-Za-z_$][\w$]*)/gm
    )) {
      if (local.has(match[2])) continue
      const start = match.index ?? 0
      local.set(match[2], {
        kind: match[1],
        text: source.slice(start, declarationEnd(source, start, match[1])).trim()
      })
    }
    declarations.set(filePath, local)
    /** Named imports resolve through the exact workspace export declaration. */
    const bindings = new Map<string, { file: string; name: string }>()
    for (const imported of source.matchAll(
      /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]((?:\.|@migaia\/)[^'"]+)['"]/gm
    )) {
      const file = declarationImportFiles(filePath, imported[2])[0]
      if (!file) continue
      for (const binding of imported[1].split(',')) {
        const [original, alias = original] = binding
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)
        if (original) bindings.set(alias.trim(), { file, name: original.trim() })
      }
    }
    imports.set(filePath, bindings)
  }
  for (const filePath of typingFiles(join(directory, 'dist'))) loadDeclarations(filePath)
  /** Finds where a name used in one file is declared: its own file, an import, or any file. */
  const locate = (name: string, file: string) => {
    loadDeclarations(file)
    const own = declarations.get(file)?.get(name)
    if (own) return { file, declaration: own }
    const imported = imports.get(file)?.get(name)
    if (imported) {
      loadDeclarations(imported.file)
      const declaration = declarations.get(imported.file)?.get(imported.name)
      if (declaration) return { file: imported.file, declaration }
      /** Public barrels may re-export the declaration from another typing file. */
      const exported = declarationSymbols(imported.file).find(
        (record) => record.name === imported.name
      )
      if (!exported) return undefined
      const sourceFile = String(exported.source)
      loadDeclarations(sourceFile)
      return {
        file: sourceFile,
        declaration: { kind: String(exported.kind), text: String(exported.signature) }
      }
    }
    for (const [candidateFile, local] of declarations) {
      const declaration = local.get(name)
      if (declaration) return { file: candidateFile, declaration }
    }
    return undefined
  }
  /** Resolves one non-public declaration into its members plus any public bases it reaches. */
  const privateSurface = (
    name: string,
    file: string,
    seen: Set<string>,
    inlinePublic = false
  ): { members: Array<Record<string, unknown>>; composes: string[] } => {
    const found = locate(name, file)
    if (!found || seen.has(`${found.file}:${name}`)) return { members: [], composes: [] }
    seen.add(`${found.file}:${name}`)
    /** Normalized text that the shared projections can read as an exported declaration. */
    const text = found.declaration.text.replace(/^(?:export\s+)?(?:declare\s+)?/, 'export declare ')
    const own =
      found.declaration.kind === 'class'
        ? { members: classMembers(text), composes: classHeritage(text) }
        : found.declaration.kind === 'const'
          ? typeExpressionShape(
              text.match(/^export declare const [A-Za-z_$][\w$]*\s*:\s*([\s\S]*?);?$/)?.[1] ?? ''
            )
          : typeMemberShape(text, found.declaration.kind as 'type' | 'interface')
    return expand(own, found.file, seen, inlinePublic)
  }
  /**
   * Keeps declared union branches separate while resolving an Extract projection. Flattening the
   * envelope first would incorrectly mix fields from unrelated protocol variants.
   */
  const variantsOf = (
    expression: string,
    file: string,
    seen: Set<string>
  ): Array<{ members: Array<Record<string, unknown>>; composes: string[] }> => {
    /** Transparent grouping around the actual variant expression. */
    let target = expression.trim()
    for (;;) {
      if (target.startsWith('(') && closingParenthesis(target, 0) === target.length - 1)
        target = target.slice(1, -1).trim()
      else if (
        target.startsWith('Readonly<') &&
        splitTopLevel(target, '&').length === 1 &&
        splitTopLevel(target, '|').length === 1
      )
        target = target.slice('Readonly<'.length, -1).trim()
      else break
    }
    /** A named alias may contain the union selected by Extract. */
    const name = namedTypeReference(target)
    const found = name ? locate(name, file) : undefined
    if (name && found?.declaration.kind === 'type') {
      /** File-qualified recursion guard permits the same name in unrelated packages. */
      const key = `${found.file}:${name}`
      if (seen.has(key)) return []
      /** Alias header excludes generic defaults when locating the target assignment. */
      const header = found.declaration.text.replace(
        /^(?:export\s+)?(?:declare\s+)?type\s+[A-Za-z_$][\w$]*/,
        ''
      )
      const assignment = topLevelOffsets(header, '=')[0]
      if (assignment === undefined) return []
      return variantsOf(
        header.slice(assignment + 1).replace(/;\s*$/, ''),
        found.file,
        new Set(seen).add(key)
      )
    }
    /** Union alternatives remain separate; intersections contribute to each alternative. */
    const alternatives = splitTopLevel(target, '|')
    if (alternatives.length > 1)
      return alternatives.flatMap((part) => variantsOf(part, file, new Set(seen)))
    const intersections = splitTopLevel(target, '&')
    if (intersections.length > 1)
      return intersections.reduce(
        (combined, part) =>
          combined.flatMap((left) =>
            variantsOf(part, file, new Set(seen)).map((right) => ({
              members: [...left.members, ...right.members],
              composes: [...left.composes, ...right.composes]
            }))
          ),
        [{ members: [], composes: [] }] as Array<{
          members: Array<Record<string, unknown>>
          composes: string[]
        }>
      )
    return [expand(typeExpressionShape(target), file, new Set(seen), true)]
  }
  /** Replaces non-public bases with their members, keeping public bases as links. */
  const expand = (
    shape: { members: Array<Record<string, unknown>>; composes: string[] },
    file: string,
    seen: Set<string>,
    inlinePublic = false
  ) => {
    const members = [...shape.members]
    for (const member of members) if (!memberOrigins.has(member)) memberOrigins.set(member, file)
    const composes: string[] = []
    for (const base of shape.composes) {
      /** Partial/Required change optionality on the selected real fields, not type identity. */
      const optionality = base.match(/^(Partial|Required)<([\s\S]*)>$/)
      if (optionality) {
        const projected = expand(typeExpressionShape(optionality[2]), file, new Set(seen), true)
        members.push(
          ...projected.members.map((member) => ({
            ...member,
            optional: optionality[1] === 'Partial',
            signature: String(member.signature).replace(
              /^(\s*(?:readonly\s+)?[\w$]+)\??(?=\s*[:(<])/,
              `$1${optionality[1] === 'Partial' ? '?' : ''}`
            )
          }))
        )
        composes.push(...projected.composes)
        continue
      }
      /** Indexed access projects the declared object field, for example runtime-call options. */
      const indexed = base.match(/^([\s\S]+)\[['"]([^'"]+)['"]\]$/)
      if (indexed) {
        const container = expand(typeExpressionShape(indexed[1]), file, new Set(seen), true)
        for (const field of container.members.filter((member) => member.name === indexed[2])) {
          const projected = expand(
            typeExpressionShape(String(field.returns)),
            memberOrigins.get(field) ?? file,
            new Set(seen),
            true
          )
          members.push(...projected.members)
          composes.push(...projected.composes)
        }
        continue
      }
      /** Extract selects only branches whose real discriminant literals satisfy the filter. */
      const extracted = base.match(/^Extract<([\s\S]*)>$/)?.[1]
      if (extracted) {
        const [reference = '', filter = ''] = splitTopLevel(extracted, ',')
        const constraints = classMembers(filter)
        if (constraints.length === 0) continue
        for (const variant of variantsOf(reference, file, new Set(seen))) {
          const matches = constraints.every((constraint) => {
            const field = variant.members.find((member) => member.name === constraint.name)
            if (!field) return false
            /** Literal equality follows declaration text; no approximate assignability solver. */
            const allowed = new Set(splitTopLevel(String(constraint.returns), '|'))
            return splitTopLevel(String(field.returns), '|').every((value) => allowed.has(value))
          })
          if (matches) {
            members.push(...variant.members)
            composes.push(...variant.composes)
          }
        }
        continue
      }
      /** Typeof selects the value namespace, unlike a same-named enum-like type alias. */
      const queried = base.match(/^typeof\s+([A-Za-z_$][\w$]*)$/)?.[1]
      if (queried) {
        const value = privateSurface(queried, file, new Set(seen), true)
        members.push(...value.members)
        composes.push(...value.composes)
        continue
      }
      /** Omit/Pick inherit only the selected fields, never the unfiltered base surface. */
      const projection = base.match(/^(Omit|Pick)<([\s\S]*)>$/)
      if (projection) {
        const [reference = '', keys = ''] = splitTopLevel(projection[2], ',')
        /** Pool APIs select real methods from an awaited public peer factory result. */
        const unwrapped = reference.replace(/^Awaited<([\s\S]*)>$/, '$1')
        const factoryName = unwrapped.match(
          /^ReturnType<typeof ([A-Za-z_$][\w$]*)(?:<[\s\S]*>)?>$/
        )?.[1]
        const factory = factoryName ? locate(factoryName, file) : undefined
        let projected: { members: Array<Record<string, unknown>>; composes: string[] }
        if (factory) {
          const signature = factory.declaration.text
          const open = parameterListStart(signature)
          const close = open < 0 ? -1 : closingParenthesis(signature, open)
          if (close < 0) continue
          let result = signature
            .slice(close + 1)
            .replace(/^\s*:\s*/, '')
            .replace(/;\s*$/, '')
            .trim()
          for (;;) {
            const value = result.match(/^(?:Awaited|Promise|PromiseLike)<([\s\S]*)>$/)?.[1]
            if (!value) break
            result = value
          }
          projected = expand(typeExpressionShape(result), factory.file, new Set(seen), true)
        } else {
          projected = expand(typeExpressionShape(reference), file, new Set(seen), true)
        }
        const selected = new Set(
          splitTopLevel(keys, '|').map((key) =>
            key.replace(/^["']|["']$/g, '').replace(/^typeof (Symbol\.[\w]+)$/, '[$1]')
          )
        )
        members.push(
          ...projected.members.filter(
            (member) => selected.has(String(member.name)) === (projection[1] === 'Pick')
          )
        )
        continue
      }
      /** An import alias of a public declaration still names a private local binding. */
      const target = imports.get(file)?.get(base)?.name ?? base
      /** Foreign-package base instances stay linked; only explicit field projections inline them. */
      const located = locate(base, file)
      if (!inlinePublic && located && !located.file.startsWith(`${directory}/`)) {
        composes.push(target)
        continue
      }
      if (
        (!inlinePublic &&
          publicNames.has(base) &&
          target === base &&
          symbols.some((symbol) => symbol.name === base && symbol.exportPath === entryPath)) ||
        !located
      ) {
        composes.push(base)
        continue
      }
      const inherited = privateSurface(base, file, seen, inlinePublic)
      members.push(...inherited.members)
      composes.push(...inherited.composes)
    }
    return { members, composes: Array.from(new Set(composes)) }
  }
  for (const symbol of symbols) {
    if (!Array.isArray(symbol.composes) || symbol.composes.length === 0) continue
    entryPath = String(symbol.exportPath)
    /** Absolute typing file that declares this public symbol. */
    const file = resolve('..', String(symbol.source))
    const shape = expand(
      {
        members: (symbol.members as Array<Record<string, unknown>>) ?? [],
        composes: symbol.composes as string[]
      },
      file,
      new Set([`${file}:${String(symbol.name)}`])
    )
    symbol.members = shape.members
    symbol.composes = shape.composes
  }
  /** Private parameter aliases use this same canonical projection without manufacturing exports. */
  return (expression: string, file: string) => {
    /** Declaration emit can qualify constructor options without a separate named import. */
    const imported = expression
      .trim()
      .match(/^import\(['"]([^'"]+)['"]\)\.([A-Za-z_$][\w$]*)(?:<[\s\S]*>)?$/)
    if (imported) {
      /** Resolve in the declaring file so a same-named type in another package cannot win. */
      const importedFile = declarationImportFiles(file, imported[1])[0]
      if (importedFile) return privateSurface(imported[2], importedFile, new Set(), true)
    }
    return expand(typeExpressionShape(expression), file, new Set(), true)
  }
}

/** Finds the end of one declaration while respecting nested syntax and comments. */
function declarationEnd(source: string, start: number, kind: string): number {
  let parentheses = 0
  let brackets = 0
  let braces = 0
  /** Generic defaults can contain braces before a class or interface body begins. */
  let headerGenerics = 0
  /** Once the real body starts, runtime comparison operators are not generic delimiters. */
  let bodyStarted = !['class', 'interface'].includes(kind)
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
    if (!bodyStarted && character === '<') headerGenerics += 1
    else if (!bodyStarted && character === '>' && source[index - 1] !== '=')
      headerGenerics = Math.max(0, headerGenerics - 1)
    else if (character === '(') parentheses += 1
    else if (character === ')') parentheses = Math.max(0, parentheses - 1)
    else if (character === '[') brackets += 1
    else if (character === ']') brackets = Math.max(0, brackets - 1)
    else if (character === '{') {
      if (headerGenerics === 0 && braces === 0 && parentheses === 0 && brackets === 0)
        bodyStarted = true
      braces += 1
    } else if (character === '}') {
      braces = Math.max(0, braces - 1)
      if (
        braces === 0 &&
        bodyStarted &&
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

/** Resolve declaration artifacts through the same ordinary workspace exports used by consumers. */
function declarationImportFiles(filePath: string, specifier: string): string[] {
  if (specifier.startsWith('.')) {
    /** TypeScript declarations retain source extensions even when JavaScript output rewrites them. */
    const target = resolve(
      join(filePath, '..'),
      specifier.replace(/\.(?:js|ts|tsx)$/, '') + '.d.ts'
    )
    return existsSync(target) ? [target] : []
  }
  /** Workspace imports resolve only their public types entry, never a guessed private dist path. */
  const workspace = /^@migaia\/([^/]+)(?:\/(.*))?$/.exec(specifier)
  if (!workspace) return []
  /** The ordinary package name matches its existing workspace directory. */
  const directory = resolve('..', 'packages', workspace[1])
  /** The manifest is the authority for root and nested ordinary entry ownership. */
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) return []
  /** The resolver follows the exact declared subpath before reading any declaration content. */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  /** A subpath import never falls through to the package's unrelated root declaration. */
  const key = workspace[2] ? `./${workspace[2]}` : '.'
  /** Existing declaration-file resolution already handles concrete targets and wildcard artifacts. */
  const target = manifest.exports?.[key]
  return declarationFiles(directory, declarationTypeTarget(target))
}

/** Type-only re-exports expose declaration shape without advertising a callable runtime value. */
function typeOnlyDeclaration(record: Record<string, unknown>, signature: string) {
  return {
    ...record,
    kind: 'type',
    signature,
    core: signature,
    parameters: [],
    parameterDetails: [],
    returns: null
  }
}

/** TypeScript declarations occupy at most the two fixed type/value binding namespaces. */
function declarationNamespaces(kind: unknown): readonly string[] {
  if (kind === 'type' || kind === 'interface') return ['type']
  return kind === 'class' ? ['type', 'value'] : ['value']
}

/** Extracts balanced, source-backed declaration records from a declaration file. */
function declarationSymbols(filePath: string, visited = new Set<string>()) {
  if (visited.has(filePath)) return []
  visited.add(filePath)
  const source = readFileSync(filePath, 'utf8')
  const records: Array<Record<string, unknown>> = []
  /** Star provenance permits explicit precedence without changing declaration order. */
  const starRecords = new Set<Record<string, unknown>>()
  /** A default export can name a local declaration without making every private declaration public. */
  const defaultBindings = new Set(
    [...source.matchAll(/^export\s+default\s+([A-Za-z_$][\w$]*)\s*;/gm)].map((match) => match[1])
  )
  /** Comment prose cannot introduce phantom declarations; offsets still refer to the real file. */
  const declarationText = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
    comment.replace(/[^\r\n]/g, ' ')
  )
  const declarationPattern =
    /^(?:export\s+(?:default\s+)?(?:declare\s+)?|declare\s+)(?:abstract\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|namespace)\s+([A-Za-z_$][\w$]*)/gm
  for (const match of declarationText.matchAll(declarationPattern)) {
    const kind = match[1]
    const name = match[2]
    /** Only an explicit default binding exposes a declaration lacking the export modifier. */
    const localDefault = !match[0].startsWith('export') && defaultBindings.has(name)
    if (!match[0].startsWith('export') && !localDefault) continue
    const declarationStart = match.index ?? 0
    const lineStart = source.lastIndexOf('\n', declarationStart) + 1
    const end = declarationEnd(source, declarationStart, kind)
    const rawDeclaration = `${localDefault ? 'export ' : ''}${source.slice(declarationStart, end).trim()}`
    const signature = rawDeclaration.replace(/\s+/g, ' ')
    let parameterDetails =
      kind === 'function'
        ? declarationParameters(signature)
        : kind === 'class'
          ? classConstructorParameters(signature)
          : []
    /** A local overloaded callable type can own an exported const's actual call signatures. */
    const valueType =
      kind === 'const' ? signature.match(/:\s*([A-Za-z_$][\w$]*)(?:<[\s\S]*>)?;$/)?.[1] : undefined
    /** Inspect the actual declaration instead of guessing callability from the export name. */
    const valueTypeStart = valueType
      ? source.search(new RegExp(`(?:type|interface)\\s+${valueType}\\b`))
      : -1
    /** Named callable aliases remain const exports, with an explicit callable declaration fact. */
    const callable =
      valueTypeStart >= 0 &&
      /\{\s*(?:<|\()/.test(
        source.slice(valueTypeStart, declarationEnd(source, valueTypeStart, 'type'))
      )
    /** Keep actual overload parameters and returns when a const refers to a local callable alias. */
    const callResults: string[] = []
    if (callable) {
      const declaration = source.slice(
        valueTypeStart,
        declarationEnd(source, valueTypeStart, 'type')
      )
      const body = declaration.slice(declaration.indexOf('{') + 1, declaration.lastIndexOf('}'))
      const calls = splitTopLevel(body, ';')
        .map((call) => call.replace(/\/\*[\s\S]*?\*\//g, '').trim())
        .filter(Boolean)
      parameterDetails = calls.flatMap((call) => declarationParameters(call))
      for (const call of calls) {
        const open = parameterListStart(call)
        const close = open < 0 ? -1 : closingParenthesis(call, open)
        if (close >= 0)
          callResults.push(
            call
              .slice(close + 1)
              .replace(/^\s*:\s*/, '')
              .trim()
          )
      }
    }
    const parameters = parameterDetails.map((parameter) => parameter.name)
    const open = parameterListStart(signature)
    const close = open < 0 ? -1 : closingParenthesis(signature, open)
    const returnText =
      callResults.length > 0
        ? [...new Set(callResults)].join(' | ')
        : kind !== 'function' || close < 0
          ? ''
          : signature
              .slice(close + 1)
              .replace(/^\s*:\s*/, '')
              .replace(/;\s*$/, '')
              .trim()
    records.push({
      name: localDefault ? 'default' : name,
      kind,
      ...(callable ? { callable: true } : {}),
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
      examples: [],
      ...(kind === 'type' || kind === 'interface'
        ? typeMemberShape(rawDeclaration, kind)
        : kind === 'class'
          ? { members: classMembers(rawDeclaration), composes: classHeritage(rawDeclaration) }
          : kind === 'const'
            ? typeExpressionShape(
                signature.match(
                  /^export declare const [A-Za-z_$][\w$]*\s*:\s*([\s\S]*?);?$/
                )?.[1] ?? ''
              )
            : { members: [], composes: [] })
    })
  }
  /** Named imports can be publicly re-exported without repeating their original from clause. */
  const importedBindings = new Map<
    string,
    { imported: string; specifier: string; typeOnly: boolean }
  >()
  for (const imported of source.matchAll(
    /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm
  )) {
    for (const binding of imported[1].split(',')) {
      /** Type-only status comes from the actual declaration, not the target's class name. */
      const typeOnly = /^import\s+type\b/.test(imported[0]) || /^\s*type\s/.test(binding)
      /** Imported aliases retain the original target symbol and this file's local binding name. */
      const [original, local = original] = binding
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
      importedBindings.set(local.trim(), {
        imported: original.trim(),
        specifier: imported[2],
        typeOnly
      })
    }
  }
  /** Both direct and locally imported re-exports are rooted in their real declaration statements. */
  const reexports = [
    ...source.matchAll(
      /^export\s+(?:type\s+)?(\*|\{([^}]+)\})(?:\s+from\s+['"]([^'"]+)['"])?\s*;/gm
    )
  ]
  for (const reexport of reexports) {
    /**
     * Relative re-exports are followed for every package, including bare `export { X }` of a
     * relatively imported binding (`import { X } from './x.js'; export { X }`); otherwise public
     * names such as an error-code table never reach the site. Bare package specifiers stay excluded
     * outside ordinary workspace exports.
     */
    if (reexport[3] && !reexport[3].startsWith('.') && !reexport[3].startsWith('@migaia/')) continue
    if (reexport[1] === '*') {
      const typeOnly = /^export\s+type\b/.test(reexport[0])
      for (const target of declarationImportFiles(filePath, reexport[3])) {
        const targetRecords = declarationSymbols(target, new Set(visited))
        /** Dual value/type names retain only their type declaration through an erased star. */
        const declaredTypes = new Set(
          targetRecords
            .filter((record) => record.kind === 'type' || record.kind === 'interface')
            .map((record) => record.name)
        )
        for (const record of targetRecords) {
          if (record.name === 'default') continue
          if (typeOnly && record.kind !== 'type' && record.kind !== 'interface') {
            if (declaredTypes.has(record.name)) continue
            /** The converted type keeps its position while retaining star-export provenance. */
            const exposed = typeOnlyDeclaration(
              record,
              `export type { ${String(record.name)} } from '${reexport[3]}';`
            )
            records.push(exposed)
            starRecords.add(exposed)
          } else {
            records.push(record)
            starRecords.add(record)
          }
        }
      }
      continue
    }
    const bindings = (reexport[2] ?? '').split(',').map((binding) => {
      /** A type re-export exposes instance shape without exposing its target constructor. */
      const typeOnly = /^export\s+type\b/.test(reexport[0]) || /^\s*type\s/.test(binding)
      const normalized = binding.trim().replace(/^type\s+/, '')
      const [imported, exported = imported] = normalized.split(/\s+as\s+/)
      return { imported: imported.trim(), exported: exported.trim(), typeOnly }
    })
    /** Direct from clauses retain the original single read for their complete named export group. */
    const directRecords = reexport[3]
      ? declarationImportFiles(filePath, reexport[3]).flatMap((target) =>
          declarationSymbols(target, new Set(visited))
        )
      : undefined
    for (const binding of bindings) {
      /** Bare exports follow only a real named import; unrelated local/private names stay absent. */
      const imported = reexport[3] ? undefined : importedBindings.get(binding.imported)
      /** The export's from clause or its imported binding names the actual owning entry. */
      const specifier = reexport[3] ?? imported?.specifier
      if (!specifier) continue
      if (!specifier.startsWith('.') && !specifier.startsWith('@migaia/')) continue
      /** Each target is read through its public declaration artifact and the existing cycle guard. */
      const targetRecords =
        directRecords ??
        declarationImportFiles(filePath, specifier).flatMap((target) =>
          declarationSymbols(target, new Set(visited))
        )
      /** A dual value/type export contributes only its type declaration through export type. */
      const matchingRecords = targetRecords.filter(
        (candidate) => String(candidate.name) === (imported?.imported ?? binding.imported)
      )
      const typeOnly = binding.typeOnly || imported?.typeOnly
      const hasTypeDeclaration = matchingRecords.some(
        (record) => record.kind === 'type' || record.kind === 'interface'
      )
      for (const record of matchingRecords.filter(
        (candidate) =>
          !typeOnly ||
          !hasTypeDeclaration ||
          candidate.kind === 'type' ||
          candidate.kind === 'interface'
      )) {
        /** A named default re-export renames its actual local declaration, not the word default. */
        const declarationName =
          binding.imported === 'default'
            ? String(record.signature).match(
                /^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/
              )?.[1]
            : undefined
        /** Preserve the public type declaration instead of advertising a private class value. */
        const typeOnlyValue = typeOnly && record.kind !== 'type' && record.kind !== 'interface'
        const signature = typeOnlyValue
          ? `export type { ${binding.imported}${binding.imported === binding.exported ? '' : ` as ${binding.exported}`} }${reexport[3] ? ` from '${specifier}'` : ''};`
          : String(record.signature).replace(
              new RegExp(`\\b${declarationName ?? imported?.imported ?? binding.imported}\\b`),
              binding.exported
            )
        const exposed = { ...record, name: binding.exported, signature, aliasOf: binding.imported }
        records.push(typeOnlyValue ? typeOnlyDeclaration(exposed, signature) : exposed)
      }
    }
  }
  /** Explicit exports shadow star bindings only in the namespace they actually declare. */
  const explicitBindings = new Set<string>()
  for (const record of records)
    if (!starRecords.has(record))
      // Each declaration contributes at most two namespaces, fixed by TypeScript's binding model.
      for (const namespace of declarationNamespaces(record.kind))
        explicitBindings.add(`${namespace}:${String(record.name)}`)
  /** Keep every surviving declaration in its original order, including unchanged overloads. */
  const publicRecords: Array<Record<string, unknown>> = []
  for (const record of records) {
    if (!starRecords.has(record)) {
      publicRecords.push(record)
      continue
    }
    /** A value/type declaration remains public while either of its namespaces is unshadowed. */
    let shadowed = true
    // The same fixed two-namespace bound keeps the complete collection pass linear.
    for (const namespace of declarationNamespaces(record.kind))
      if (!explicitBindings.has(`${namespace}:${String(record.name)}`)) shadowed = false
    if (!shadowed) publicRecords.push(record)
  }
  return publicRecords
}

/** Builds six ordered, source-backed-or-explicit symbol sections. */
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

/**
 * Audited reference prose owns generated semantic metadata too. Declaration parsing still owns
 * signatures and types; this projection reuses authored facts without inferring error guarantees or
 * creating a second independently maintained explanation of the same API.
 */
function authoredSymbolMetadata(
  library: string,
  module: string,
  symbol: Record<string, unknown>
): Record<string, unknown> {
  /** Audited documentation keyed by the exact public module before its shared-name fallback. */
  const reference = referenceFor(library)
  if (!reference) return symbol
  /** Module-qualified entries distinguish unrelated public APIs with the same spelling. */
  const key = `${module}:${String(symbol.name)}`
  /** Runtime, type and constant documentation describe their own public boundary. */
  const runtime = reference.symbols[key] ?? reference.symbols[String(symbol.name)]
  const type = reference.types[key] ?? reference.types[String(symbol.name)]
  const enumeration = reference.enums[key] ?? reference.enums[String(symbol.name)]
  const enhancer = reference.enhancers[key] ?? reference.enhancers[String(symbol.name)]
  /** Preserve the complete authored introduction rather than truncating source comments. */
  const purpose = runtime?.purpose.en ?? type?.summary.en ?? enumeration?.summary.en
  if (!purpose) return symbol
  /** One member's existing contract facts; labels preserve which field the prose describes. */
  const memberFacts = (name: string, member: IMemberDoc): string[] => [
    `${name}: ${member.summary.en}`,
    ...Object.entries(member.params ?? {}).map(
      ([parameter, text]) => `${name}.${parameter}: ${text.en}`
    ),
    ...(member.returns ? [member.returns.en] : []),
    ...(member.default ? [member.default.en] : []),
    ...Object.values(member.values ?? {}).flatMap((value) =>
      typeof value === 'string' ? [] : [value.en]
    ),
    ...(member.whenToUse ? [member.whenToUse.en] : [])
  ]
  /** Options may use a named reference type instead of an anonymous options table. */
  const options = runtime?.options
    ? (reference.types[`${module}:${runtime.options}`] ?? reference.types[runtime.options])
    : undefined
  /** Core facts remain prose; the original structured declaration fields are untouched. */
  const core =
    Array.from(
      new Set([
        ...Object.entries(runtime?.params ?? {}).map(([name, text]) => `${name}: ${text.en}`),
        ...(runtime?.returns ? [runtime.returns.en] : []),
        ...Object.entries(type?.members ?? {}).flatMap(([name, member]) =>
          memberFacts(name, member)
        ),
        ...Object.entries(runtime?.optionDocs ?? options?.members ?? {}).flatMap(([name, member]) =>
          memberFacts(name, member)
        ),
        ...Object.entries(enumeration?.values ?? {}).map(([name, text]) => `${name}: ${text.en}`),
        ...(enhancer ? [enhancer.summary.en] : [])
      ])
    ).join('\n') || purpose
  /** Scenarios and cautions are authored advanced guidance, never an absence template. */
  const advanced = Array.from(
    new Set([
      ...(runtime?.scenarios ?? []).map((text) => text.en),
      ...(runtime?.avoid ?? []).map((text) => text.en),
      ...(type?.scenarios ?? []).map((text) => text.en),
      ...(enhancer?.behaviors ?? []).map((text) => text.en),
      ...(enhancer?.scenarios ?? []).map((text) => text.en)
    ])
  ).join('\n')
  return {
    ...symbol,
    purpose,
    core,
    advanced,
    // Failure/lifecycle facts stay in authored contract prose. An empty category asserts nothing;
    // do not turn missing machine-readable classification into "no documented errors" claims.
    errors: [],
    lifecycleConcurrency: '',
    whenToUse: (runtime?.scenarios ?? type?.scenarios ?? []).map((text) => text.en).join('\n'),
    notUse: (runtime?.avoid ?? []).map((text) => text.en).join('\n'),
    sections: Array.isArray(symbol.sections)
      ? symbol.sections.map((section: { id: string; content: string }) => ({
          ...section,
          content:
            section.id === 'introduction'
              ? purpose
              : section.id === 'core-usage'
                ? core
                : section.id === 'advanced-usage'
                  ? advanced
                  : section.content
        }))
      : symbol.sections
  }
}

/** Resolve shared types or the first declared typed runtime branch of a conditional export. */
function declarationTypeTarget(target: unknown): string | undefined {
  if (typeof target === 'string') return target
  /** A cursor visits each manifest condition once without following runtime JavaScript targets. */
  const pending = [target]
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** Export conditions come from parsed package metadata rather than executable package code. */
    const candidate = pending[cursor]
    if (!candidate || typeof candidate !== 'object') continue
    /** Shared declarations take precedence over runtime-specific nested declaration branches. */
    const conditions = candidate as Record<string, unknown>
    if (typeof conditions.types === 'string') return conditions.types
    for (const condition of Object.values(conditions))
      if (condition && typeof condition === 'object') pending.push(condition)
  }
  return undefined
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
    const types = declarationTypeTarget(target)
    /** JSON exports are public data values, even when they have no declaration artifact. */
    const dataTarget = typeof target === 'string' ? target : target?.default
    if (typeof dataTarget === 'string' && dataTarget.endsWith('.json')) {
      /** Read the published artifact itself; no fabricated callable or TypeScript type is needed. */
      const filePath = resolve(directory, dataTarget)
      const data = JSON.parse(readFileSync(filePath, 'utf8'))
      const signature = JSON.stringify(data, null, 2)
      candidates.push({
        name: 'default',
        kind: 'const',
        signature,
        declarationLine: 1,
        source: relative(resolve('..'), filePath).split('\\').join('/'),
        exportPath,
        isExplicitLeaf: true,
        purpose: typeof data.description === 'string' ? data.description : null,
        parameters: [],
        parameterDetails: [],
        returns: null,
        errors: [],
        members: [],
        composes: []
      })
      continue
    }
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
    /** A public cross-owner re-export is distinct from its canonical declaration owner's route. */
    const sourceIdentity = `${String(candidate.source)}:${String(candidate.name)}:${sourceSignature}`
    /**
     * Existing own declarations keep their identity; imported workspace records name their real API
     * owner.
     */
    const identity = String(candidate.source).startsWith(`packages/${directory.split('/').at(-1)}/`)
      ? sourceIdentity
      : `${packageName}:${sourceIdentity}`
    const details = buildSymbolSections({ ...candidate, identity }, packageName, exportPath)
    group.push({
      ...candidate,
      ...details,
      identity,
      signature: String(candidate.source).endsWith('.json')
        ? sourceSignature
        : sanitizePublicText(sourceSignature),
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
  const resolveSurface = inlinePrivateSurfaces(directory, symbols)
  /** Options use the same resolved public/private surfaces that API pages render. */
  for (const symbol of symbols)
    symbol.declaredConfiguration = configurationFromDeclarations(
      symbol,
      symbols,
      sourceDescriptions,
      resolveSurface
    )
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
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'rpc-integration' &&
        existsSync(join(packagesRoot, entry.name, 'package.json'))
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
      /** Public package metadata includes the supported plugin-author SDK entries. */
      const exports = Object.keys(manifest.exports ?? {}).sort()
      return {
        slug: entry.name,
        description: typeof manifest.description === 'string' ? manifest.description : null,
        version: typeof manifest.version === 'string' ? manifest.version : null,
        exports,
        /** Locales whose package README exists; the English rail links a README only when present. */
        readmeLocales: ['zh', ...(existsSync(join(directory, 'README.en.md')) ? ['en'] : [])],
        documentation: {
          readme: maintainedDocument(join(directory, 'README.md')),
          guide: publicMaintainedGuide(join(directory, 'USEGUIDE.md'), entry.name),
          /** English READMEs and usage guides live beside the Chinese files as `*.en.md`. */
          en: {
            readme: maintainedDocument(join(directory, 'README.en.md')),
            guide: publicMaintainedGuide(join(directory, 'USEGUIDE.en.md'), entry.name)
          }
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
async function generateManifests(libraries: ReturnType<typeof buildLibraryEntries>) {
  const contentRoot = resolve('src/content')
  const entries = buildContentEntries(contentRoot)
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
                path: `/${locale}/${domain}/${library.slug}/getting-started`,
                locale,
                domain,
                library: library.slug
              },
              {
                path: `/${locale}/${domain}/${library.slug}/readme`,
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
            const modulePath = `/${locale}/${domain}/${library.slug}/${API_SEGMENT}${moduleSlug === 'index' ? '' : `/${moduleSlug}`}`
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
                path: `${modulePath}/${symbolRouteSlug(symbol, moduleSymbols, reservedRouteSegments(library.exports, exportPath))}`,
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
  const allRouteEntries = Array.from(
    new Map(routeEntries.map((entry) => [entry.path, entry])).values()
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
        /** Route segment of this symbol; differs from its name only on a collision. */
        const routeSlug = symbolRouteSlug(
          symbol,
          ownerSymbols,
          reservedRouteSegments(library.exports, exportPath)
        )
        const maintainedExamples = maintainedExamplesForSymbol(
          maintainedContext,
          String(symbol.name),
          String(symbol.kind)
        )
        return {
          ...authoredSymbolMetadata(library.slug, slug, publicSymbol),
          identity,
          guidance,
          examples: maintainedExamples,
          usageScore: maintainedUsageScore(library.documentation, String(symbol.name)),
          configuration: maintainedConfiguration(
            maintainedContext,
            Array.isArray(symbol.declaredConfiguration) ? symbol.declaredConfiguration : []
          ),
          fragment: symbolFragment(`${library.slug}-${slug}`, routeSlug),
          ...(routeSlug !== encodeURIComponent(String(symbol.name)) ? { routeSlug } : {})
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
            ownerSymbol
              ? symbolRouteSlug(
                  ownerSymbol,
                  ownerSiblings,
                  reservedRouteSegments(library.exports, ownerExportPath)
                )
              : aliasName
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
        guidePath: `/en/docs/${library.slug}/getting-started`,
        architecturePath: `/en/docs/${library.slug}`,
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
  /** Maintained descriptions for defineHost fields whose declaration comments live above aliases. */
  const defineHostDescriptions: Readonly<Record<string, string>> = {
    host: 'Runtime policies forwarded to the canonical Host engine.',
    domainCore: "Factory for one plugin registration's domain capabilities.",
    translateDisposalError: 'Optional package-boundary translation for terminal cleanup failures.',
    dispose: 'Optional wrapper around the canonical terminal disposal operation.',
    receiver: 'Optional this receiver for callable extensions.',
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
          const defineHostDescription =
            api.library === 'plugin-host' &&
            api.module === 'index' &&
            String(symbol.identity).includes(':defineHost:')
              ? defineHostDescriptions[field.name]
              : undefined
          return {
            ...field,
            description:
              field.description ||
              (candidates?.size === 1 ? ([...candidates][0] ?? '') : '') ||
              defineHostDescription ||
              '',
            descriptionEn:
              field.descriptionEn ||
              (candidatesEn?.size === 1 ? ([...candidatesEn][0] ?? '') : '') ||
              defineHostDescription ||
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
      (locale) =>
        `/${locale}/docs/${api.library}/${API_SEGMENT}${api.module === 'index' ? '' : `/${api.module}`}`
    )
    const guidePaths = LOCALES.map((locale) => `/${locale}/docs/${api.library}/getting-started`)
    const architecturePaths = LOCALES.map((locale) => `/${locale}/docs/${api.library}`)
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
        const ownerPath = `/${LOCALES[index]}/docs/${api.library}/${API_SEGMENT}${alias.ownerModule === 'index' ? '' : `/${alias.ownerModule}`}`
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
            const importPath =
              wildcardPath === '.'
                ? packageName
                : `${packageName}/${wildcardPath.replace(/^\.\//u, '')}`
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
    if (selectedLibrary && library.slug !== selectedLibrary) continue
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
      source: string
      signature: string
      sections: Array<{ example?: string }>
    }>
  }>
  for (const api of formattableApis) {
    for (const symbol of api.symbols) {
      const formattedSignature = await format(
        `${symbol.name}${symbol.source.endsWith('.json') ? '.json' : '.d.ts'}`,
        symbol.signature,
        {
          printWidth: 88,
          semi: true,
          singleQuote: true
        }
      )
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
    writeGeneratedProjection(name, value)
  }
}

/** Runs the repository formatter over generated JSON so repeat runs share one byte form. */
function formatGeneratedJson() {
  /** Current per-library shards emitted by the canonical generator. */
  const libraryShards = readdirSync(resolve('src/generated/manifests/libraries'))
    .filter((name) => !selectedLibrary || name === `${selectedLibrary}.json`)
    .map((name) => resolve('src/generated/manifests/libraries', name))
  const files = [
    ...(selectedLibrary ? [selectedLibrary] : PACKAGES).map((pkg) =>
      resolve('src/generated/signatures', `${pkg}.json`)
    ),
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
  /** Complete the current workspace API calculation before changing generated projections. */
  const libraries = buildLibraryEntries()
  const dir = resolve('src/generated/signatures')
  mkdirSync(dir, { recursive: true })

  for (const pkg of selectedLibrary ? [selectedLibrary] : PACKAGES) {
    const output = { package: pkg, exports: [] }
    writeFileSync(resolve(dir, `${pkg}.json`), `${JSON.stringify(output, null, 2)}\n`)
    console.log(`✓ ${pkg}`)
  }
  await generateManifests(libraries)
  formatGeneratedJson()
  if (selectedLibrary === null)
    for (const retired of RETIRED_LIBRARIES)
      for (const path of [
        resolve('src/generated/signatures', `${retired}.json`),
        resolve('src/generated/manifests/libraries', `${retired}.json`)
      ])
        if (existsSync(path)) unlinkSync(path)
}

if (import.meta.main)
  generateSignatures().catch((error) => {
    console.error(error)
    process.exit(1)
  })
