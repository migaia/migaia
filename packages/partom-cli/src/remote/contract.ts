import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IIssue } from '@migaia/part-contract'
import { SHARED_GLOBAL_KEY } from './build.ts'
import { SHARED_RUNTIME } from './rules.ts'
import { RemoteRule } from './text.ts'

/** Milliseconds one effect may run in the contract test. */
export const EFFECT_TIMEOUT_MS = 2000

/** Milliseconds the whole contract-test child may run before its process is killed. */
const CHILD_TIMEOUT_MS = 30000

/** One definition the module exports, as the contract test found it. */
export type IContractExport = {
  readonly id: string
  readonly kind: 'enhancer' | 'effect' | 'derive'
}

/** Contract-test result of one module. */
export type IContractResult = {
  readonly exports: readonly IContractExport[]
  readonly issues: readonly IIssue[]
}

/** Raw child report: definitions and `[rule, message]` problems. */
type IChildReport = {
  readonly exports: readonly IContractExport[]
  readonly problems: readonly (readonly [string, string])[]
}

/**
 * Source of the child script. It imports the shared runtime from the project, places it on the
 * shared global, imports the built module, and checks each exported definition: enhancers and
 * derives twice for equal output (inputs frozen), effects once with a recording context under a
 * timeout. It prints one JSON report on stdout.
 */
function childSource(built: string): string {
  return `
const shared = {}
for (const name of ${JSON.stringify(SHARED_RUNTIME)}) {
  try { shared[name] = await import(name) } catch {}
}
globalThis[Symbol.for(${JSON.stringify(SHARED_GLOBAL_KEY)})] = shared
const report = { exports: [], problems: [] }
const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child) } return value }
const same = (first, second) => JSON.stringify(first) === JSON.stringify(second)
let loaded
try { loaded = await import(${JSON.stringify(built)}) } catch (error) { report.problems.push([${JSON.stringify(RemoteRule.contractFailed)}, String(error?.message ?? error)]) }
const list = loaded === undefined ? [] : Array.isArray(loaded.default) ? loaded.default : [loaded.default]
for (const definition of list) {
  const kind = definition?.descriptor?.kind
  const id = definition?.descriptor?.id
  if (kind !== 'enhancer' && kind !== 'effect' && kind !== 'derive') continue
  report.exports.push({ id, kind })
  try {
    if (kind === 'enhancer') {
      const input = freeze({ props: {}, attrs: {}, aria: {}, data: {}, style: {} })
      const context = { address: 'contract/sample', node: freeze({ tag: 'sample@1' }), args: undefined }
      if (!same(definition.transform(input, context), definition.transform(input, context))) report.problems.push([${JSON.stringify(RemoteRule.impure)}, id])
    } else if (kind === 'derive') {
      const view = { read: () => undefined, write: () => { throw new TypeError('derive wrote state') } }
      if (!same(definition.compute(view, undefined), definition.compute(view, undefined))) report.problems.push([${JSON.stringify(RemoteRule.impure)}, id])
    } else {
      const calls = []
      const record = (name) => (...args) => { calls.push([name, args]); return Promise.resolve(undefined) }
      const ctx = { features: {}, models: {}, resources: { run: record('run') }, state: { read: () => undefined, write: record('write') }, dispatch: record('dispatch'), part: () => ({ dispatch: record('part.dispatch') }) }
      const event = { address: 'contract/sample', name: 'click', key: 'click', detail: undefined }
      const outcome = await Promise.race([Promise.resolve(definition.run(event, ctx)).then(() => 'ok'), new Promise((resolve) => setTimeout(() => resolve('timeout'), ${EFFECT_TIMEOUT_MS}))])
      if (outcome === 'timeout') report.problems.push([${JSON.stringify(RemoteRule.contractTimeout)}, id])
    }
  } catch (error) {
    report.problems.push([error instanceof TypeError && kind !== 'effect' ? ${JSON.stringify(RemoteRule.impure)} : ${JSON.stringify(RemoteRule.contractFailed)}, String(error?.message ?? error)])
  }
}
if (loaded !== undefined && report.exports.length === 0) report.problems.push([${JSON.stringify(RemoteRule.noDefinitions)}, ''])
console.log(JSON.stringify(report))
process.exit(0)
`
}

/** Issue of one contract problem, located at the module. */
function issueOf(name: string, rule: string, basis: string): IIssue {
  return {
    address: '',
    facet: 'module',
    path: name,
    code: rule,
    rule,
    messageKey: rule,
    severity: 'error',
    ...(basis === '' ? {} : { basis })
  }
}

/**
 * Runs the contract test of a built module in a Bun child whose working directory is the project
 * and whose environment holds only `PATH` (plus `BUN_BE_BUN`), so no token reaches module code. The
 * child script and the built file live in `tempDir` inside the project, so bare imports resolve
 * from the project.
 */
export async function contractTest(
  project: string,
  tempDir: string,
  built: Uint8Array,
  name: string
): Promise<IContractResult> {
  /** Built module file. */
  const builtFile = join(tempDir, 'module.js')
  writeFileSync(builtFile, built)
  /** Child script file. */
  const script = join(tempDir, 'contract.ts')
  writeFileSync(script, childSource(builtFile))
  /** Child process. */
  const child = Bun.spawn([process.execPath, script], {
    cwd: project,
    // BUN_BE_BUN makes a compiled partom executable act as plain `bun`; no other variable passes.
    env: { PATH: process.env.PATH ?? '', BUN_BE_BUN: '1' },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  /** Kill timer for a hung child. */
  const timer = setTimeout(() => child.kill(), CHILD_TIMEOUT_MS)
  /** Child output. */
  const output = await new Response(child.stdout).text()
  await child.exited
  clearTimeout(timer)
  /** Last non-empty line holds the report. */
  const line = output.trim().split('\n').at(-1) ?? ''
  /** Parsed report, or a failure when the child printed none. */
  let report: IChildReport
  try {
    report = JSON.parse(line) as IChildReport
  } catch {
    return { exports: [], issues: [issueOf(name, RemoteRule.contractFailed, output.slice(0, 500))] }
  }
  return {
    exports: report.exports,
    issues: report.problems.map(([rule, basis]) => issueOf(name, rule, basis))
  }
}
