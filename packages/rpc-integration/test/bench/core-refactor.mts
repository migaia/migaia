/**
 * Measure the finite core-refactor scenarios through two public browser carrier hosts. The same
 * fixture bytes support the old root API and the new namespace API. Preparation, diagnostics and
 * provenance stay outside timing; identical payload checks are included in each measured exchange
 * on both versions.
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createHmac, createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

/** Only the public operations exercised by this fixed measurement are needed by the fixture. */
type IEndpoint = {
  request(method: string, payload?: unknown): Promise<unknown>
  stream(method: string, payload?: unknown): unknown
}
/** Host disposal and namespace projection are the only version-dependent surface difference. */
type IHost = { close(): Promise<void>; worker?: IEndpoint }
/** A real public module is loaded at runtime, with no dependency on a removed private owner. */
type IHostModule = { createRpcHost(options: unknown): Promise<IHost> }
/** Cold factories remain public definitions; the fixture never implements a transport itself. */
type ICarrierModule = { dedicatedWorkerPlugin(options: unknown): unknown }
/** Authentication configuration keeps the existing public transform contract on both versions. */
type IAuthentication = {
  sign(value: unknown): unknown
  verify(value: unknown): unknown
}
/** Only the BC3 public factory names differ between the two measured versions. */
type IFlowModule = {
  auth?: (options: IAuthentication) => unknown
  authFeature?: (options: IAuthentication) => unknown
  chunk?: () => unknown
  chunkFeature?: () => unknown
}
/** Explicit cold installation inputs avoid a callback capturing several independent owners. */
type IInstallationInputs = {
  api: IHostModule
  carrier: ICarrierModule
  features?: IFlowModule
  authentication: IAuthentication
  report(error: unknown): void
}
/** Each provider/client counter is reset after warmup and retained separately from timing. */
type ICounters = {
  issued: number
  settled: number
  providerStarted: number
  providerCompleted: number
  providerChunks: number
  clientChunks: number
  activeProvider: number
  maximumProvider: number
  signed: number
  verified: number
}
/** One fixed request/stream input is repeated without altering its payload inside timing. */
type IScenario = { name: string; mode: 'request' | 'stream'; bytes: number; chunks: number }

/** These stable fixture messages distinguish failed business evidence from usable measurements. */
const CorePerfText = {
  /** A failed signature means the real authentication transform did not preserve its envelope. */
  signature: 'core-refactor fixture signature mismatch',
  /** A missing stream indicates a public operation returned a different result shape. */
  stream: 'core-refactor fixture expected an async stream',
  /** Payload comparison must pass before a sample can count as a successful exchange. */
  payload: 'core-refactor fixture payload mismatch',
  /** Count mismatches prevent an incomplete provider/client exchange from yielding timing credit. */
  counters: 'core-refactor fixture exchange counters disagree'
} as const
/** Exactly the eight R12 cells are measured; no broader benchmark matrix is introduced. */
const scenarios: readonly IScenario[] = [
  { name: 'small-request', mode: 'request', bytes: 64, chunks: 1 },
  { name: '64KiB-binary', mode: 'request', bytes: 65_536, chunks: 1 },
  { name: '1MiB-binary', mode: 'request', bytes: 1_048_576, chunks: 1 },
  { name: 'stream-throughput', mode: 'stream', bytes: 8_192, chunks: 16 }
]
/** These immutable paths identify exactly the production artifacts loaded by this process. */
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url))
/** The finite evidence directory is supplied by the owner for each baseline/candidate run. */
const output = process.argv[2]
/** A fixed sample policy is identical for baseline, A/A and candidate runs. */
const samples = Number(process.env.CORE_PERF_SAMPLES ?? 300)
/** Preparation exchanges exercise the same path before every recorded cell. */
const warmup = Number(process.env.CORE_PERF_WARMUP ?? 30)
/** All reported failures include their semantic classification rather than only a code. */
const failures: unknown[] = []

/** Retain a redacted semantic failure; fixture payloads contain no credentials or user data. */
function classify(error: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof error !== 'object' || error === null)
    return { source: null, code: null, name: typeof error, reason: null, message: String(error) }
  if (seen.has(error)) return { repeatedCause: true }
  seen.add(error)
  return {
    source: Reflect.get(error, 'source') ?? null,
    code: Reflect.get(error, 'code') ?? null,
    name: Reflect.get(error, 'name') ?? null,
    reason: Reflect.get(error, 'reason') ?? null,
    message: String(Reflect.get(error, 'message') ?? error),
    stack: Reflect.get(error, 'stack') ?? null,
    cause: Reflect.has(error, 'cause') ? classify(Reflect.get(error, 'cause'), seen) : null,
    errors: error instanceof AggregateError ? error.errors.map((item) => classify(item, seen)) : []
  }
}

/** Read each exact dist file once outside timing; O(n log n) sorting only orders the report. */
function distProvenance(directory: string): { path: string; sha256: string }[] {
  /** The report includes all files so a dependency output change cannot hide behind one barrel. */
  const files: { path: string; sha256: string }[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    /** Every entry remains within one of the three explicitly loaded production packages. */
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...distProvenance(path))
    else if (entry.isFile())
      files.push({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** One owner holds host resources, business counters and authentication state for a single cell. */
class CorePerformanceCell {
  /** Each cell owns genuine MessagePorts and closes them after both public hosts close. */
  readonly #channel = new MessageChannel()
  /** Successful public installations are retained only until this cell finishes. */
  readonly #hosts: IHost[] = []
  /** Cancels either pending public installation when its sibling fails or the cell closes. */
  readonly #opening = new AbortController()
  /** Both endpoint counters expose the actual number of completed business operations. */
  readonly counters: ICounters = {
    issued: 0,
    settled: 0,
    providerStarted: 0,
    providerCompleted: 0,
    providerChunks: 0,
    clientChunks: 0,
    activeProvider: 0,
    maximumProvider: 0,
    signed: 0,
    verified: 0
  }
  /** The client endpoint retains its real receiver, including the namespace on the new API. */
  #endpoint: IEndpoint | undefined
  /** Exactly one immutable cell description controls the provider's stream length. */
  readonly #scenario: IScenario
  /** Reused binary data travels over the real native structured-clone carrier. */
  readonly #payload: Uint8Array | string
  /** Capture fixed scenario data; no library state or private connection is supplied. */
  constructor(scenario: IScenario) {
    this.#scenario = scenario
    this.#payload =
      scenario.mode === 'stream'
        ? 'a'.repeat(scenario.bytes)
        : new Uint8Array(scenario.bytes).fill(97)
  }
  /** Real transform work is counted independently at each end of the public message flow. */
  #sign = (value: unknown): unknown => {
    this.counters.signed += 1
    return { value, signature: this.#signature(value) }
  }
  /** An invalid transform aborts the cell instead of producing usable latency samples. */
  #verify = (value: unknown): unknown => {
    /** Only this fixture's own sign method creates the envelope used by its verifier. */
    const envelope = value as { value: unknown; signature: string }
    if (envelope.signature !== this.#signature(envelope.value))
      throw new Error(CorePerfText.signature)
    this.counters.verified += 1
    return envelope.value
  }
  /** HMAC uses a public fixture-only key, never a credential from the environment. */
  #signature(value: unknown): string {
    return createHmac('sha256', 'core-refactor-public-fixture-key')
      .update(JSON.stringify(value))
      .digest('hex')
  }
  /** Record actual provider concurrency, separate from the client's issued-call counter. */
  #enter(): void {
    this.counters.providerStarted += 1
    this.counters.activeProvider += 1
    this.counters.maximumProvider = Math.max(
      this.counters.maximumProvider,
      this.counters.activeProvider
    )
  }
  /** Provider completion owns the removal of its one active counter entry. */
  #leave(): void {
    this.counters.activeProvider -= 1
    this.counters.providerCompleted += 1
  }
  /** Echo the received binary object so request and response exercise the full public path. */
  #echo = (payload: unknown): unknown => {
    this.#enter()
    try {
      return payload
    } finally {
      this.#leave()
    }
  }
  /** Stream output stays provider-owned until its iterator settles or is cancelled. */
  async *#values(payload: unknown): AsyncGenerator<unknown> {
    this.#enter()
    try {
      for (let index = 0; index < this.#scenario.chunks; index++) {
        this.counters.providerChunks += 1
        yield payload
      }
    } finally {
      this.#leave()
    }
  }
  /** Install genuine public plugins at both ends; namespace selection is the sole API adapter. */
  async open(enhanced: boolean): Promise<void> {
    /** Production imports stay outside timing and resolve through each package's public exports. */
    const api = (await import('@migaia/rpc-host')) as unknown as IHostModule
    /** A native MessagePort is an already-supported dedicated-worker carrier, as in existing tests. */
    const carrier = (await import('@migaia/rpc-plugin-browser')) as unknown as ICarrierModule
    /** Inspect only published export metadata to select the old/new public plugin paths. */
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'rpc-host/package.json'), 'utf8'))
    /** The module path changes only because BC3/BC5 move existing abilities to plugins. */
    const featureModule = enhanced
      ? ((await import(
          manifest.exports['./plugins'] ? '@migaia/rpc-host/plugins' : '@migaia/rpc-host/features'
        )) as unknown as IFlowModule)
      : undefined
    /** Old and new transforms receive the exact same public authentication options. */
    const authentication: IAuthentication = { sign: this.#sign, verify: this.#verify }
    /** Real reporting retains every failure with its complete available classification. */
    const report = (error: unknown): void => {
      failures.push(classify(error))
    }
    /** Both installations receive the same explicit cold values and real callback identities. */
    const context: IInstallationInputs = {
      api,
      carrier,
      features: featureModule,
      authentication,
      report
    }
    /** Both handshakes must progress concurrently over their original native ports. */
    const opened = await Promise.all(
      [this.#channel.port1, this.#channel.port2].map((port, side) =>
        this.#install(port, side, context)
      )
    )
    this.#endpoint = opened[0]!.worker ?? (opened[0] as unknown as IEndpoint)
  }
  /** Install one real host and retain it immediately so sibling failure still has a cleanup owner. */
  #install(port: MessagePort, side: number, context: IInstallationInputs): Promise<IHost> {
    /** Factories create separate cold instances; no installed state is shared across hosts. */
    const plugins: unknown[] = [context.carrier.dedicatedWorkerPlugin({ worker: port })]
    if (context.features) {
      /** Factory renames are the exact BC3 move recorded in the public-contract ledger. */
      const auth = context.features.auth ?? context.features.authFeature!
      /** Auth and chunk always run together on the enhanced arm. */
      const chunk = context.features.chunk ?? context.features.chunkFeature!
      plugins.push(auth(context.authentication), chunk())
    }
    return context.api
      .createRpcHost({
        self: {
          name: side === 0 ? 'core-perf-client' : 'core-perf-provider',
          instanceId: `core-perf-${side}`
        },
        plugins,
        report: context.report,
        signal: this.#opening.signal,
        ...(side === 1
          ? { provide: { echo: this.#echo, values: (value: unknown) => this.#values(value) } }
          : {})
      })
      .then((host) => {
        this.#hosts.push(host)
        return host
      })
  }
  /** Clear all warmup counters once, before the measurement window for this cell begins. */
  reset(): void {
    for (const key of Object.keys(this.counters) as (keyof ICounters)[]) this.counters[key] = 0
  }
  /** One sequential operation records actual business completion, including every stream chunk. */
  async exchange(): Promise<void> {
    this.counters.issued += 1
    if (this.#scenario.mode === 'request') {
      /** Only the native response proves that both public call paths completed. */
      const result = await this.#endpoint!.request('echo', this.#payload)
      this.#check(result)
    } else {
      /** Awaiting also supports the old union return type without replacing the returned iterator. */
      const stream = await this.#endpoint!.stream('values', this.#payload)
      if (!stream || typeof Reflect.get(stream as object, Symbol.asyncIterator) !== 'function')
        throw new Error(CorePerfText.stream)
      for await (const value of stream as AsyncIterable<unknown>) {
        this.#check(value)
        this.counters.clientChunks += 1
      }
    }
    this.counters.settled += 1
  }
  /** Reject wrong text or binary boundaries before granting an exchange timing credit. */
  #check(value: unknown): void {
    if (typeof this.#payload === 'string') {
      if (value !== this.#payload) throw new Error(CorePerfText.payload)
      return
    }
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength !== this.#payload.byteLength ||
      value[0] !== 97 ||
      value[value.length - 1] !== 97
    )
      throw new Error(CorePerfText.payload)
  }
  /** Release every host before its native ports; cleanup errors remain classified and visible. */
  async close(): Promise<void> {
    this.#opening.abort()
    for (const host of this.#hosts) {
      try {
        await host.close()
      } catch (error) {
        failures.push(classify(error))
      }
    }
    this.#hosts.length = 0
    this.#channel.port1.close()
    this.#channel.port2.close()
    this.#endpoint = undefined
  }
}

/** Measure one fixed cell and reject incomplete counters rather than reporting misleading timing. */
async function measure(scenario: IScenario, enhanced: boolean): Promise<unknown> {
  /** One cell owns every resource acquired for this exact scenario and feature arm. */
  const cell = new CorePerformanceCell(scenario)
  try {
    await cell.open(enhanced)
    for (let index = 0; index < warmup; index++) await cell.exchange()
    cell.reset()
    /** Every operation has its own duration; sorting happens only after the measurement ends. */
    const durations: number[] = []
    /** Wall time measures the complete sequential workload, including genuine async scheduling. */
    const beginning = performance.now()
    for (let index = 0; index < samples; index++) {
      /** Each sample starts immediately before the actual public operation. */
      const start = performance.now()
      await cell.exchange()
      durations.push(performance.now() - start)
    }
    /** Capture timing before any sorting, JSON reporting or provenance work. */
    const elapsedMs = performance.now() - beginning
    durations.sort((left, right) => left - right)
    if (
      cell.counters.settled !== samples ||
      cell.counters.providerCompleted !== samples ||
      cell.counters.activeProvider !== 0 ||
      cell.counters.providerChunks !== cell.counters.clientChunks
    )
      throw new Error(CorePerfText.counters)
    return {
      scenario,
      enhanced,
      samples,
      warmup,
      elapsedMs,
      p50Ms: durations[Math.ceil(samples * 0.5) - 1],
      p99Ms: durations[Math.ceil(samples * 0.99) - 1],
      operationsPerSecond: (samples * 1000) / elapsedMs,
      bytesPerSecond: (samples * scenario.bytes * scenario.chunks * 1000) / elapsedMs,
      counters: { ...cell.counters },
      durationsMs: durations
    }
  } finally {
    await cell.close()
  }
}

/** Run the authorized finite R12 matrix and bind results to the exact fixture and dist bytes. */
async function main(): Promise<void> {
  /** Every arm uses the same sample policy and scenario order for paired comparisons. */
  const results: unknown[] = []
  matrix: for (const enhanced of [false, true])
    for (const scenario of scenarios) {
      try {
        results.push(await measure(scenario, enhanced))
      } catch (error) {
        failures.push({ scenario, enhanced, ...(classify(error) as object) })
        break matrix
      }
    }
  /** Source status includes this uncommitted shared fixture explicitly in the baseline receipt. */
  const receipt = {
    date: new Date().toISOString(),
    node: process.version,
    samples,
    warmup,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    fixtureSha256: createHash('sha256')
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .digest('hex'),
    dist: ['rpc-host', 'rpc-contract', 'rpc-plugin-browser'].flatMap((name) =>
      distProvenance(join(packageRoot, name, 'dist'))
    ),
    observedRejectionCodes:
      'none expected; all observed failures retain source/code/name/reason/message',
    clientConcurrency: 1,
    burstSize: 1,
    results,
    failures,
    status: failures.length ? 'failed' : 'measured'
  }
  if (output) writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(JSON.stringify({ status: receipt.status, output, cells: results.length, failures }))
  if (failures.length) process.exitCode = 1
}

await main()
