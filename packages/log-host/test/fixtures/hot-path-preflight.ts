import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The migrated owner replaces the old registry; both are inspected through their real contents. */
const root = process.cwd()
/** A1's identity owner change is independent of this A5 hot-path observation. */
const ownerPath = existsSync(resolve(root, 'packages/log-host/src/feature-metadata.ts'))
  ? 'packages/log-host/src/feature-metadata.ts'
  : 'packages/log-host/src/feature-registry.ts'
/**
 * These three existing paths contain all baseline descriptor lookups on gate, delivery, and text
 * work.
 */
const subjects = [
  { path: ownerPath, name: 'acceptsEntry', start: /export function acceptsEntry\(/, end: '\n}' },
  {
    path: ownerPath,
    name: 'deliveryFeature',
    start: /export function deliveryFeature[<(]/,
    end: '\n}'
  },
  {
    path: 'packages/log-host/src/output.ts',
    name: 'text record',
    start: /  record\(entry: ILogEntry\): ILogOutputRecord\s*\{/,
    end: '\n  }'
  }
]
/** Hot implementations must consume installed policy objects without consulting definition metadata. */
const forbiddenLookup =
  /\b(?:featureImplementation|featureMetadata|featureScope|inspectFeatures|installedFeatureScope)\s*\(|\b(?:issuedFeatures|logFeatureMetadata)\s*\.\s*get\s*\(/
/** A missing selector is an evidence error, not the intended metadata-lookup RED. */
const missingSubjects: string[] = []
/** Every matched forbidden lookup is retained with its actual owning function and source line. */
const failures: { path: string; name: string; line: number; lookup: string }[] = []
for (const subject of subjects) {
  /** Source reads are bounded to the three known baseline hot-path owners, without executing them. */
  const source = readFileSync(resolve(root, subject.path), 'utf8')
  /** A real function body must be present before the lookup assertion can say anything about it. */
  const match = subject.start.exec(source)
  if (!match) {
    missingSubjects.push(`${subject.path}:${subject.name}`)
    continue
  }
  /** Top-level and class-method closing indentation delimit these existing non-nested owners. */
  const end = source.indexOf(subject.end, match.index)
  if (end < 0) {
    missingSubjects.push(`${subject.path}:${subject.name}:closing brace`)
    continue
  }
  /** The selected hot body includes its calls but excludes unrelated cold configuration helpers. */
  const body = source.slice(match.index, end)
  /** One descriptor lookup is sufficient to violate A5; normal policy calls remain allowed. */
  const lookup = forbiddenLookup.exec(body)
  if (lookup)
    failures.push({
      path: subject.path,
      name: subject.name,
      line: source.slice(0, match.index + lookup.index).split('\n').length,
      lookup: lookup[0]
    })
}
console.log(JSON.stringify({ acceptance: 'A5', subjects, missingSubjects, failures }))
assert.deepEqual(
  missingSubjects,
  [],
  'A5 hot-callgraph selector unavailable; not a metadata-lookup RED'
)
assert.equal(failures.length, 0, 'A5 hot-path metadata lookup remains')
