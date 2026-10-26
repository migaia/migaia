import { IpcBenchErrorText } from '../../bench/error-text.mjs'
import '../../bench/observe.mjs'
import { snapshot, waitForObservation } from '../../bench/observe.mjs'
import {
  IpcBenchControl,
  IpcBenchObservation,
  IpcBenchDiagnostic,
  RuntimeBench
} from '../../bench/text.mjs'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { openSync, closeSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort, Worker, MessageChannel } from 'node:worker_threads'
import { readFileSync, existsSync } from 'node:fs'
/** Only actual Deno uses its Command/std streams and native Web Worker adapters. */
const deno = typeof Deno !== 'undefined'
/** Loader registration finishes before importing the actual production adapter modules. */
const { createNodeProcessLauncher, openProcessStdioChannel } =
  await import('../../../rpc-plugin-process/dist/process/adapters/node-child-process.js')
/** Bare and RPC Deno sides share the same delivered byte carrier, without Node spawn substitution. */
const denoProcess = deno
  ? await import('../../../rpc-plugin-process/dist/process/adapters/deno-command.js')
  : undefined
/** Both bare and RPC byte sides reuse the exact delivered physical carrier. */
const { dialProcessByteChannel, listenProcessByteChannel } =
  await import('../../../rpc-plugin-process/dist/process/adapters/node-socket.js')
/** Channel scheduling uses the runtime-neutral canonical owner. */
const { systemScheduler } = await import('@migaia/utils/scheduler')
import {
  classification,
  classify,
  report,
  nativeProviderLimits
} from '../../bench/classification.mjs'
/** Node and bare Worker memory/CPU snapshots use their original separate control port. */
let snapshotPort
/** Bun's native Web Worker exposes its real isolate snapshot outside the measured request window. */
let snapshotPeer
/** Each native child has an ordered out-of-band snapshot file sequence. */
let snapshotSequence = 0
/**
 * Read one peer boundary through its existing OOB control, optionally retaining a profile heap.
 *
 * @param {number} peerPid Actual child PID, or the Worker process PID.
 * @param {{
 *   heapSnapshot?: 'start' | 'end'
 *   diagnostic?: 'start' | 'stop'
 *   mode?: 'cpu' | 'guard' | 'sampling'
 * }} [options]
 *   Profile boundary, outside business exchanges.
 * @returns {Promise<object>} Actual peer isolate snapshot and any native heap file path.
 */
async function peerSnapshot(peerPid, options = {}) {
  /** Serialized native capture failures keep their full original classification on the cause. */
  const read = (value) => {
    if (value?.diagnostic?.status === IpcBenchDiagnostic.failed)
      throw new Error(IpcBenchErrorText.diagnosticPeer, { cause: value.diagnostic.error })
    return value
  }
  if (snapshotPeer) return snapshotPeer()
  if (snapshotPort)
    return new Promise((resolve, reject) => {
      /** One request consumes one existing OOB reply; capture errors reject rather than hang. */
      const receive = (value) => {
        try {
          resolve(read(value))
        } catch (error) {
          reject(error)
        }
      }
      snapshotPort.once('message', receive)
      snapshotPort.postMessage(options.heapSnapshot || options.diagnostic ? options : 'snapshot')
    })
  const path = process.env.IPC_BENCH_STEM + '.peer.snapshot-' + snapshotSequence++ + '.json'
  if (
    process.env[IpcBenchObservation.heapProfileEnvironment] === '1' ||
    process.env[IpcBenchDiagnostic.environment]
  )
    writeFileSync(
      process.env.IPC_BENCH_STEM + '.peer.snapshot-request.json',
      JSON.stringify(options)
    )
  process.kill(peerPid, 'SIGUSR2')
  while (!existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 1))
  return read(JSON.parse(readFileSync(path, 'utf8')))
}

/** One entry serves both sides so runtime/carrier/payload stay identical across paired windows. */
const entry = fileURLToPath(import.meta.url)
/** Readiness stays out-of-band and outside measurement windows. */
const readyText = 'IPC_READY\n'
/** Native proposal uses production grammar and JSON codec. */
let offer
/** Load the delivered public Peer graph only on RPC sides; bare RSS must not include it. */
async function rpcApi() {
  const { createProcessTransport } =
    await import('../../../rpc-plugin-process/dist/process/handshake.js')
  const { createNativeProcessOffer } =
    await import('../../../rpc-plugin-process/dist/process/offer.js')
  const { createRuntimePeer, prepareRuntimePeerSourceContext } =
    await import('../../../rpc-host/dist/remote/runtime-api/peer.js')
  const { PluginHost } = await import('@migaia/plugin-host')
  const { threadPlugin } = await import('@migaia/rpc-plugin-thread')
  const { readRuntimeOutletConnection } =
    await import('../../../rpc-host/dist/remote/runtime-api/outlet.js')
  const {
    createAdapterWebThreadLauncher: createWebThreadLauncher,
    createAdapterWebThreadChannelFactory: createWebThreadChannelFactory
  } = await import('../../../rpc-plugin-thread/dist/threads/web-launcher.js')
  const threadAdapters = await import('../../../rpc-plugin-thread/dist/threads/adapters/node.js')
  /** Capability declarations come from the actual factory source context, never a fixture guess. */
  offer = (id, capabilities) => ({
    ...createNativeProcessOffer({
      peer: { id, runtime: deno ? 'deno' : process.versions.bun ? 'bun' : 'node' }
    }),
    capabilities
  })
  return {
    createProcessTransport,
    createNativeProcessOffer,
    createRuntimePeer,
    prepareRuntimePeerSourceContext,
    PluginHost,
    threadPlugin,
    readRuntimeOutletConnection,
    createWebThreadLauncher,
    createWebThreadChannelFactory,
    ...threadAdapters
  }
}
/** Load only public native Worker factories; deleted Peer/profile modules stay out of this arm. */
async function workerApi() {
  const { createRpcHost } = await import('@migaia/rpc-host')
  const { threadPlugin } = await import('@migaia/rpc-plugin-thread')
  const { limits } = await import('@migaia/rpc-host/plugins/limits')
  const adapters = await import('../../../rpc-plugin-thread/dist/threads/node-launcher.js')
  return { createRpcHost, threadPlugin, limits, ...adapters }
}
/** Fixed benchmark method has no side effect besides returning its portable input. */
const echoMethod = RuntimeBench.echo
/** Both public provider factories compile the same nested tree into the original echo wire name. */
const echoProvide = { bench: { echo: (payload) => payload } }

/**
 * Wait for a separately started peer, retaining startup failures as preparation errors.
 *
 * @param {import('node:child_process').ChildProcess} child Peer process.
 * @returns {Promise<void>} Ready marker consumed.
 * @throws {Error} Exit or launch failure before readiness.
 */
function waitReady(child) {
  return new Promise((resolve, reject) => {
    /** Readiness may span stderr chunks; status contains no business data. */
    let status = ''
    child.stderr.on('data', (chunk) => {
      status += chunk.toString()
      if (status.includes(readyText)) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`IPC peer exited before ready: ${code}`)))
  })
}

/**
 * Serve bare socket/stdio frames with one JSON parse and serialization per payload.
 *
 * @param {import('@migaia/rpc-plugin-process').IProcessByteChannel} raw Owned physical channel.
 * @returns {Promise<void>} Resolves at physical close.
 */
class BareFrameReceiver {
  /** Native byte owner remains the only physical sender and close authority. */
  #raw
  /** Fixed four-byte prefix is filled incrementally without repeatedly copying old input. */
  #prefix = Buffer.alloc(4)
  /** Number of prefix bytes already received for the current frame. */
  #prefixBytes = 0
  /** One allocated business payload; no endpoint or protocol owner is loaded by the bare arm. */
  #body
  /** Number of payload bytes filled by incoming fragments. */
  #bodyBytes = 0
  /** Original FIFO write chain preserves physical backpressure and final teardown order. */
  #writing = Promise.resolve()
  /** @param {object} raw Original byte channel. */
  constructor(raw) {
    this.#raw = raw
  }
  /** @param {Uint8Array} chunk Original native fragment. @returns {void} */
  receive(chunk) {
    let cursor = 0
    while (cursor < chunk.length) {
      if (!this.#body) {
        const length = Math.min(4 - this.#prefixBytes, chunk.length - cursor)
        this.#prefix.set(chunk.subarray(cursor, cursor + length), this.#prefixBytes)
        this.#prefixBytes += length
        cursor += length
        if (this.#prefixBytes !== 4) continue
        const size = this.#prefix.readUInt32BE(0)
        if (!size || size > 16_777_216) throw new RangeError(IpcBenchErrorText.bareFrame)
        this.#body = Buffer.alloc(size)
      }
      const length = Math.min(this.#body.length - this.#bodyBytes, chunk.length - cursor)
      this.#body.set(chunk.subarray(cursor, cursor + length), this.#bodyBytes)
      this.#bodyBytes += length
      cursor += length
      if (this.#bodyBytes !== this.#body.length) continue
      const body = Buffer.from(JSON.stringify(JSON.parse(this.#body.toString())))
      const frame = Buffer.alloc(body.length + 4)
      frame.writeUInt32BE(body.length)
      frame.set(body, 4)
      this.#writing = this.#writing.then(() => this.#raw.write(frame))
      this.#body = undefined
      this.#bodyBytes = 0
      this.#prefixBytes = 0
    }
  }
  /** @returns {Promise<void>} Join every reply issued before native close. */
  settled() {
    return this.#writing
  }
}
/**
 * Serve bare frames with exactly one business parse/serialization and linear byte copying.
 *
 * @param {object} raw Original physical byte channel.
 * @returns {Promise<void>} Settles after native close and the original write chain.
 */
async function serveBare(raw) {
  const receiver = new BareFrameReceiver(raw)
  const release = raw.onData((chunk) => receiver.receive(chunk))
  await new Promise((resolve) => raw.onClose(resolve))
  release()
  await receiver.settled()
}

/**
 * Build the public process Peer on the original physical source and provide an exact echo.
 *
 * @param {import('@migaia/rpc-host/plugin').IRuntimePeerSource} source Original channel negotiation
 *   receives the actual factory identity and installed capability offer.
 * @returns {Promise<import('@migaia/rpc-host/plugin').IRuntimePeer>} Real public Peer.
 */
async function serveRpc(source) {
  const api = await rpcApi()
  /** The actual raw source receives the original Core identity/capability context. */
  const self = { name: 'peer', instanceId: 'peer' }
  const channel = await source(api.prepareRuntimePeerSourceContext(self))
  return api.createRuntimePeer(
    {
      probe: globalThis.__PROBE_BENCH_PROBE,
      self,
      provide: echoProvide,
      providerLimits: nativeProviderLimits,
      report
    },
    { channel }
  )
}

/**
 * Retain a genuine native Host install receipt while returning its actual selected Peer.
 *
 * @param {IIpcState} state Existing physical fixture owns native cleanup.
 * @param {import('@migaia/rpc-host/sdk').IRpcTransportPlugin} definition Genuine cold transport.
 * @returns {Promise<import('@migaia/rpc-host').IRpcNamespace>} Original installed namespace.
 * @throws {unknown} Original Host admission, native source or startup failure.
 */
async function retainBenchThread(state, definition) {
  const host = await state.api.createRpcHost({
    self: { name: 'parent', instanceId: 'parent' },
    plugins: [state.api.limits({ onRejected: nativeProviderLimits.onRejected }), definition],
    report
  })
  state.host = host
  state.cleanup.push(() => host.close())
  return host.thread
}

/** Bare replies own only correlation accounting, with no RPC graph loaded by the bare arm. */
class EchoReplies {
  /** Pending resolvers are deleted on settlement, so long runs retain only in-flight calls. */
  #pending = new Map()
  /** Monotonic issuance order replaces an array shift for each received reply. */
  #issued = 0
  /** Next expected physical reply preserves the original FIFO mismatch behavior. */
  #received = 0
  /**
   * @param {(resolve: () => void, reject: (error: unknown) => void) => void} send Send one request.
   * @returns {Promise<void>} Its next FIFO reply.
   */
  exchange(send) {
    return new Promise((resolve, reject) => {
      this.#pending.set(this.#issued++, { resolve, reject })
      send(resolve, reject)
    })
  }
  /** @param {unknown} [error] Mismatch for this reply. @returns {void} */
  settle(error) {
    const waiter = this.#pending.get(this.#received)
    this.#pending.delete(this.#received++)
    if (error) waiter?.reject(error)
    else waiter?.resolve()
  }
  /** @param {unknown} error Original close failure. @returns {void} */
  rejectAll(error) {
    for (const waiter of this.#pending.values()) waiter.reject(error)
    this.#pending.clear()
    this.#received = this.#issued
  }
}

/** Fixed-size bare replies compare every byte, copying each fragmented byte only once. */
class BareByteEcho {
  /** Original physical byte owner; no endpoint/codec graph is introduced on the bare arm. */
  #raw
  /** Expected physical frame includes the original framing header and JSON bytes. */
  #frame
  /** One frame-sized scratch buffer replaces cumulative concatenation of partial chunks. */
  #buffer
  /** Filled prefix of the current physical reply. */
  #offset = 0
  /** First mismatch/close remains sticky for all later exchanges, matching the old baseline. */
  #failure
  /** FIFO call accounting is shared by native byte and message baselines. */
  #replies = new EchoReplies()
  /** Native subscriptions remain owned until the session's existing cleanup step. */
  #remove
  /** Close subscription is removed beside the data subscription. */
  #removeClose
  /** Existing baseline diagnostics differ for native and foreign byte peers. */
  #errors
  /**
   * @param {object} raw Native byte owner. @param {Buffer} frame Expected echo. @param {{ mismatch:
   *   string; closed: string; preserveCloseReason?: boolean }} errors Existing diagnostics.
   */
  constructor(raw, frame, errors) {
    this.#raw = raw
    this.#frame = frame
    this.#buffer = Buffer.alloc(frame.length)
    this.#errors = errors
    this.#remove = raw.onData((chunk) => this.#receive(chunk))
    this.#removeClose = raw.onClose((reason) => {
      this.#failure = (errors.preserveCloseReason && reason) || new Error(errors.closed)
      this.#replies.rejectAll(this.#failure)
    })
  }
  /** @param {Uint8Array} chunk Original native fragment. @returns {void} */
  #receive(chunk) {
    let cursor = 0
    while (cursor < chunk.length) {
      const length = Math.min(chunk.length - cursor, this.#frame.length - this.#offset)
      this.#buffer.set(chunk.subarray(cursor, cursor + length), this.#offset)
      this.#offset += length
      cursor += length
      if (this.#offset !== this.#frame.length) continue
      if (!this.#buffer.equals(this.#frame)) this.#failure = new Error(this.#errors.mismatch)
      this.#replies.settle(this.#failure)
      this.#offset = 0
    }
  }
  /** @returns {Promise<void>} Exact byte echo, or the retained original failure. */
  exchange = () => {
    if (this.#failure) return Promise.reject(this.#failure)
    return this.#replies.exchange((_resolve, reject) => this.#raw.write(this.#frame).catch(reject))
  }
  /** @returns {void} Detach listeners; the containing session still owns physical close order. */
  detach() {
    this.#remove()
    this.#removeClose()
  }
}

/** @typedef {ReturnType<typeof ipcState>} IIpcState */
/**
 * Keep one explicit preparation context for the original native resource graph.
 *
 * @param {{ carrier: string; side: string; payload: string }} input Frozen paired arm.
 * @returns {object} Mutable state passed explicitly between native acquisition stages.
 */
function ipcState(input) {
  /** Only stdio needs the original out-of-band peer-ready promise. */
  let resolvePeerReady
  const peerReady = new Promise((resolve) => {
    resolvePeerReady = resolve
  })
  return {
    ...input,
    /** Cleanup is registered before the next fallible native step. */
    cleanup: [],
    /** Byte carrier ownership is absent for Worker sessions. */
    raw: undefined,
    /** Actual native handle PID; Worker sessions retain the parent process PID. */
    peerPid: undefined,
    /** Original public Peer owns RPC business dispatch and shutdown. */
    runtime: undefined,
    /** Public Worker construction retains the original Host cleanup owner. */
    host: undefined,
    /** Bare preparation never loads this RPC API. */
    api: undefined,
    /** Both paired sides measure exactly the same JSON business encoding. */
    encoded: Buffer.from(JSON.stringify(input.payload)),
    /** Launcher stderr alone resolves readiness before timing begins. */
    peerReady,
    resolvePeerReady,
    /** Stderr ready marker may span chunks. */
    status: ''
  }
}

/** @param {IIpcState} state Native Web Worker RPC context. @returns {Promise<void>} */
async function prepareWebRpcWorker(state) {
  /** Bun enters through the same ordinary public source shorthand as application Workers. */
  let spawn = { entry: new URL(import.meta.url), name: 'peer' }
  if (deno) {
    /** This existing Deno entry publishes only a cold-module readiness event before adoption. */
    const entry = new URL('../../bench/deno-worker.mjs', import.meta.url)
    const worker = new globalThis.Worker(entry.href, { type: 'module', name: 'peer' })
    /** Native launcher adoption transfers termination to the original managed source owner. */
    let adopted = false
    /** Cold preparation owns termination until the canonical launcher adopts this Worker. */
    state.cleanup.push(() => {
      if (!adopted) worker.terminate()
    })
    /** Reuse the existing one-shot utility without nesting a second preparation callback owner. */
    const { deferred } = await import('@migaia/utils/promise')
    /** This receipt belongs only to the already-existing cold module readiness event. */
    const ready = deferred()
    /** Ordinary business events cannot settle the separate cold construction boundary. */
    const onReady = (event) => {
      if (event.data === IpcBenchControl.ready) ready.resolve()
    }
    /** Preserve the native Worker error before the canonical launcher has adopted this resource. */
    const onError = (event) => ready.reject(event.error ?? event)
    worker.addEventListener('message', onReady)
    worker.addEventListener('error', onError)
    try {
      await ready.promise
    } finally {
      worker.removeEventListener('message', onReady)
      worker.removeEventListener('error', onError)
    }
    /** The canonical Web launcher still supplies original launch facts and carrier custody. */
    const { createWebThreadLauncher } =
      await import('../../../rpc-plugin-thread/dist/threads/web-launcher.js')
    spawn = {
      entry,
      name: 'peer',
      launcher: createWebThreadLauncher({
        report,
        Worker: class {
          /** Lend the prepared native object to the canonical launcher's generation ownership. */
          constructor() {
            adopted = true
            return worker
          }
        }
      }),
      report
    }
  }
  state.runtime = await retainBenchThread(
    state,
    state.api.threadPlugin({ name: 'peer', spawn, report })
  )
  /** Snapshot business remains separate from the measured echo request. */
  snapshotPeer = () => state.runtime.request(IpcBenchControl.snapshot)
  state.peerPid = process.pid
}
/** @param {IIpcState} state Bare Deno Worker context. @returns {Promise<object>} */
async function prepareDenoBareWorker(state) {
  /** Bare native Web Worker keeps the same JSON business echo, with separate control port. */
  const workerEntry = new URL(import.meta.url)
  workerEntry.searchParams.set('bare', '1')
  const worker = new globalThis.Worker(workerEntry.href, { type: 'module' })
  const controls = new globalThis.MessageChannel()
  /** All native replies retain FIFO accounting; no Node Worker compatibility events are used. */
  const waiting = new EchoReplies()
  const ready = new Promise((resolve, reject) => {
    worker.onerror = (event) => reject(event.error ?? event)
    worker.onmessage = (event) => {
      if (event.data === readyText) resolve()
      else {
        waiting.settle(event.data === state.payload ? undefined : new Error(IpcBenchErrorText.echo))
      }
    }
  })
  state.cleanup.push(() => {
    controls.port1.close()
    worker.terminate()
  })
  await ready
  worker.postMessage({ kind: IpcBenchControl.observation, port: controls.port2 }, [controls.port2])
  /** Snapshot control never travels through the measured echo port or request path. */
  snapshotPeer = () =>
    new Promise((resolve) => {
      controls.port1.onmessage = (event) => resolve(event.data)
      controls.port1.postMessage('snapshot')
    })
  state.peerPid = process.pid
  return {
    peerPid: state.peerPid,
    peerSnapshot: () => peerSnapshot(state.peerPid),
    classification: () => classification,
    ready: async () => undefined,
    exchange: () => waiting.exchange(() => worker.postMessage(state.payload)),
    close: async () => {
      for (const close of state.cleanup.reverse()) await close()
    }
  }
}
/**
 * @param {IIpcState} state Original Node RPC context. @param {MessageChannel} controls OOB snapshot
 *   port pair. @returns {Promise<void>}
 */
async function prepareNodeRpcWorker(state, controls) {
  /** The actual library launcher supplies the bootstrap accepted by the automatic child. */
  const launcher = state.api.createNodeThreadLauncher()
  /** Owned Worker execution retains the original supervision lease and close owner. */
  const { createUnitBudget } = await import('@migaia/supervision')
  state.runtime = await retainBenchThread(
    state,
    state.api.threadPlugin({
      name: 'peer',
      report,
      spawn: {
        spec: {
          entry,
          name: 'peer',
          data: {
            side: state.side,
            carrier: state.carrier,
            child: true,
            ...(process.env.IPC_BENCH_STEM ? { benchStem: process.env.IPC_BENCH_STEM } : {}),
            observation: true
          }
        },
        launcher: {
          ...launcher,
          async launch(spec, context) {
            /** Preserve the original private launch context and real native handle. */
            const handle = await launcher.launch(spec, context)
            /** Observation setup completes before the channel factory consumes the child ACK. */
            const observed = new Promise((resolve, reject) => {
              controls.port1.once('message', (message) =>
                message === IpcBenchControl.ready
                  ? resolve()
                  : reject(new Error(IpcBenchErrorText.workerObservation))
              )
            })
            try {
              handle.port.postMessage({ kind: IpcBenchControl.observation, port: controls.port2 }, [
                controls.port2
              ])
              await Promise.race([
                observed,
                handle.exited.then(() => {
                  throw new Error(IpcBenchErrorText.workerObservationExit)
                })
              ])
            } catch (primary) {
              handle.terminate()
              await handle.exited
              throw primary
            }
            return handle
          }
        },
        budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
        scheduler: systemScheduler,
        channelFactory: state.api.createNodeThreadChannelFactory({ scheduler: systemScheduler }),
        report
      }
    })
  )
  state.peerPid = process.pid
}
/**
 * @param {IIpcState} state Bare Node Worker context. @param {MessageChannel} controls OOB snapshot
 *   port pair. @returns {Promise<object>}
 */
async function prepareNodeBareWorker(state, controls) {
  const worker = new Worker(entry, {
    workerData: {
      side: state.side,
      carrier: state.carrier,
      child: true,
      benchPort: controls.port2,
      benchStem: process.env.IPC_BENCH_STEM
    },
    transferList: [controls.port2]
  })
  const exited = once(worker, 'exit')
  state.cleanup.push(async () => {
    await worker.terminate()
    await exited
  })
  await new Promise((resolve, reject) => {
    worker.once('message', (value) =>
      value === readyText ? resolve() : reject(new Error('Worker readiness invalid'))
    )
    worker.once('error', reject)
  })
  state.peerPid = process.pid
  /** Bare replies settle one FIFO waiter per physical message, including concurrent lanes. */
  const waiting = new EchoReplies()
  worker.on('message', (value) => {
    waiting.settle(value === state.payload ? undefined : new Error('Bare worker mismatch'))
  })
  return {
    peerPid: state.peerPid,
    peerSnapshot: (options) => peerSnapshot(state.peerPid, options),
    classification: () => classification,
    ready: async () => undefined,
    exchange: () => waiting.exchange(() => worker.postMessage(state.payload, undefined)),
    close: async () => {
      for (const close of state.cleanup.reverse()) await close()
    }
  }
}
/** @param {IIpcState} state Selected original Worker mode. @returns {Promise<object | undefined>} */
async function prepareWorker(state) {
  if (state.side === 'rpc' && (process.versions.bun || deno)) {
    await prepareWebRpcWorker(state)
    return
  }
  if (deno) return prepareDenoBareWorker(state)
  const controls = new MessageChannel()
  snapshotPort = controls.port1
  state.cleanup.push(() => controls.port1.close())
  if (state.side === 'bare') return prepareNodeBareWorker(state, controls)
  await prepareNodeRpcWorker(state, controls)
}
/** @param {IIpcState} state Native stdio acquisition. @returns {Promise<void>} */
async function prepareStdio(state) {
  const handle = await (
    deno ? denoProcess.createDenoProcessLauncher() : createNodeProcessLauncher()
  ).launch(
    {
      command: deno ? Deno.execPath() : process.execPath,
      args: [
        ...(deno ? ['run', '-A'] : []),
        ...(!deno &&
        !process.versions.bun &&
        process.env[IpcBenchObservation.forcePeerGcEnvironment] === '1'
          ? ['--expose-gc']
          : []),
        // Node's stdio peer rebuilds argv, so native CPU flags must be forwarded explicitly.
        ...(!deno && !process.versions.bun
          ? process.execArgv.filter(
              (argument) =>
                argument === IpcBenchDiagnostic.cpuFlag ||
                argument.startsWith(IpcBenchDiagnostic.cpuDirectoryPrefix) ||
                argument.startsWith(IpcBenchDiagnostic.cpuIntervalPrefix)
            )
          : []),
        entry,
        '--child',
        state.side,
        state.carrier
      ],
      env: {
        inherit: ['PATH'],
        set: {
          IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.peer',
          ...(process.env[IpcBenchObservation.forcePeerGcEnvironment] === '1'
            ? { [IpcBenchObservation.forcePeerGcEnvironment]: '1' }
            : {}),
          ...(process.env[IpcBenchObservation.heapProfileEnvironment] === '1'
            ? { [IpcBenchObservation.heapProfileEnvironment]: '1' }
            : {}),
          ...(process.env[IpcBenchDiagnostic.environment]
            ? { [IpcBenchDiagnostic.environment]: process.env[IpcBenchDiagnostic.environment] }
            : {})
        }
      },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
    },
    {
      signal: new AbortController().signal,
      output: (stream, chunk) => {
        if (stream !== 'stderr') return
        /** Child startup failures remain attached to the real side's retained stderr receipt. */
        const text = Buffer.from(chunk).toString().replaceAll('bench-local', '[REDACTED_AUTH]')
        process.stderr.write(text)
        state.status += text
        if (state.status.includes(readyText)) state.resolvePeerReady()
      }
    }
  )
  state.peerPid = handle.identity.pid
  state.raw = handle.channel
  state.cleanup.push(async () => {
    await handle.terminate('force')
    await handle.exited
  })
}
/** @param {IIpcState} state Native socket acquisition. @returns {Promise<void>} */
async function prepareSocket(state) {
  const directory = await mkdtemp(join(tmpdir(), 'rpc-bench-'))
  state.cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const address = join(directory, 'peer.sock')
  const child = spawn(process.execPath, [entry, '--child', state.side, state.carrier, address], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.peer' }
  })
  const exited = once(child, 'close')
  state.cleanup.push(async () => {
    child.kill()
    await exited
  })
  await waitReady(child)
  state.peerPid = child.pid
  state.raw = await dialProcessByteChannel({ address })
}

/**
 * @param {IIpcState} state Original source graph. @param {string} text Cleanup aggregate
 *   diagnostic. @returns {Promise<void>}
 */
async function closeCollected(state, text) {
  const failures = []
  for (const close of state.cleanup.reverse()) {
    try {
      await close()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, text)
}
/**
 * @param {IIpcState} state Bare source graph. @returns {Promise<void>} First cleanup failure,
 *   matching the bare baseline.
 */
async function closeBare(state) {
  for (const close of state.cleanup.reverse()) await close()
}
/** @param {IIpcState} state Original Peer context. @returns {Promise<object>} Ready RPC result. */
async function rpcResult(state) {
  if (!state.host) state.cleanup.push(() => state.runtime.close())
  await state.runtime.request(echoMethod, state.payload)
  return {
    facade: state.runtime,
    peerPid: state.peerPid,
    peerSnapshot: (options) => peerSnapshot(state.peerPid, options),
    classification: () => classification,
    encodedBytes: state.encoded.length,
    ready: async () => undefined,
    exchange: async () => {
      try {
        if ((await state.runtime.request(echoMethod, state.payload)) !== state.payload)
          throw new Error(IpcBenchErrorText.echo)
      } catch (error) {
        classification.failures.push(classify(error))
        throw error
      }
    },
    close: () => closeCollected(state, IpcBenchErrorText.cleanup)
  }
}
/**
 * @param {IIpcState} state Original bare byte context. @returns {object} Ready physical byte
 *   result.
 */
function bareByteResult(state) {
  const frame = Buffer.alloc(state.encoded.length + 4)
  frame.writeUInt32BE(state.encoded.length)
  frame.set(state.encoded, 4)
  const echo = new BareByteEcho(state.raw, frame, {
    mismatch: 'Bare echo mismatch',
    closed: 'Bare peer closed'
  })
  state.cleanup.push(async () => {
    echo.detach()
    await state.raw.close()
  })
  return {
    peerPid: state.peerPid,
    peerSnapshot: (options) => peerSnapshot(state.peerPid, options),
    classification: () => classification,
    encodedBytes: state.encoded.length,
    ready: async () => {
      if (state.carrier === 'stdio-framed') await state.peerReady
    },
    exchange: echo.exchange,
    close: () => closeBare(state)
  }
}

/**
 * Create an isolated RPC or bare side without starting a measured window.
 *
 * @param {{
 *   carrier: string
 *   side: string
 *   payload: string
 *   wire?: string
 *   peerRuntime?: string
 *   topology?: string
 *   direction?: string
 * }} input
 *   Frozen unit and side.
 * @returns {Promise<object>} Original native resources, exchange, readiness and close ports.
 * @throws {Error} Original preparation failure, retaining cleanup failures in order.
 */
export async function createIpcSession(input) {
  const { carrier, side, payload, wire, peerRuntime, topology, direction } = input
  if (topology || direction === RuntimeBench.reverse) {
    const { createRuntimeSession } = await import('./runtime-session.mjs')
    return createRuntimeSession(
      { carrier, side, payload, topology: topology ?? RuntimeBench.reverse },
      { classification, providerLimits: nativeProviderLimits, report }
    )
  }
  if (wire === 'jsonrpc') return createBridgeIpcSession({ carrier, side, payload, peerRuntime })
  const state = ipcState({ carrier, side, payload })
  state.api = side === 'rpc' ? await (carrier === 'worker' ? workerApi() : rpcApi()) : undefined
  try {
    if (carrier === 'worker') {
      const prepared = await prepareWorker(state)
      if (prepared) return prepared
    } else if (carrier === 'stdio-framed') await prepareStdio(state)
    else if (carrier === 'socket-framed') await prepareSocket(state)
    else throw new Error(IpcBenchErrorText.carrier(carrier))
    if (state.raw && side === 'rpc') {
      const self = { name: 'parent', instanceId: 'parent' }
      const context = state.api.prepareRuntimePeerSourceContext(self)
      const channel = await state.api.createProcessTransport(state.raw, {
        role: 'initiator',
        peerId: 'peer',
        offer: { ...offer('parent', context.capabilities), auth: 'bench-local' },
        report,
        ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
      })
      state.runtime = await state.api.createRuntimePeer(
        {
          probe: globalThis.__PROBE_BENCH_PROBE,
          self,
          providerLimits: nativeProviderLimits,
          report
        },
        { channel }
      )
    }
    return state.runtime ? await rpcResult(state) : bareByteResult(state)
  } catch (primary) {
    const failures = [primary]
    for (const close of state.cleanup.reverse()) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
    throw failures.length === 1
      ? primary
      : new AggregateError(failures, IpcBenchErrorText.preparationCleanup)
  }
}

/**
 * Select an actual foreign executable and retain its immutable provenance.
 *
 * @param {{ carrier: string; side: string; payload: string; peerRuntime: string }} input Paired
 *   profile.
 * @returns {object} Explicit native acquisition context.
 */
function bridgeState(input) {
  const { peerRuntime, side } = input
  /** Both sides run this exact executable, argument profile and byte framing. */
  const peerRoot = new URL('../process/peers/', import.meta.url)
  let command, args, id
  if (peerRuntime === 'python') {
    command = 'python3'
    args = ['-B', fileURLToPath(new URL('python/peer.py', peerRoot)), '--business']
    id = 'python-peer'
  } else if (peerRuntime === 'rust' || peerRuntime === 'go') {
    command = execFileSync(
      'sh',
      [fileURLToPath(new URL(`${peerRuntime}/run.sh`, peerRoot)), '--executable'],
      { encoding: 'utf8' }
    ).trim()
    args = ['--business']
    id = `${peerRuntime}-peer`
  } else throw new Error(IpcBenchErrorText.bridgeRuntime)
  /** This is the actual spawned executable, independently hashed from the immutable peer sources. */
  const executable = command.includes('/')
    ? command
    : execFileSync('which', [command], { encoding: 'utf8' }).trim()
  const foreignExecutable = {
    path: executable,
    SHA256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
    sourceRoot: fileURLToPath(new URL(peerRuntime + '/', peerRoot)),
    sourceStatus: 'readonly peer source manifest; binary hash distinct from JS loaded modules'
  }
  args.push('--jsonrpc', '--auth-fd', '3', ...(side === 'bare' ? ['--bare-jsonrpc'] : []))
  /** Dedicated FD bootstrap remains outside the byte stream on both paired sides. */
  const token = randomUUID()
  return {
    ...input,
    command,
    args,
    id,
    foreignExecutable,
    token,
    cleanup: [],
    raw: undefined,
    peerPid: undefined,
    runtime: undefined
  }
}
/** @param {ReturnType<typeof bridgeState>} state Foreign stdio acquisition. @returns {Promise<void>} */
async function prepareBridgeStdio(state) {
  const { loadFdLauncher } = await import('./fd-fixture-loader.mjs')
  const handle = await (
    await loadFdLauncher()
  ).launch(
    {
      command: state.command,
      args: [...state.args, '--stdio'],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'fd', fd: 3, payload: new TextEncoder().encode(state.token) }
    },
    { signal: new AbortController().signal, output: () => undefined }
  )
  state.raw = handle.channel
  state.peerPid = handle.identity.pid
  state.cleanup.push(async () => {
    await handle.terminate('force')
    await handle.exited
  })
}
/**
 * @param {ReturnType<typeof bridgeState>} state Foreign socket acquisition. @returns
 *   {Promise<void>}
 */
async function prepareBridgeSocket(state) {
  const directory = await mkdtemp(join(tmpdir(), 'rpc-bench-bridge-'))
  state.cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const address = join(directory, 'peer.sock'),
    authPath = join(directory, 'auth')
  writeFileSync(authPath, state.token, { mode: 0o600 })
  const fd = openSync(authPath, 'r')
  const child = spawn(state.command, [...state.args, '--listen-unix', address], {
    stdio: ['ignore', 'pipe', 'pipe', fd]
  })
  closeSync(fd)
  const exited = once(child, 'close')
  state.cleanup.push(async () => {
    child.kill()
    await exited
  })
  await new Promise((resolve, reject) => {
    let status = ''
    child.stderr.on('data', (chunk) => {
      status += chunk.toString()
      if (status.includes('READY')) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Bridge peer exited before ready: ${code}`)))
  })
  state.peerPid = child.pid
  state.raw = await dialProcessByteChannel({ address })
}
/**
 * @param {ReturnType<typeof bridgeState>} state Canonical JSON-RPC negotiation. @returns
 *   {Promise<void>}
 */
async function prepareBridgeRuntime(state) {
  const { createProcessJsonRpcChannel } =
    await import('../../../rpc-plugin-process/dist/process/jsonrpc-channel.js')
  const { createRuntimePeer, prepareRuntimePeerSourceContext } =
    await import('../../../rpc-host/dist/remote/runtime-api/peer.js')
  /** Only capabilities with actual mappings in the canonical bridge profile are offered. */
  const { JSONRPC_ALLOWED_CAPABILITIES } = await import('@migaia/rpc-host/plugin')
  /** Contract describes the same request echo already proved by the conformance facade cases. */
  const contract = {
    schemaVersion: 1,
    plugin: 'p',
    features: {
      f: {
        methods: {
          request: { mode: 'request', idempotent: true },
          oneWay: { mode: 'one-way', idempotent: false }
        }
      }
    }
  }
  const self = { name: 'parent', instanceId: 'parent' }
  const context = prepareRuntimePeerSourceContext(self)
  const channel = await createProcessJsonRpcChannel({
    byte: state.raw,
    peerId: state.id,
    target: { kind: 'plugin', contract },
    offer: {
      versions: [{ major: 1, minor: 1 }],
      capabilities: context.capabilities.filter((value) =>
        JSONRPC_ALLOWED_CAPABILITIES.includes(value)
      ),
      peer: { id: 'parent', runtime: process.versions.bun ? 'bun' : 'node' }
    },
    token: state.token,
    scheduler: systemScheduler,
    wallClock: { timestamp: () => Date.now() },
    ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined },
    report
  })
  state.runtime = await createRuntimePeer(
    { self, providerLimits: nativeProviderLimits, report },
    { channel }
  )
  state.cleanup.push(() => state.runtime.close())
}
/**
 * @param {ReturnType<typeof bridgeState>} state Original physical and RPC owners. @returns {object}
 *   Exact paired exchange and cleanup ports.
 */
function bridgeResult(state) {
  const body = Buffer.from(JSON.stringify(state.payload))
  const frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
  const echo =
    state.side === 'bare'
      ? new BareByteEcho(state.raw, frame, {
          mismatch: 'Bare bridge echo mismatch',
          closed: 'Bare bridge peer closed',
          preserveCloseReason: true
        })
      : undefined
  if (echo) state.cleanup.push(async () => echo.detach())
  const exchange = echo
    ? echo.exchange
    : async () => {
        try {
          if ((await state.runtime.request('p.f.request', [state.payload])) !== state.payload)
            throw new Error(IpcBenchErrorText.bridgeEcho)
        } catch (error) {
          classification.failures.push(classify(error))
          throw error
        }
      }
  return {
    ...(state.runtime ? { facade: state.runtime } : {}),
    peerPid: state.peerPid,
    encodedBytes: body.length,
    ready: exchange,
    exchange,
    close: () => closeCollected(state, IpcBenchErrorText.bridgeCleanup),
    peerSnapshot: async () => ({
      pid: state.peerPid,
      threadId: null,
      memory: null,
      loaded: [],
      reason: 'foreign runtime JS isolate fields not applicable',
      gcStatus: 'NOT_COLLECTED'
    }),
    classification: () => classification,
    foreignExecutable: state.foreignExecutable
  }
}
/**
 * Prepare one independent language peer with unchanged paired physical framing.
 *
 * @param {{ carrier: string; side: string; payload: string; peerRuntime: string }} input Frozen
 *   profile.
 * @returns {Promise<object>} Original physical/RPC echo session and executable provenance.
 * @throws {Error} Original preparation failure with ordered cleanup errors.
 */
async function createBridgeIpcSession(input) {
  const state = bridgeState(input)
  try {
    if (input.carrier === 'stdio-content-length') await prepareBridgeStdio(state)
    else if (input.carrier === 'socket-content-length') await prepareBridgeSocket(state)
    else throw new Error(IpcBenchErrorText.bridgeCarrier)
    state.cleanup.push(() => state.raw.close())
    if (input.side === 'rpc') await prepareBridgeRuntime(state)
    return bridgeResult(state)
  } catch (primary) {
    const failures = [primary]
    for (const close of state.cleanup.reverse()) {
      try {
        await close()
      } catch (error) {
        failures.push(error)
      }
    }
    throw failures.length === 1
      ? primary
      : new AggregateError(failures, IpcBenchErrorText.bridgePreparation)
  }
}

/** Child entry installs the public protocol or a physical echo before signalling readiness. */
async function childMain(side, carrier, address) {
  const api = side === 'rpc' ? await (carrier === 'worker' ? workerApi() : rpcApi()) : undefined
  if (carrier === 'worker') {
    if (side === 'bare' && deno) {
      /** Only the cold control message carries a port; business echo retains one parse/stringify. */
      globalThis.onmessage = (event) => {
        if (event.data?.kind === IpcBenchControl.observation) {
          event.data.port.onmessage = () => event.data.port.postMessage(snapshot())
        } else globalThis.postMessage(JSON.parse(JSON.stringify(event.data)))
      }
      globalThis.postMessage(readyText)
      return
    }
    if (side === 'bare')
      parentPort.on('message', (value) =>
        parentPort.postMessage(JSON.parse(JSON.stringify(value)), undefined)
      )
    else {
      await api.createRpcHost({
        plugins: [
          api.limits({ onRejected: nativeProviderLimits.onRejected }),
          api.threadPlugin({ name: 'parent', connectToParent: true })
        ],
        provide:
          process.versions.bun || deno
            ? { bench: { ...echoProvide.bench, snapshot } }
            : echoProvide,
        report
      })
    }
    if (side === 'bare') parentPort.postMessage(readyText, undefined)
    return
  }
  if (carrier === 'socket-framed') {
    /** Bare listener borrows native socket only; RPC listener authenticates through public adapter. */
    if (side === 'bare') {
      const { createServer } = await import('node:net')
      const { nodeByteStream } =
        await import('../../../rpc-plugin-process/dist/process/node-byte-stream.js')
      const server = createServer((socket) => {
        void serveBare(nodeByteStream(socket, socket, () => socket.destroy())).catch((error) => {
          process.stderr.write(String(error))
          socket.destroy(error)
        })
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, resolve)
      })
    } else
      await listenProcessByteChannel({
        address,
        serviceId: 'rpc-bench',
        auth: {
          mode: 'required',
          verify: (token) => {
            if (token !== 'bench-local') throw new Error(IpcBenchErrorText.authentication)
            return 'bench'
          }
        },
        report,
        onConnection: async (pending) => {
          await serveRpc(async (context) => {
            const admitted = await pending.accept({
              peerId: 'parent',
              offer: offer('peer', context.capabilities),
              report,
              ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
            })
            return admitted.channel
          })
        }
      })
    process.stderr.write(readyText)
    return
  }
  const { channel: raw } = await (
    deno ? denoProcess.openProcessStdioChannel : openProcessStdioChannel
  )({
    bootstrap: 'none'
  })
  if (side === 'bare') {
    process.stderr.write(readyText)
    await serveBare(raw)
  } else {
    await serveRpc((context) =>
      api.createProcessTransport(raw, {
        role: 'responder',
        peerId: 'parent',
        offer: offer('peer', context.capabilities),
        auth: { mode: 'none' },
        report,
        ipc: { connectionId: 'bench', sessionId: 'bench', log: () => undefined }
      })
    )
    process.stderr.write(readyText)
  }
}

if (parentPort && !deno) {
  const { workerData } = await import('node:worker_threads')
  await waitForObservation()
  /** The canonical launcher retains portable spec data under its original bootstrap data field. */
  const input = workerData?.data ?? workerData
  if (input?.topology) {
    const { serveRuntimeWorker } = await import('./runtime-session.mjs')
    await serveRuntimeWorker(input, {
      classification,
      providerLimits: nativeProviderLimits,
      report
    })
  } else if (input?.child) await childMain(input.side, input.carrier)
  else if (process.versions.bun && Bun.isMainThread === false) await childMain('rpc', 'worker')
} else if (deno && typeof globalThis.postMessage === 'function') {
  await childMain(new URL(import.meta.url).searchParams.has('bare') ? 'bare' : 'rpc', 'worker')
} else if (process.versions.bun && Bun.isMainThread === false) {
  await childMain('rpc', 'worker')
} else if (process.argv.includes('--runtime-child')) {
  const { serveRuntimeWorker } = await import('./runtime-session.mjs')
  await serveRuntimeWorker(
    { topology: 'relay' },
    {
      classification,
      providerLimits: nativeProviderLimits,
      report
    }
  )
} else if (process.argv.includes('--child')) {
  await childMain(...process.argv.slice(process.argv.indexOf('--child') + 1))
}
