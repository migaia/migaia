import { snapshot } from '../../bench/observe.mjs'
import { fileURLToPath } from 'node:url'
import { IpcBenchErrorText } from '../../bench/error-text.mjs'
import { RuntimeBench } from '../../bench/text.mjs'

/** Existing Worker entry installs the actual native child transport using its launcher bootstrap. */
const entry = fileURLToPath(new URL('./ipc-session.mjs', import.meta.url))

/**
 * Build one original owned Node source, retaining native handles for independent cold sampling.
 *
 * @param {string} topology Actual worker role in this fixed benchmark graph.
 * @param {object} policy Original classification/provider policy supplied by the session owner.
 * @param {object[]} handles Actual launcher results, never facade-shaped process observations.
 * @returns {Promise<object>} Original thread source specification.
 */
async function source(topology, policy, handles) {
  const { createNodeThreadLauncher, createNodeThreadChannelFactory } =
    await import('../../../rpc-plugin-thread/dist/threads/adapters/node.js')
  const { createUnitBudget } = await import('@migaia/supervision')
  const { systemScheduler } = await import('@migaia/utils/scheduler')
  /**
   * Wrapping only records the exact native handle and preserves its original private launch
   * context.
   */
  const launcher = createNodeThreadLauncher()
  return {
    spec: { entry, name: topology, data: { topology } },
    launcher: {
      ...launcher,
      async launch(spec, context) {
        const handle = await launcher.launch(spec, context)
        handles.push(handle)
        return handle
      }
    },
    budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    scheduler: systemScheduler,
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
    report: policy.report
  }
}

/**
 * Execute ordinary requests through the committed Host outlet or its actual one-hop forward table.
 *
 * @param {{ carrier: string; side: string; payload: string; topology: string }} options Fixed
 *   graph.
 * @param {object} policy Original provider limits, full rejection classifier and report owner.
 * @returns {Promise<object>} Owned session with genuine Peer/Host provenance and native
 *   observations.
 * @throws {Error} Original construction, request, resource or cleanup failure.
 */
/** Explicit owner of a single benchmark topology and its original native resources. */
class RuntimeSession {
  /** Frozen topology selects the already-defined managed, relay or reverse path. */
  #topology
  /** Business payload is retained once for all measured exchanges. */
  #payload
  /** Original provider/rejection/report owner remains unchanged across native preparation. */
  #policy
  /** Dynamically loaded canonical factories are absent from bare benchmark arms. */
  #api
  /** Actual launcher receipts prove child identity without copied facade-shaped observations. */
  #handles = []
  /** Each topology owns one genuine PluginHost for its native transport registration. */
  #host
  /** Reverse timing borrows the genuine Peer committed by the same ordinary Host outlet. */
  #peer
  /** Managed outlet remains the real committed family slot. */
  #outlet
  /** Accepted original Peer identity is retained for the provenance oracle. */
  #facade
  /** Reverse identity is supplied by a genuine child call and checked against its native handle. */
  #initiatorThreadId

  /**
   * @param {object} input Frozen graph. @param {object} policy Original rejection/provider policy.
   * @param {object} api Canonical loaded factory graph.
   */
  constructor(input, policy, api) {
    this.#topology = input.topology
    this.#payload = input.payload
    this.#policy = policy
    this.#api = api
  }
  /** @returns {Promise<void>} Prepare the selected original graph before any timing window. */
  async prepare() {
    this.#host = new this.#api.PluginHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    try {
      if (this.#topology === RuntimeBench.reverse) await this.#prepareReverse()
      else if (this.#topology === RuntimeBench.managed) await this.#prepareManaged()
      else await this.#prepareRelay()
      this.#outlet = this.#topology === RuntimeBench.oneHop ? this.#host.process : this.#host.thread
      this.#facade = this.#api.readRuntimeOutletConnection(this.#outlet, 'bench').peer
      if (this.#topology === RuntimeBench.reverse) this.#peer = this.#facade
      if (this.#topology === RuntimeBench.oneHop)
        await this.#outlet.request('bench', RuntimeBench.ready)
    } catch (primary) {
      try {
        await this.#host.dispose()
      } catch (cleanup) {
        this.#policy.report(cleanup)
      }
      throw primary
    }
  }
  /** @returns {Promise<void>} Reverse keeps the actual child as the measurement initiator. */
  async #prepareReverse() {
    await this.#host.use(
      this.#api.threadPlugin({
        name: 'bench',
        probe: globalThis.__PROBE_BENCH_PROBE,
        self: { name: 'parent', instanceId: 'parent' },
        providerLimits: this.#policy.providerLimits,
        report: this.#policy.report,
        provide: { bench: { echo: (value) => value, snapshot } },
        spawn: await source(RuntimeBench.reverse, this.#policy, this.#handles)
      })
    )
  }

  /** @returns {Promise<void>} Register the original canonical managed Thread definition. */
  async #prepareManaged() {
    await this.#host.use(
      this.#api.threadPlugin({
        name: 'bench',
        probe: globalThis.__PROBE_BENCH_PROBE,
        self: { name: 'parent', instanceId: 'parent' },
        providerLimits: this.#policy.providerLimits,
        report: this.#policy.report,
        spawn: await source('leaf', this.#policy, this.#handles)
      })
    )
  }
  /** @returns {Promise<void>} Register the genuine process relay, retaining its physical launcher. */
  async #prepareRelay() {
    const { createNodeProcessLauncher } =
      await import('../../../rpc-plugin-process/dist/process/adapters/node-child-process.js')
    const { systemScheduler } = await import('@migaia/utils/scheduler')
    const { createUnitBudget } = await import('@migaia/supervision')
    /** The process relay can explicitly own a Worker without ambiguous automatic Thread sources. */
    const launcher = createNodeProcessLauncher()
    await this.#host.use(
      this.#api.processPlugin({
        name: 'bench',
        probe: globalThis.__PROBE_BENCH_PROBE,
        self: { name: 'parent', instanceId: 'parent' },
        providerLimits: this.#policy.providerLimits,
        report: this.#policy.report,
        spawn: {
          kind: 'spawn',
          channelKind: 'byte',
          wire: 'native',
          token: RuntimeBench.token,
          supervision: {
            id: 'relay',
            scheduler: systemScheduler,
            isolation: 'best-effort',
            report: this.#policy.report,
            budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
            output: {
              onChunk: (stream, chunk) => {
                if (stream === 'stderr')
                  process.stderr.write(
                    Buffer.from(chunk).toString().replaceAll(RuntimeBench.token, '[REDACTED_AUTH]')
                  )
              }
            },
            spec: {
              command: process.execPath,
              args: [entry, '--runtime-child'],
              env: {
                inherit: ['PATH'],
                set: { IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.relay' }
              },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
              bootstrap: {
                via: 'stdin',
                payload: new TextEncoder().encode(RuntimeBench.token)
              }
            },
            launcher: {
              ...launcher,
              launch: async (spec, context) => {
                const handle = await launcher.launch(spec, context)
                this.#handles.push(handle)
                return handle
              }
            }
          },
          rawChannel: (handle) => handle.channel,
          establish: (raw, context) =>
            this.#api.createProcessTransport(raw, {
              role: 'initiator',
              peerId: this.#handles.at(-1).runtimeApiIdentity.instanceId,
              offer: context.offer,
              signal: context.signal,
              scheduler: context.scheduler,
              ipc: { ...context.session, log: () => undefined },
              report: this.#policy.report
            })
        }
      })
    )
  }
  /** @returns {object | undefined} Original managed Host, when this graph owns one. */
  get host() {
    return this.#host
  }
  /** @returns {object} Original accepted Peer identity used by the provenance oracle. */
  get facade() {
    return this.#facade
  }
  /** @returns {number} Actual process PID; Thread graphs share the parent process. */
  get peerPid() {
    return this.#topology === RuntimeBench.oneHop ? this.#handles[0].identity.pid : process.pid
  }
  /** @returns {object[]} Original native handles of this graph. */
  get nativeHandles() {
    return this.#handles
  }
  /** @returns {number | undefined} Child-supplied measurement initiator identity. */
  get initiatorThreadId() {
    return this.#initiatorThreadId
  }
  /** @returns {Promise<void>} All native readiness is completed by preparation. */
  ready = async () => undefined
  /** @returns {Promise<void>} One real business request, preserving its original selection path. */
  exchange = async () => {
    if (this.#peer) {
      const result = await this.#peer.request(RuntimeBench.reverseProbe, this.#payload)
      if (
        result.value !== this.#payload ||
        result.initiatorThreadId !== this.#handles[0].identity.threadId
      )
        throw new Error(IpcBenchErrorText.echo)
      this.#initiatorThreadId = result.initiatorThreadId
      return
    }
    const method =
      this.#topology === RuntimeBench.managed ? 'bench.echo' : RuntimeBench.forwardedEcho
    if ((await this.#outlet.request('bench', method, this.#payload)) !== this.#payload)
      throw new Error(IpcBenchErrorText.echo)
  }
  /**
   * @returns {((unit: object, options: object) => Promise<object>) | undefined} Only reverse owns a
   *   child timing loop.
   */
  get runInInitiator() {
    return this.#peer
      ? (unit, options) => this.#peer.request(RuntimeBench.measure, { unit, options })
      : undefined
  }
  /** @returns {Promise<object>} Actual peer isolate snapshot outside timing. */
  peerSnapshot = () =>
    this.#peer
      ? this.#peer.request(RuntimeBench.snapshot)
      : this.#outlet.request('bench', RuntimeBench.snapshot)
  /** @returns {object} Original rejection ledger. */
  classification = () => this.#policy.classification
  /** @returns {Promise<void>} Release leaf before relay; preserve primary cleanup error identity. */
  close = async () => {
    const failures = []
    try {
      if (this.#topology === RuntimeBench.oneHop)
        await this.#outlet.request('bench', RuntimeBench.releaseLeaf)
    } catch (error) {
      failures.push(error)
    }
    try {
      await this.#host.dispose()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, IpcBenchErrorText.cleanup)
  }
}

/**
 * Build the original managed, relay or reverse graph with explicit resource ownership.
 *
 * @param {{ carrier: string; side: string; payload: string; topology: string }} input Fixed graph.
 * @param {object} policy Original provider/rejection policy.
 * @returns {Promise<object>} Owned graph with genuine Peer/Host provenance.
 * @throws {Error} Original configuration, native preparation or cleanup error.
 */
export async function createRuntimeSession(input, policy) {
  const { carrier, side, topology } = input
  if (
    side !== 'rpc' ||
    ![RuntimeBench.managed, RuntimeBench.oneHop, RuntimeBench.reverse].includes(topology) ||
    carrier !== (topology === RuntimeBench.oneHop ? RuntimeBench.mixedCarrier : 'worker')
  )
    throw new TypeError(IpcBenchErrorText.configuration)
  const { PluginHost } = await import('@migaia/plugin-host')
  const { threadPlugin } = await import('@migaia/rpc-plugin-thread')
  const { processPlugin } = await import('@migaia/rpc-plugin-process')
  const { createProcessTransport } =
    await import('../../../rpc-plugin-process/dist/process/handshake.js')
  const { readRuntimeOutletConnection } =
    await import('../../../rpc-host/dist/remote/runtime-api/outlet.js')
  const session = new RuntimeSession(input, policy, {
    PluginHost,
    threadPlugin,
    processPlugin,
    createProcessTransport,
    readRuntimeOutletConnection
  })
  await session.prepare()
  return session
}

/** The native worker owns providers and relay registrations through the same ordinary Host. */
class RuntimeWorker {
  /** Original policy retains rejection classification and provider bounds for every native link. */
  #policy
  /** Genuine PluginHost owns registration, rollback and resource teardown. */
  #host
  /** Canonical cold plugin factories are loaded before the worker publishes readiness. */
  #api
  /** Relay leaf handles retain independent native provenance. */
  #handles = []
  /** The exact parent installation Promise gates the relay ready method. */
  #installed

  /**
   * @param {object} policy Original diagnostics and admission policy.
   * @param {object} api Actual native PluginHost and cold transport factories.
   */
  constructor(policy, api) {
    this.#policy = policy
    this.#api = api
    this.#host = new api.PluginHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  /**
   * @param {string} topology Select the existing reverse, leaf or relay graph.
   * @returns {Promise<void>} Readiness after actual native Host commit.
   * @throws {Error} Original native preparation, registration or rollback failure.
   */
  async prepare(topology) {
    try {
      if (topology === RuntimeBench.reverse || topology === 'leaf') {
        await this.#host.use(
          this.#api.threadPlugin({
            name: 'parent',
            connectToParent: true,
            probe: globalThis.__PROBE_BENCH_PROBE,
            providerLimits: this.#policy.providerLimits,
            report: this.#policy.report,
            provide: {
              bench:
                topology === RuntimeBench.reverse
                  ? {
                      snapshot,
                      reverseProbe: this.#reverseProbe,
                      measure: this.#measure
                    }
                  : { echo: (payload) => payload, snapshot }
            }
          })
        )
        return
      }
      await this.#prepareRelay()
    } catch (primary) {
      try {
        await this.#host.dispose()
      } catch (cleanup) {
        this.#policy.report(cleanup)
      }
      throw primary
    }
  }

  /** @returns {Promise<void>} Install the actual leaf and process parent on distinct native slots. */
  async #prepareRelay() {
    await this.#host.use(
      this.#api.threadPlugin({
        name: 'leaf',
        probe: globalThis.__PROBE_BENCH_PROBE,
        report: this.#policy.report,
        providerLimits: this.#policy.providerLimits,
        spawn: await source('leaf', this.#policy, this.#handles)
      })
    )
    this.#installed = this.#host.use(
      this.#api.processPlugin({
        name: 'parent',
        connectToParent: true,
        expose: ['leaf'],
        probe: globalThis.__PROBE_BENCH_PROBE,
        report: this.#policy.report,
        providerLimits: this.#policy.providerLimits,
        provide: {
          bench: {
            ready: async () => {
              await this.#installed
              return true
            },
            snapshot: async () => ({
              ...snapshot(),
              descendant: await this.#host.thread.request('leaf', 'bench.snapshot')
            }),
            releaseLeaf: async () => {
              await this.#host.unUse('leaf')
              return true
            }
          }
        }
      })
    )
    await this.#installed
  }

  /**
   * @param {unknown} value Original payload sent back by the native Worker initiator.
   * @returns {Promise<object>} Business result and independent native initiator identity.
   */
  #reverseProbe = async (value) => ({
    value: await this.#host.thread.request('parent', RuntimeBench.echo, value),
    initiatorThreadId: snapshot().threadId
  })

  /**
   * @param {{ unit: object; options: object }} input Original fixed measurement settings.
   * @returns {Promise<object>} Existing observer evidence with the true Worker timing role.
   * @throws {Error} Original business, observation or cleanup failure.
   */
  #measure = async ({ unit, options }) => {
    const { measureBare } = await import('../../bench/ipc.mjs')
    const { createMacPidObserver } = await import('../../bench/bare-node.mjs')
    /** The genuine parent connection remains fixed for this one measurement episode. */
    const outlet = this.#host.thread
    /** The observer samples the actual native process containing this Worker. */
    const observer = await createMacPidObserver([process.pid])
    /** Construct one original payload outside warmup and measured exchanges. */
    const payload = 'x'.repeat(unit.payloadBytes)
    try {
      for (let index = 0; index < (options.warmup ?? 100); index++)
        await outlet.request('parent', RuntimeBench.echo, payload)
      /** Independent snapshots distinguish trigger execution from the Worker timing loop. */
      const parentBefore = await outlet.request('parent', RuntimeBench.snapshot)
      /** The native worker identity is sampled outside timing. */
      const peerBefore = snapshot()
      /** Existing measurement owner preserves concurrency, samples and failure classification. */
      const measured = await measureBare({
        observer,
        samples: options.samples ?? 1000,
        concurrency: unit.concurrency,
        warmup: 0,
        ready: async () => undefined,
        exchange: async () => {
          if ((await outlet.request('parent', RuntimeBench.echo, payload)) !== payload)
            throw new Error(IpcBenchErrorText.echo)
        }
      })
      return {
        ...measured,
        type: 'ipc-side',
        unit,
        side: 'rpc',
        parentBefore,
        peerBefore,
        parentAfter: await outlet.request('parent', RuntimeBench.snapshot),
        peerAfter: snapshot(),
        initiatorRole: 'worker',
        initiatorThreadId: peerBefore.threadId,
        timingClock: 'native Worker process.hrtime.bigint; parent trigger outside measured loop',
        classification: this.#policy.classification,
        samplingMaxReplayEntriesPerPeer: 1200,
        providerConcurrency: 'NOT_INSTRUMENTED_FORMAL',
        gcStatus: 'NOT_COLLECTED_FORMAL_TIMING'
      }
    } finally {
      await observer.close()
    }
  }
}

/**
 * Install genuine child or relay providers on ordinary native transport registrations.
 *
 * @param {{ topology: string }} input Portable role data supplied by the actual launcher.
 * @param {object} policy Original provider, rejection and report owner.
 * @returns {Promise<void>} Readiness after native Host commit.
 * @throws {Error} Original native preparation or registration failure.
 */
export async function serveRuntimeWorker(input, policy) {
  const { PluginHost } = await import('@migaia/plugin-host')
  const { threadPlugin } = await import('@migaia/rpc-plugin-thread')
  const { processPlugin } = await import('@migaia/rpc-plugin-process')
  /** One owner retains the worker Host across its registered method callbacks. */
  const worker = new RuntimeWorker(policy, { PluginHost, threadPlugin, processPlugin })
  await worker.prepare(input.topology)
}
