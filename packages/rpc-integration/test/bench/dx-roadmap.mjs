import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { openSync, closeSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nearestRank } from '../../bench/ipc.mjs'
import { median } from '../../bench/cross-runtime/statistics.mjs'
import { classify } from '../../bench/classification.mjs'
import { IpcBenchErrorText } from '../../bench/error-text.mjs'
import { IpcBenchDiagnostic } from '../../bench/text.mjs'

/** @typedef {'base' | 'candidate'} IVersion */
/** @typedef {'profile' | 'counter' | 'timing' | 'report'} IMode */
/**
 * @typedef {{
 *   id: string
 *   carrier: string
 *   payloadBytes: number
 *   concurrency: number
 *   codec: string
 *   executable: string
 *   runtime: string
 * }} IUnit
 */
/** @typedef {{ mode: IMode; base: string; candidate: string; output: string; pairs: number }} IOptions */
/**
 * @typedef {{
 *   functionName: string
 *   ranges: { startOffset: number; endOffset: number; count: number }[]
 *   isBlockCoverage: boolean
 * }} ICoverageFunction
 */
/** @typedef {{ scriptId: string; url: string; ownership: string; functions: ICoverageFunction[] }} ICoverage */
/**
 * @typedef {{
 *   status: string
 *   cpuProfile?: object
 *   guard?: {
 *     promises: { created: number; status: string; scope: string }
 *     coverage: ICoverage[]
 *     allocationTrace: {
 *       status: string
 *       trackedEventCount: number
 *       trackedHeapBytes: number
 *       ownershipTotals: Record<string, { trackedEventCount: number; trackedHeapBytes: number }>
 *     }
 *   }
 * }} IDiagnostic
 */
/**
 * @typedef {{
 *   loaded?: object[]
 *   diagnostic?: IDiagnostic
 *   isolateRole?: string
 *   pid?: number
 *   threadId?: number
 * }} ISnapshot
 */
/**
 * @typedef {{
 *   samples: number
 *   latenciesNs: number[]
 *   timingStatus?: string
 *   parentBefore?: ISnapshot
 *   peerBefore?: ISnapshot
 *   parentAfter?: ISnapshot
 *   peerAfter?: ISnapshot
 * }} IReceipt
 */
/**
 * @typedef {{
 *   id: string
 *   phase: 'profile' | 'guard' | 'aa' | 'timing'
 *   unit: IUnit
 *   version: IVersion
 *   side: 'rpc' | 'bare'
 *   pair: number
 *   repetition: number
 *   samples: number
 * }} IArm
 */
/**
 * @typedef {{
 *   source: unknown
 *   code: unknown
 *   name: unknown
 *   reason: unknown
 *   message: string
 *   cause?: IClassified | null
 *   errors?: IClassified[]
 *   repeatedCause?: boolean
 * }} IClassified
 */
/**
 * @typedef {{
 *   arm: IArm
 *   startedAt: string
 *   completedAt: string
 *   exitCode: number | null
 *   signal: string | null
 *   spawnFailure: IClassified | null
 *   directory: string
 *   receiptFile: string | null
 *   sideErrorFile: string | null
 * }} IResult
 */
/**
 * @typedef {{
 *   mode: IMode
 *   createdAt: string
 *   node: string
 *   executable: string
 *   roots: Record<IVersion, string>
 *   commits: Record<IVersion, string>
 *   fixtureSHA256: Record<IVersion, Record<string, string | null>>
 *   pairs: number
 *   arms: IArm[]
 * }} IPlan
 */

/** One owner defines fixture-only states; absent engine evidence never becomes numeric zero. */
const Status = Object.freeze({
  unavailable: 'UNAVAILABLE',
  pass: 'PASS',
  fail: 'FAIL'
})
/** Both sides use the already frozen 64-byte, one-client-lane units. */
const unitIds = ['node:stdio-framed:64', 'node:worker:64']
/** Warmup and larger guard point fit the unchanged 1200-entry sampling replay capacity. */
const warmup = 100
/** Two nearby supported sample counts expose fixed diagnostic control cost without changing owners. */
const guardSamples = [1000, 1090]
/** These existing physical/measurement owners must be identical in both prepared trees. */
const fixturePaths = [
  'test/bench/ipc-session.mjs',
  'bench/ipc-side.mjs',
  'bench/observe.mjs',
  'bench/p3-diagnostic.mjs',
  'bench/classification.mjs',
  'bench/bare-node.mjs',
  'bench/native-pid-observer.py',
  'bench/ipc.mjs',
  'bench/text.mjs',
  'bench/error-text.mjs'
]

/**
 * Parse the finite protocol, leaving exclusive-window admission to the caller.
 *
 * @param {string[]} args Explicit mode followed by paired flags.
 * @returns {IOptions} Absolute source and raw-directory selections.
 * @throws {TypeError} Missing/unknown flags, invalid pairs or nonabsolute paths.
 */
function parse(args) {
  /** Only the documented modes execute a finite arm inventory or reread existing raw data. */
  const mode = args[0]
  /** Paired CLI flags are data, never shell fragments or alternate executable requests. */
  const fields = new Map()
  for (let index = 1; index < args.length; index += 2) {
    if (!['--base', '--candidate', '--output', '--pairs'].includes(args[index]) || !args[index + 1])
      throw new TypeError(IpcBenchErrorText.configuration)
    if (fields.has(args[index])) throw new TypeError(IpcBenchErrorText.configuration)
    fields.set(args[index], args[index + 1])
  }
  /** At least five retained pairs are mandatory; no replacement rounds are selected. */
  const pairs = Number(fields.get('--pairs') ?? 5)
  /** Report reads the saved plan and does not need two live source trees. */
  const output = fields.get('--output')
  if (
    !['profile', 'counter', 'timing', 'report'].includes(mode) ||
    !isAbsolute(output ?? '') ||
    !Number.isInteger(pairs) ||
    pairs < 5
  )
    throw new TypeError(IpcBenchErrorText.configuration)
  if (
    mode !== 'report' &&
    (!isAbsolute(fields.get('--base') ?? '') || !isAbsolute(fields.get('--candidate') ?? ''))
  )
    throw new TypeError(IpcBenchErrorText.configuration)
  return { mode, base: fields.get('--base'), candidate: fields.get('--candidate'), output, pairs }
}

/**
 * Preserve causal spawn/read failures using the existing redacted classification owner.
 *
 * @param {unknown} error Original failure, never inferred from an exit code.
 * @param {Set<unknown>} [seen] Exact causal identities already visited.
 * @returns {IClassified} Original classifications plus the retained cause/errors chain.
 */
function classifyTree(error, seen = new Set()) {
  if (seen.has(error)) return { ...classify(error), repeatedCause: true }
  seen.add(error)
  return {
    ...classify(error),
    cause: error?.cause === undefined ? null : classifyTree(error.cause, seen),
    errors: Array.isArray(error?.errors)
      ? error.errors.map((value) => classifyTree(value, seen))
      : []
  }
}

/**
 * Read a JSON file without substituting an empty measurement for a malformed receipt.
 *
 * @param {string} path Existing raw JSON path.
 * @returns {Promise<object>} Parsed original contents.
 * @throws {Error} Native read or JSON parse failure.
 */
async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * Freeze only the existing selected units and explicit serial execution order.
 *
 * @param {IOptions} options Validated finite protocol selection.
 * @returns {Promise<IPlan>} Immutable arm inventory and source/fixture identity metadata.
 * @throws {Error} Missing inventory, source identity or unequal physical measurement fixtures.
 */
async function planFor(options) {
  /** Each root's public package resolution loads that root's actual built dist. */
  const roots = { base: options.base, candidate: options.candidate }
  /** Snapshot metadata distinguishes product commits from the intentionally copied fixture edits. */
  const commits = {},
    fixtureSHA256 = {}
  for (const version of ['base', 'candidate']) {
    commits[version] = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: roots[version],
      encoding: 'utf8'
    }).trim()
    fixtureSHA256[version] = {}
    for (const path of fixturePaths) {
      /** Exact bytes identify the same benchmark owner used on the two production graphs. */
      const bytes = await readFile(join(roots[version], 'packages/rpc-integration', path))
      fixtureSHA256[version][path] = createHash('sha256').update(bytes).digest('hex')
    }
  }
  if (JSON.stringify(fixtureSHA256.base) !== JSON.stringify(fixtureSHA256.candidate))
    throw new Error(IpcBenchErrorText.mismatch)
  /** The frozen input owns codec, payload, runtime and physical carrier configuration. */
  const inventory = await json(
    join(roots.candidate, 'packages/rpc-integration/bench/support-units.json')
  )
  /** Only these already supported cells enter this bounded roadmap protocol. */
  const units = unitIds.map((id) => inventory.units.find((unit) => unit.id === id))
  if (
    units.some(
      (unit) =>
        !unit || unit.payloadBytes !== 64 || unit.concurrency !== 1 || unit.runtime !== 'node'
    )
  )
    throw new Error(IpcBenchErrorText.inventory)
  /** Every side is a separate subprocess; module-global session/observer state is never reused. */
  const arms = []
  /** One arm label names its persisted input and every original side output. */
  const add = (unit, phase, pair, version, side, repetition = 0, samples = 1000) =>
    arms.push({
      id: `${phase}-${unit.carrier}-${pair}-${version}-${side}-${repetition}-${samples}`,
      phase,
      unit,
      pair,
      version,
      side,
      repetition,
      samples
    })
  if (options.mode === 'profile') {
    for (const unit of units) add(unit, 'profile', 0, 'base', 'rpc')
  } else if (options.mode === 'counter') {
    for (const unit of units)
      for (let repetition = 0; repetition < 2; repetition++)
        for (const samples of guardSamples)
          for (const version of repetition % 2 ? ['candidate', 'base'] : ['base', 'candidate'])
            add(unit, 'guard', 0, version, 'rpc', repetition, samples)
  } else {
    for (const unit of units) {
      for (let pair = 0; pair < 2; pair++)
        for (let repetition = 0; repetition < 2; repetition++)
          for (const side of (pair + repetition) % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'])
            add(unit, 'aa', pair, 'base', side, repetition)
      for (let pair = 0; pair < options.pairs; pair++)
        for (const version of pair % 2 ? ['candidate', 'base'] : ['base', 'candidate'])
          for (const side of pair % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'])
            add(unit, 'timing', pair, version, side)
    }
  }
  return {
    mode: options.mode,
    createdAt: new Date().toISOString(),
    node: process.version,
    executable: process.execPath,
    roots,
    commits,
    fixtureSHA256,
    pairs: options.pairs,
    arms
  }
}

/**
 * Execute one existing JSON side CLI, preserving output before interpreting its disposition.
 *
 * @param {IPlan} plan Frozen source roots and current Node executable.
 * @param {IArm} arm Original side input and ordering metadata.
 * @param {string} output Fresh raw parent directory.
 * @returns {Promise<IResult>} Native exit, original error receipt paths and raw output identity.
 * @throws {Error} Raw-directory I/O failure prevents preservation and stops orchestration.
 */
async function runArm(plan, arm, output) {
  /** The side's observation files and CPU/heap profiles remain beside its exact input. */
  const directory = join(output, arm.id)
  await mkdir(directory)
  /** Diagnostics are separate arms; ordinary timing never enables instrumentation. */
  const options = {
    warmup,
    samples: arm.samples,
    ...(arm.phase === 'profile'
      ? { diagnostic: 'cpu' }
      : arm.phase === 'guard'
        ? { diagnostic: 'guard' }
        : {})
  }
  /** Serialize configuration once; it never contains launch credentials or shell code. */
  const input = { unit: arm.unit, side: arm.side, options }
  /** Resolution through the matching source-tree entry preserves that arm's actual dependency graph. */
  const command = [
    join(plan.roots[arm.version], 'packages/rpc-integration/bench/ipc-side.mjs'),
    JSON.stringify(input)
  ]
  await writeFile(join(directory, 'input.json'), JSON.stringify(input))
  await writeFile(
    join(directory, 'command.json'),
    JSON.stringify({ executable: plan.executable, args: command, cwd: plan.roots[arm.version] })
  )
  /** File descriptors preserve partial stdout/stderr even if the outer window terminates this arm. */
  const stdout = openSync(join(directory, 'stdout.log'), 'wx'),
    stderr = openSync(join(directory, 'stderr.log'), 'wx')
  /** Launch/exit evidence is independent of receipt validity and performance judgments. */
  let spawnFailure = null,
    exitCode = null,
    signal = null
  /** Wall timestamps bracket the complete arm, including preparation and cleanup. */
  const startedAt = new Date().toISOString()
  try {
    /** The caller's existing exclusive process group owns the whole finite sequence. */
    const child = spawn(plan.executable, command, {
      cwd: plan.roots[arm.version],
      stdio: ['ignore', stdout, stderr],
      env: { ...process.env, IPC_BENCH_STEM: join(directory, 'observation') }
    })
    await new Promise((done) => {
      child.once('error', (error) => {
        spawnFailure = classifyTree(error)
      })
      child.once('close', (code, killedBy) => {
        exitCode = code
        signal = killedBy
        done()
      })
    })
  } finally {
    closeSync(stdout)
    closeSync(stderr)
  }
  /** Only successful JSON stdout becomes a measurement receipt; raw bytes always remain. */
  let receiptFile = null,
    sideErrorFile = null
  if (exitCode === 0 && !spawnFailure) {
    try {
      await json(join(directory, 'stdout.log'))
      receiptFile = join(directory, 'receipt.json')
      await writeFile(receiptFile, await readFile(join(directory, 'stdout.log')))
    } catch (error) {
      spawnFailure = classifyTree(error)
    }
  }
  try {
    await readFile(join(directory, 'observation.error.json'))
    sideErrorFile = join(directory, 'observation.error.json')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  /** Persist every disposition before the next arm starts; failures never select replacements. */
  const result = {
    arm,
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode,
    signal,
    spawnFailure,
    directory,
    receiptFile,
    sideErrorFile
  }
  await writeFile(join(directory, 'execution.json'), JSON.stringify(result))
  return result
}

/**
 * Recompute one p50 from all retained raw latency samples with the canonical nearest-rank owner.
 *
 * @param {IReceipt | undefined} receipt Actual ordinary timing receipt.
 * @returns {number | null} Original sample percentile, or unavailable on incomplete/diagnostic
 *   data.
 */
function p50(receipt) {
  if (
    !receipt ||
    receipt.timingStatus ||
    !Array.isArray(receipt.latenciesNs) ||
    receipt.latenciesNs?.length !== receipt.samples ||
    receipt.samples !== 1000 ||
    receipt.latenciesNs.some((value) => !Number.isFinite(value) || value <= 0)
  )
    return null
  return nearestRank(receipt.latenciesNs, 0.5)
}

/**
 * Read exact diagnostic channels without claiming total native/external allocation ownership.
 *
 * @param {IReceipt | undefined} receipt Original instrumented side receipt.
 * @returns {object} Raw totals, exact coverage matches, ownership metadata and explicit scope.
 */
function guard(receipt) {
  /** Each engine isolate has its own captured counters even when Worker PID is shared. */
  const snapshots = [receipt?.parentAfter, receipt?.peerAfter]
  if (
    !receipt?.timingStatus ||
    snapshots.some(
      (snapshot) =>
        snapshot?.diagnostic?.status !== IpcBenchDiagnostic.captured ||
        !Array.isArray(snapshot.diagnostic.guard?.coverage) ||
        snapshot.diagnostic.guard?.promises?.status !== IpcBenchDiagnostic.promiseStatus ||
        snapshot.diagnostic.guard?.allocationTrace?.status !==
          IpcBenchDiagnostic.allocationStatus ||
        !Number.isFinite(snapshot.diagnostic.guard?.promises?.created) ||
        !Number.isFinite(snapshot.diagnostic.guard?.allocationTrace?.trackedHeapBytes) ||
        !Number.isFinite(snapshot.diagnostic.guard?.allocationTrace?.trackedEventCount)
    )
  )
    return { status: Status.unavailable }
  /** Only actual RPC dist function entries qualify as normalization, not same-named fixture helpers. */
  const normalization = snapshots.flatMap((snapshot) =>
    snapshot.diagnostic.guard.coverage.flatMap((script) =>
      script.ownership === IpcBenchDiagnostic.rpc
        ? script.functions
            .filter(
              (fn) => /normaliz/i.test(fn.functionName) && Number.isFinite(fn.ranges?.[0]?.count)
            )
            .map((fn) => ({ url: script.url, ...fn }))
        : []
    )
  )
  /** All raw matches/ranges remain available to audit the semantic function selection. */
  const normalizationEntries = normalization.length
    ? normalization.reduce((sum, fn) => sum + fn.ranges[0].count, 0)
    : null
  /** These are Node tracked-heap events, not all malloc, external buffers or unprofiled allocation. */
  const totals = {
    promises: snapshots.reduce(
      (sum, snapshot) => sum + snapshot.diagnostic.guard.promises.created,
      0
    ),
    normalizationEntries,
    trackedHeapBytes: snapshots.reduce(
      (sum, snapshot) => sum + snapshot.diagnostic.guard.allocationTrace.trackedHeapBytes,
      0
    ),
    trackedEventCount: snapshots.reduce(
      (sum, snapshot) => sum + snapshot.diagnostic.guard.allocationTrace.trackedEventCount,
      0
    )
  }
  if (Object.values(totals).some((value) => value !== null && !Number.isFinite(value)))
    return { status: Status.unavailable }
  return {
    status: IpcBenchDiagnostic.captured,
    totals,
    normalization,
    isolates: snapshots.map((snapshot) => ({
      pid: snapshot.pid,
      threadId: snapshot.threadId,
      isolateRole: snapshot.isolateRole,
      promises: snapshot.diagnostic.guard.promises,
      ownershipTotals: snapshot.diagnostic.guard.allocationTrace.ownershipTotals
    })),
    scope:
      'Instrumented Node Promise init, precise coverage entries and tracked heap events across both isolates; includes fixture/control/observer work; excludes native/external/unprofiled total allocation.'
  }
}

/** @typedef {IResult & { p50Ns: number | null; guard?: ReturnType<typeof guard> }} IRoadmapRow */

/** Saved evidence lookup preserves the first original arm and journal row for each exact case. */
class RoadmapEvidenceIndex {
  /** One indexed projection owns no native resource and never changes the saved evidence. */
  #byCase = new Map()

  /**
   * Index each original journal and plan once, retaining the old first-match semantics.
   *
   * @param {IPlan} plan Original finite arm plan.
   * @param {IRoadmapRow[]} rows Original result projections in journal order.
   */
  constructor(plan, rows) {
    /** Duplicate journal IDs keep the same first row previously selected by Array.find. */
    const byId = new Map()
    for (const row of rows) if (!byId.has(row.arm.id)) byId.set(row.arm.id, row)
    for (const arm of plan.arms) {
      /** Case tuples contain only the original scalar selectors, without filename inference. */
      const key = this.#key(
        arm.unit.id,
        arm.phase,
        arm.pair,
        arm.version,
        arm.side,
        arm.repetition,
        arm.samples
      )
      if (!this.#byCase.has(key)) this.#byCase.set(key, byId.get(arm.id))
    }
  }

  /**
   * Encode the exact original selector tuple, keeping scalar boundaries unambiguous.
   *
   * @param {string} unit Unit identity from the saved plan.
   * @param {IArm['phase']} phase Original measurement phase.
   * @param {number} pair Original pair number.
   * @param {IVersion} version Original graph side.
   * @param {IArm['side']} side Original RPC or bare arm.
   * @param {number} repetition Original control repetition.
   * @param {number} samples Original finite sample count.
   * @returns {string} Stable private lookup key.
   */
  #key(unit, phase, pair, version, side, repetition, samples) {
    return JSON.stringify([unit, phase, pair, version, side, repetition, samples])
  }

  /**
   * Read the same first exact result the prior two Array.find calls selected.
   *
   * @param {string} unit Saved unit identity.
   * @param {IArm['phase']} phase Saved phase.
   * @param {number} pair Saved pair number.
   * @param {IVersion} version Saved graph side.
   * @param {IArm['side']} side Saved RPC or bare arm.
   * @param {number} [repetition] Original default control repetition.
   * @param {number} [samples] Original default sample count.
   * @returns {IRoadmapRow | undefined} Exact original row or unavailable evidence.
   */
  lookup(unit, phase, pair, version, side, repetition = 0, samples = 1000) {
    return this.#byCase.get(this.#key(unit, phase, pair, version, side, repetition, samples))
  }

  /**
   * Subtract the original paired bare p50 from the same graph's RPC p50.
   *
   * @param {string} unit Saved unit identity.
   * @param {IArm['phase']} phase Original comparison phase.
   * @param {number} pair Original pair number.
   * @param {IVersion} version Original graph side.
   * @param {number} [repetition] Original control repetition.
   * @returns {{ bareP50Ns: number; rpcP50Ns: number; overheadNs: number } | null} Paired overhead.
   */
  overhead(unit, phase, pair, version, repetition = 0) {
    /** Both values come from the same original case tuple. */
    const bare = this.lookup(unit, phase, pair, version, 'bare', repetition)?.p50Ns,
      rpc = this.lookup(unit, phase, pair, version, 'rpc', repetition)?.p50Ns
    return bare == null || rpc == null
      ? null
      : { bareP50Ns: bare, rpcP50Ns: rpc, overheadNs: rpc - bare }
  }
}

/**
 * Read original arm receipts and retain every loaded-code observation, including failed arms.
 *
 * @param {IResult[]} results Original journal entries; readFailure remains attached to its entry.
 * @returns {Promise<{
 *   receipts: Map<string, IReceipt | undefined>
 *   loaded: object[]
 *   rows: IRoadmapRow[]
 * }>}
 *   Original receipts plus their timing/guard projections.
 * @throws {Error} A missing side-error receipt retains the original I/O failure.
 */
async function loadRoadmapEvidence(results) {
  /** Exact original receipts remain joined to their arm identities. */
  const receipts = new Map()
  /** Manifest rows retain both actual loaded and disk hashes, including failed-side snapshots. */
  const loaded = [],
    rows = []
  for (const result of results) {
    /** A failed/malformed side remains unavailable with its original causal error receipt retained. */
    let receipt
    try {
      if (result.receiptFile) receipt = await json(result.receiptFile)
    } catch (error) {
      result.readFailure = classifyTree(error)
    }
    receipts.set(result.arm.id, receipt)
    for (const key of ['parentBefore', 'peerBefore', 'parentAfter', 'peerAfter'])
      for (const record of receipt?.[key]?.loaded ?? [])
        loaded.push({ arm: result.arm.id, snapshot: key, ...record })
    if (result.sideErrorFile) {
      /** Error snapshots retain loaded provenance even when no timing receipt exists. */
      const failed = await json(result.sideErrorFile)
      for (const record of failed.snapshot?.loaded ?? [])
        loaded.push({ arm: result.arm.id, snapshot: 'error', ...record })
    }
    rows.push({
      ...result,
      p50Ns: p50(receipt),
      ...(result.arm.phase === 'guard' ? { guard: guard(receipt) } : {})
    })
  }
  return { receipts, loaded, rows }
}

/**
 * Compute one unit's original A/A noise and all persisted A/B gains without dropping pairs.
 *
 * @param {RoadmapEvidenceIndex} index Exact saved-case lookup.
 * @param {IPlan} plan Original pair count and measurement mode.
 * @param {string} unit Fixed benchmark unit identity.
 * @returns {object} Original timing qualification row.
 */
function roadmapTiming(index, plan, unit) {
  /** Two same-base controls independently calibrate the normalized overhead metric. */
  const aa = Array.from({ length: 2 }, (_, pair) => {
    const first = index.overhead(unit, 'aa', pair, 'base', 0),
      second = index.overhead(unit, 'aa', pair, 'base', 1)
    return {
      pair,
      first,
      second,
      relativeChange:
        first?.overheadNs > 0 && second?.overheadNs > 0
          ? Math.abs(second.overheadNs / first.overheadNs - 1)
          : null
    }
  })
  /** Retain all paired gains; an incomplete block cannot contribute a passing median. */
  const pairs = Array.from({ length: plan.pairs }, (_, pair) => {
    const base = index.overhead(unit, 'timing', pair, 'base'),
      candidate = index.overhead(unit, 'timing', pair, 'candidate')
    return {
      pair,
      order: pair % 2 ? ['candidate', 'base'] : ['base', 'candidate'],
      base,
      candidate,
      improvement:
        base?.overheadNs > 0 && candidate?.overheadNs > 0
          ? 1 - candidate.overheadNs / base.overheadNs
          : null
    }
  })
  /** Noise and target qualification require every original control and pair to remain complete. */
  const noiseBand = aa.every((value) => value.relativeChange !== null)
    ? Math.max(...aa.map((value) => value.relativeChange))
    : null
  const improvement = pairs.every((value) => value.improvement !== null)
    ? median(pairs.map((value) => value.improvement))
    : null
  return {
    unit,
    aa,
    pairs,
    noiseBand,
    improvement,
    target: 0.3,
    status:
      plan.mode !== 'timing' || noiseBand === null || improvement === null
        ? Status.unavailable
        : improvement >= 0.3 && improvement > noiseBand
          ? Status.pass
          : Status.fail
  }
}

/**
 * Compute one unit's tracked-heap slopes from its fixed two guard sample sizes and repetitions.
 *
 * @param {RoadmapEvidenceIndex} index Exact saved-case lookup.
 * @param {string} unit Fixed benchmark unit identity.
 * @returns {object} Original allocation evidence and its unchanged unavailable total-allocation
 *   claim.
 */
function roadmapCounters(index, unit) {
  /** This 90-request difference estimates slope/intercept; diagnostic/control work remains included. */
  const repetitions = []
  for (const version of ['base', 'candidate'])
    for (let repetition = 0; repetition < 2; repetition++) {
      const points = guardSamples.map((samples) => ({
        samples,
        guard: index.lookup(unit, 'guard', 0, version, 'rpc', repetition, samples)?.guard
      }))
      const slope = {}
      for (const metric of [
        'promises',
        'normalizationEntries',
        'trackedHeapBytes',
        'trackedEventCount'
      ]) {
        const low = points[0].guard?.totals?.[metric],
          high = points[1].guard?.totals?.[metric]
        slope[metric] =
          low == null || high == null
            ? null
            : {
                perRequest: (high - low) / (guardSamples[1] - guardSamples[0]),
                interceptEstimate:
                  low - ((high - low) / (guardSamples[1] - guardSamples[0])) * guardSamples[0]
              }
      }
      repetitions.push({ version, repetition, points, slope })
    }
  /** Allocation comparisons are scoped tracked-heap evidence, never total native allocation PASS. */
  const allocation = {}
  for (const version of ['base', 'candidate']) {
    const values = repetitions
      .filter((row) => row.version === version)
      .map((row) => row.slope.trackedHeapBytes?.perRequest)
    allocation[version] = values.every((value) => Number.isFinite(value) && value > 0)
      ? median(values)
      : null
  }
  return {
    unit,
    sampleDifference: guardSamples[1] - guardSamples[0],
    repetitions,
    trackedAllocationPerRequest: allocation,
    trackedAllocationImprovement:
      allocation.base > 0 && allocation.candidate > 0
        ? 1 - allocation.candidate / allocation.base
        : null,
    totalAllocationStatus: Status.unavailable,
    scope:
      'Tracked Node heap trace slope only; original total per-request native/external allocation target remains unavailable.'
  }
}

/**
 * Reread every saved arm and recompute tables without running a side or changing its raw data.
 *
 * @param {string} output Existing output directory with plan and completed arm journal.
 * @returns {Promise<object>} Complete timing/noise/guard tables and missing-evidence disposition.
 * @throws {Error} Missing or malformed saved plan/journal is never silently repaired.
 */
export async function recomputeRoadmap(output) {
  /** The saved inventory, not current filenames or successful-arm count, defines completeness. */
  const plan = await json(join(output, 'plan.json')),
    results = await json(join(output, 'arms.json'))
  /** Loading and indexing retain the original row objects and failed-side observations. */
  const { receipts, loaded, rows } = await loadRoadmapEvidence(results)
  /** Index creation is O(arms + results); every subsequent original case lookup is O(1). */
  const index = new RoadmapEvidenceIndex(plan, rows)
  /** The immutable unit IDs drive the same original timing and counter row order. */
  const timing = unitIds.map((unit) => roadmapTiming(index, plan, unit)),
    counters = unitIds.map((unit) => roadmapCounters(index, unit))
  /** A finite failed side marks this run incomplete without throwing away successful evidence. */
  const complete =
    results.length === plan.arms.length &&
    results.every(
      (row) => row.exitCode === 0 && !row.spawnFailure && row.receiptFile && !row.readFailure
    )
  /** Complete raw profiles stay in each receipt, avoiding a second lossy profile representation. */
  const summary = {
    plan,
    complete,
    armCount: results.length,
    expectedArms: plan.arms.length,
    rows,
    timing,
    counters,
    profiles: rows
      .filter((row) => row.arm.phase === 'profile')
      .map((row) => ({
        arm: row.arm.id,
        receiptFile: row.receiptFile,
        status: [receipts.get(row.arm.id)?.parentAfter, receipts.get(row.arm.id)?.peerAfter].every(
          (snapshot) =>
            snapshot?.diagnostic?.status === IpcBenchDiagnostic.captured &&
            snapshot.diagnostic.cpuProfile
        )
          ? IpcBenchDiagnostic.captured
          : Status.unavailable
      })),
    distManifest: join(output, 'dist-manifest.json')
  }
  await writeFile(join(output, 'dist-manifest.json'), JSON.stringify({ loaded }))
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary))
  return summary
}

/**
 * Execute a finite existing-side protocol or recompute its original raw evidence.
 *
 * @param {string[]} args Documented positional mode and explicit flags.
 * @returns {Promise<object>} Recomputed complete tables and raw paths.
 * @throws {Error} Invalid/freshness configuration or raw I/O failure; individual side failures
 *   persist and continue.
 */
export async function runRoadmap(args) {
  /** Parsing happens before any output directory or native child is created. */
  const options = parse(args)
  if (options.mode === 'report') return recomputeRoadmap(options.output)
  /** Fresh-only creation protects prior raw observations and forbids in-place replacement arms. */
  const plan = await planFor(options)
  await mkdir(options.output)
  await writeFile(join(options.output, 'plan.json'), JSON.stringify(plan))
  /** The journal is updated after every original arm, including native failures. */
  const results = []
  await writeFile(join(options.output, 'arms.json'), JSON.stringify(results))
  for (const arm of plan.arms) {
    results.push(await runArm(plan, arm, options.output))
    await writeFile(join(options.output, 'arms.json'), JSON.stringify(results))
  }
  return recomputeRoadmap(options.output)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runRoadmap(process.argv.slice(2)).then(
    (summary) => {
      console.log(JSON.stringify(summary))
      if (!summary.complete) process.exitCode = 1
    },
    (error) => {
      console.error(JSON.stringify(classifyTree(error)))
      process.exitCode = 1
    }
  )
