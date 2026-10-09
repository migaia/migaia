import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** This migrated driver runs only the user's finite 27-pair directed source inventory. */
const directory = fileURLToPath(new URL('.', import.meta.url))
/** Existing public-source endpoints execute on the owner's checkout, never a simulated SDK. */
const repository = resolve(directory, '../../../..')
/** Counter, baseline reverse RED and formal timing retain distinct receipt scopes. */
const mode = process.argv[2]
/** The owner prepares exact base/BC14 source copies before selecting any row. */
const prepared = resolve(process.argv[3])
/** Every invocation gets a new raw directory; previous failed attempts are never overwritten. */
const output = resolve(process.argv[4])
/** The exact version-checking wrapper is required for parent and child runtime execution. */
const wrapper = resolve(process.argv[5])
/** Optional selection is a bounded diagnostic subset, never full-matrix acceptance. */
const wanted = process.argv[6] ? new Set(process.argv[6].split(',')) : undefined
/** The approved inventory keeps original pair/carrier/EV identities. */
const scope = JSON.parse(readFileSync(join(directory, 'scope-plan.json'), 'utf8'))
/** Current head and explicit dirty context are recorded independently of historical scope pins. */
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository,
  encoding: 'utf8'
}).trim()
/** Actual foreign launchers own optimized build/execution; RPC endpoints still run TS source. */
const foreignExecutables = {
  python: '/usr/bin/python3',
  go: join(prepared, 'fixture/foreign/go/run.sh'),
  rust: join(prepared, 'fixture/foreign/rust/run.sh')
}
/** Only these real rows belong to this invocation's accepted evidence boundary. */
const rows = scope.rows.filter(
  (row) => (!wanted || wanted.has(row.key)) && (mode !== 'base-red' || row.direction === 'reverse')
)
mkdirSync(dirname(output), { recursive: true })
mkdirSync(output)
/** Exact driver bytes accompany every future raw; existing evidence is never re-stamped. */
const snapshotDirectory = join(output, 'source-snapshot')
mkdirSync(snapshotDirectory)
/** The endpoint, observer, resolver and plan determine the actual fixture behavior. */
const fixtureSources = [
  'run-grid.mjs',
  'endpoint.ts',
  'observe.ts',
  'node-source.mjs',
  'probe/resolve-hook.mjs',
  'scope-plan.json',
  '../text.mjs',
  '../error-text.mjs'
].map((path) => {
  /** Keep original path and hash while the copied bytes remain immutable evidence. */
  const source = join(directory, path)
  const sha256 = createHash('sha256').update(readFileSync(source)).digest('hex')
  const snapshot = join(snapshotDirectory, sha256 + '-' + path.split('/').at(-1))
  cpSync(source, snapshot)
  return { source, sha256, snapshot }
})
/** Branch classification is frozen before any native window; no code-only inference fills reasons. */
const plan = {
  head,
  dirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()
  ),
  mode,
  fixtureSources,
  pairs: 27,
  carrierRows: 54,
  selected: rows.map((row) => row.key),
  capacity: { maxReplayEntriesPerPeer: 1024, maxReplayEntries: 4096, replayTtlMs: 310000 },
  branches: {
    OVERLOADED: [
      'concurrency',
      'orderedQueueFull',
      'groupConcurrency',
      'groupReplayFull',
      'replayLedgerFull',
      'bindingExpired'
    ],
    JSONRPC_PROFILE_INVALID: ['unsupported-profile', 'base-client-only-incoming-method'],
    PROVIDER_NOT_FOUND: ['missing-foreign-route', 'missing-installed-provider'],
    TRANSPORT: ['close', 'write', 'peer-exit']
  },
  rejectionChannel:
    'actual onRejected reason and original numeric replay readCapacity in diagnostic copies only',
  admission: {
    priority: 'normal',
    maxLoad: mode === 'timing' ? 3 : 5,
    endLoad: 'report',
    waitSeconds: 2700
  },
  protocol:
    'fresh connection per every N1/N2 or AA/ABBA arm; matched actual source, defaults, warmup and sample count'
}
writeFileSync(join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
/** Results are appended after each actual terminal runner exit, including refused windows. */
const results = []
for (const row of rows) {
  /** Actual reverse TS provider selects the same prepared BC14 source graph, not another executor. */
  const variant = row.direction === 'reverse' && mode !== 'base-red' ? 'target' : 'base'
  /** No counter hooks are present in plain timing source. */
  const capture = mode === 'timing' ? 'plain' : 'count'
  /** Pair direction fixes the process that executes the actual TS endpoint program. */
  const runtime = row.direction === 'reverse' ? row.provider : row.initiator
  /** The mode owns a complete distinct RPC/serialize dependency copy. */
  const source = join(
    prepared,
    'fixture',
    (variant === 'target' ? 'target-' : '') + capture,
    'packages/rpc/src'
  )
  /** Native runner receipts are keyed by the original directed pair and carrier. */
  const stem = join(output, row.key.replaceAll(':', '--'))
  /** Deno's original supported source flags are preserved, without a JS fallback. */
  const entry =
    runtime === 'node' ? join(directory, 'node-source.mjs') : join(directory, 'endpoint.ts')
  /** Every actual runtime invocation is an argv array; fixture values never become shell code. */
  const args = [
    'node',
    '/Users/kaeo/workspack/migai/scripts/exclusive-window.mjs',
    'run',
    '--window',
    'core-c5-' + mode + '-' + row.pairOrdinal + '-' + row.carrier.split('-')[0],
    '--priority',
    'normal',
    '--wait',
    '2700',
    '--max-seconds',
    '900',
    '--end-load',
    'report'
  ]
  if (mode === 'timing') args.push('--max-load', '3')
  args.push(
    '--',
    '/bin/bash',
    wrapper,
    runtime,
    ...(runtime === 'deno'
      ? ['run', '--allow-all', '--sloppy-imports', '--node-modules-dir=manual', '--cached-only']
      : []),
    entry
  )
  /** Counter and timing environment comes from the sealed owner plan, never wire metadata. */
  const env = {
    ...process.env,
    XRT_HEAD: head,
    XRT_CELL: JSON.stringify(row),
    XRT_STEM: stem,
    XRT_SIDE: mode === 'timing' ? 'paired' : 'rpc',
    XRT_TIMING: mode === 'timing' ? '1' : '0',
    XRT_CAPTURE: capture,
    XRT_VARIANT: variant,
    XRT_SOURCE_ROOT: pathToFileURL(source + '/').href,
    XRT_FIXTURE_ROOT: pathToFileURL(join(prepared, 'fixture/foreign') + '/').href,
    XRT_FOREIGN_EXECUTABLES: JSON.stringify(foreignExecutables),
    XRT_SOURCE_MANIFEST: join(prepared, 'source-manifest.json'),
    XRT_ENV_RUN: wrapper
  }
  /** Existing wrapper validates every exact tool version before the exclusive runner starts. */
  const run = spawnSync('/bin/bash', [wrapper, ...args], {
    cwd: repository,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  writeFileSync(stem + '.stdout.log', run.stdout ?? '')
  writeFileSync(stem + '.stderr.log', run.stderr ?? '')
  /**
   * An expected baseline reverse rejection is evidence only when its real profile failure is
   * present.
   */
  let raw
  /** Missing or malformed raw stays a preparation/evidence failure, never a fabricated PASS. */
  let rawReadError
  try {
    raw = JSON.parse(readFileSync(stem + '.json', 'utf8'))
  } catch (error) {
    rawReadError = { name: error.name, code: error.code ?? null, message: error.message }
  }
  /** Failure status keeps the original native exit and all actual error tuples. */
  const expectedRed =
    mode === 'base-red' &&
    run.status === 1 &&
    raw?.failure?.code === 'JSONRPC_PROFILE_INVALID' &&
    raw?.final?.provider?.calls === 0
  const item = {
    key: row.key,
    command: ['/bin/bash', wrapper, ...args],
    exit: run.status,
    signal: run.signal,
    status:
      run.status === 0 && raw?.status === 'PASS'
        ? 'PASS'
        : expectedRed
          ? 'EXPECTED_BASE_RED'
          : run.status === 75
            ? 'ADMISSION_REFUSED'
            : 'FAIL',
    raw: stem + '.json',
    source,
    failure: raw?.failure,
    rawReadError,
    sha256: raw
      ? createHash('sha256')
          .update(readFileSync(stem + '.json'))
          .digest('hex')
      : null
  }
  results.push(item)
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify({ key: item.key, exit: item.exit, status: item.status }))
  if (run.status === 69 || run.status === 75 || item.status === 'FAIL') {
    process.exitCode = run.status || 1
    break
  }
}
