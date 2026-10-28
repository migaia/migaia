#!/usr/bin/env bun
// Extract error codes from packages

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/** Each maintained declaration projects its own canonical domain into the website inventory. */
const PACKAGES = [
  'middleware-pipeline',
  'plugin-host',
  'log-host',
  'log-plugin-console',
  'log-plugin-http',
  'log-plugin-file',
  'log-plugin-process',
  'log-plugin-reasoning',
  'log-plugin-durable'
]

/** The repository registry owns parsing and validation; the site only selects package-owned rows. */
type IRegistryRow = { source: string; code: string; scenario: string }

/** Regenerates source-owned error facts without maintaining another declaration parser. */
async function generateErrorCodes() {
  /** A URL import reuses the repository's Node/Bun-compatible registry implementation. */
  const registryModule = pathToFileURL(resolve('../scripts/error-registry.mjs')).href
  /** The canonical producer validates descriptions, domains and duplicate identities once. */
  const { collectErrorRegistry } = await import(registryModule)
  /** Each domain is indexed once so generating several package shards stays linear. */
  const bySource = new Map<string, IRegistryRow[]>()
  for (const row of collectErrorRegistry(resolve('..')) as IRegistryRow[]) {
    /** The existing array belongs to one registered source domain. */
    const rows = bySource.get(row.source)
    if (rows) rows.push(row)
    else bySource.set(row.source, [row])
  }
  /** Generated shards are workspace facts; they never load website runtime dependencies. */
  const dir = resolve('src/generated/error-codes')
  mkdirSync(dir, { recursive: true })

  for (const pkg of PACKAGES) {
    /** Canonical constant declarations have no runtime dependencies or resource side effects. */
    const declaration = await import(
      pathToFileURL(resolve('../packages', pkg, 'src/error-code.ts')).href
    )
    /** Empty code tables intentionally omit a domain and project an empty inventory. */
    const codes: Record<string, { source: string; scenario: string }> = {}
    for (const row of bySource.get(declaration.ERROR_SOURCE) ?? [])
      codes[row.code] = { source: row.source, scenario: row.scenario }
    /** The stable shard schema keeps the existing codes object keyed by public semantic code. */
    const output = { package: pkg, codes }
    writeFileSync(resolve(dir, `${pkg}.json`), `${JSON.stringify(output, null, 2)}\n`)
    console.log(`✓ ${pkg}`)
  }
  /** Retired documentation has no generated shard or redirect after the package split. */
  const retired = resolve(dir, 'logger.json')
  if (existsSync(retired)) unlinkSync(retired)
  /** One formatter invocation gives repeat generations identical JSON bytes. */
  const result = spawnSync(
    'oxfmt',
    PACKAGES.map((pkg) => resolve('src/generated/error-codes', `${pkg}.json`)),
    { stdio: 'inherit' }
  )
  if (result.status !== 0) {
    console.error('generated error-code formatting failed')
    process.exit(result.status || 1)
  }
}

if (import.meta.main)
  generateErrorCodes().catch((error) => {
    console.error(error)
    process.exit(1)
  })
