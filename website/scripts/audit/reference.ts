/**
 * Reference documentation audit. Runs the rules of `app/reference/contract.ts` (implemented in
 * `app/reference/rules.ts`) against the generated manifest of each requested library.
 *
 * Usage: bun scripts/audit/reference.ts # every audited library in app/reference/index.ts bun
 * scripts/audit/reference.ts logger plugin-host bun scripts/audit/reference.ts logger --summary #
 * counts per rule only
 *
 * Exit code 1 when any finding exists. A library that is not registered yet is audited against an
 * empty reference, which reports its full documentation debt.
 */
import { readFileSync } from 'node:fs'
import type { ILibraryReference } from '../../app/reference/contract.ts'
import { libraryReferences } from '../../app/reference/index.ts'
import { auditLibrary, type IFinding, type IManifestModule } from '../../app/reference/rules.ts'

/** Reference used for a library that has not been migrated yet. */
const emptyReference: ILibraryReference = {
  modules: {},
  symbols: {},
  types: {},
  enums: {},
  enhancers: {}
}

/** Command-line flags and library names. */
const args = process.argv.slice(2)
const summaryOnly = args.includes('--summary')
const libraries = args.filter((arg) => !arg.startsWith('--'))
const targets = libraries.length > 0 ? libraries : Object.keys(libraryReferences)

/** Total findings across every audited library. */
let total = 0
for (const library of targets) {
  const manifest = JSON.parse(
    readFileSync(
      new URL(`../../src/generated/manifests/libraries/${library}.json`, import.meta.url),
      'utf8'
    )
  ) as { apis: IManifestModule[] }
  const findings: IFinding[] = auditLibrary(
    manifest.apis,
    libraryReferences[library] ?? emptyReference
  )
  total += findings.length
  /** Finding count per rule id. */
  const byRule = new Map<string, number>()
  for (const finding of findings) byRule.set(finding.rule, (byRule.get(finding.rule) ?? 0) + 1)
  console.log(
    `${library}: ${findings.length} finding(s)${findings.length ? ` — ${[...byRule].map(([rule, count]) => `${rule}=${count}`).join(' ')}` : ''}`
  )
  if (!summaryOnly)
    for (const finding of findings)
      console.log(`  [${finding.rule}] ${finding.where} — ${finding.message}`)
}
process.exitCode = total > 0 ? 1 : 0
