import { IpcBenchErrorText } from '../../bench/error-text.mjs'
import { captureSnapshot } from '../../bench/observe.mjs'
import { IpcBenchDiagnostic, IpcBenchObservation, RuntimeBench } from '../../bench/text.mjs'
import {
  classification,
  classify,
  report,
  nativeProviderLimits
} from '../../bench/classification.mjs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, createServer } from 'node:net'
import { parentPort, Worker, workerData, MessageChannel } from 'node:worker_threads'

/** One entry supplies actual peer processes and Workers, without loading RPC on bare arms. */
const entry = fileURLToPath(import.meta.url)
/** Cold readiness is separate from physical business data. */
const readyText = 'IPC_READY\n'

/** Bare byte I/O borrows only native streams; it implements no RPC negotiation or call state. */
class BareByteIO {
  /** The original native readable supplies arbitrary byte fragments. */
  #reader
  /** The original native writable retains backpressure and error identity. */
  #writer
  /** Resource cleanup belongs to the native socket or child owner. */
  #close
  /**
   * @param {object} reader Native readable. @param {object} writer Native writable. @param {() =>
   *   void} close Native release.
   */
  constructor(reader, writer, close) {
    this.#reader = reader
    this.#writer = writer
    this.#close = close
  }
  /**
   * @param {(chunk: Uint8Array) => void} receive Bare framing callback. @returns {() => void}
   *   Listener disposal.
   */
  onData(receive) {
    this.#reader.on('data', receive)
    return () => this.#reader.off('data', receive)
  }
  /**
   * @param {(reason?: unknown) => void} receive Native terminal callback. @returns {() => void}
   *   Listener disposal.
   */
  onClose(receive) {
    this.#reader.once('end', receive)
    this.#reader.once('error', receive)
    return () => {
      this.#reader.off('end', receive)
      this.#reader.off('error', receive)
    }
  }
  /**
   * @param {Uint8Array} bytes Complete bare frame. @returns {Promise<void>} Physical write
   *   completion.
   */
  write(bytes) {
    return new Promise((resolve, reject) =>
      this.#writer.write(bytes, (error) => (error ? reject(error) : resolve()))
    )
  }
  /** @returns {Promise<void>} The enclosing owner joins the actual resource exit. */
  async close() {
    this.#close()
  }
}

/** Wait for the original child stderr readiness; startup failures preserve stderr and native exit. */
function waitReady(child) {
  return new Promise((resolve, reject) => {
    /** Readiness is bounded to one stable short marker, avoiding cumulative log copying. */
    let tail = ''
    /** Retain the original startup event handlers only until readiness settles. */
    const release = () => {
      child.stderr.off('data', receive)
      child.off('error', failed)
      child.off('exit', exited)
    }
    /** Native diagnostics remain visible to the outer side's retained stderr. */
    const receive = (bytes) => {
      const text = bytes.toString()
      process.stderr.write(text)
      tail = (tail + text).slice(-readyText.length)
      if (tail.includes(readyText)) {
        release()
        resolve()
      }
    }
    const failed = (error) => {
      release()
      reject(error)
    }
    const exited = (code) => failed(new Error(IpcBenchErrorText.sideFailed(code, tail)))
    child.stderr.on('data', receive)
    child.once('error', failed)
    child.once('exit', exited)
  })
}

/** Retain only selected nonsecret observation settings in genuine public child launch data. */
function peerEnvironment() {
  /** The child owns the same serial out-of-band snapshot file prefix as before. */
  const set = process.env.IPC_BENCH_STEM
    ? { IPC_BENCH_STEM: process.env.IPC_BENCH_STEM + '.peer' }
    : {}
  for (const key of [
    IpcBenchObservation.forcePeerGcEnvironment,
    IpcBenchObservation.heapProfileEnvironment,
    IpcBenchDiagnostic.environment
  ])
    if (process.env[key]) set[key] = process.env[key]
  return set
}

/** Native process snapshots retain the existing signal/file channel outside business timing. */
class ProcessSnapshots {
  /** Actual native child PID receives only the fixture snapshot signal. */
  #pid
  /** Each owner consumes its original serial file sequence. */
  #sequence = 0
  /** @param {number} pid Native child PID. */
  constructor(pid) {
    this.#pid = pid
  }
  /**
   * @param {object} [options] Explicit diagnostic boundary. @returns {Promise<object>} Native
   *   isolate evidence.
   */
  async read(options = {}) {
    const path = process.env.IPC_BENCH_STEM + '.peer.snapshot-' + this.#sequence++ + '.json'
    if (
      process.env[IpcBenchObservation.heapProfileEnvironment] === '1' ||
      process.env[IpcBenchDiagnostic.environment]
    )
      writeFileSync(
        process.env.IPC_BENCH_STEM + '.peer.snapshot-request.json',
        JSON.stringify(options)
      )
    process.kill(this.#pid, 'SIGUSR2')
    while (!existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 1))
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.diagnostic?.status === IpcBenchDiagnostic.failed)
      throw new Error(IpcBenchErrorText.diagnosticPeer, { cause: value.diagnostic.error })
    return value
  }
}

/** Release each acquired owner in reverse order; the primary failure remains first. */
async function releaseAll(cleanup, primary) {
  const failures = primary === undefined ? [] : [primary]
  for (let index = cleanup.length - 1; index >= 0; index--) {
    try {
      await cleanup[index]()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, IpcBenchErrorText.cleanup)
}

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

/** One real public namespace owns all RPC benchmark session state and stable call callbacks. */
class NativeRpcSession {
  /** The actual installed namespace owns request dispatch and Session admission. */
  #namespace
  /** Every exchange reuses the same immutable business payload. */
  #payload
  /** Acquired native resources retain their original reverse cleanup order. */
  #cleanup
  /** Native process snapshots use the same out-of-band file sequence. */
  #snapshots
  /** Worker snapshots use the real public diagnostic method outside the measured loop. */
  #worker
  /** The native child reports its real process identity through the public request path. */
  #pid
  /**
   * @param {object} namespace Actual public namespace. @param {string} carrier Physical cell.
   *   @param {string} payload Fixed data. @param {number} pid Native identity. @param {Function[]}
   *   cleanup Acquired owners.
   */
  constructor(namespace, carrier, payload, pid, cleanup) {
    this.#namespace = namespace
    this.#payload = payload
    this.#cleanup = cleanup
    this.#snapshots = new ProcessSnapshots(pid)
    this.#worker = carrier === 'worker'
    this.#pid = pid
  }
  /** @returns {object} The installed namespace, with no facade or wrapper. */
  get facade() {
    return this.#namespace
  }
  /** @returns {number} Actual native process identity. */
  get peerPid() {
    return this.#pid
  }
  /** @param {object} [options] Diagnostic boundary. @returns {Promise<object>} Actual peer evidence. */
  peerSnapshot = (options) =>
    this.#worker
      ? this.#namespace.request(RuntimeBench.snapshot, options)
      : this.#snapshots.read(options)
  /** @returns {object} Existing complete rejection/report classification. */
  classification = () => classification
  /** @returns {Promise<void>} Public Host creation already joined native readiness. */
  ready = async () => undefined
  /** @returns {Promise<void>} One exact public request, with original classified failure. */
  exchange = async () => {
    try {
      if ((await this.#namespace.request(RuntimeBench.echo, this.#payload)) !== this.#payload)
        throw new Error(IpcBenchErrorText.echo)
    } catch (error) {
      classification.failures.push(classify(error))
      throw error
    }
  }
  /** @returns {Promise<void>} Join the original reverse native teardown, retaining failures. */
  close = () => releaseAll(this.#cleanup)
}

/** One bare Worker session owns its native messages, reply correlation and observation port. */
class BareWorkerSession {
  /** The actual Worker receives the same immutable business value. */
  #worker
  /** Fixed business data is retained independently of the acquisition function. */
  #payload
  /** The original native close and port release keep their reverse ordering. */
  #cleanup
  /** A separate MessagePort carries cold snapshots outside the business path. */
  #controls
  /** One explicit FIFO owner correlates concurrent native replies. */
  #replies = new EchoReplies()
  /**
   * @param {object} worker Actual native Worker. @param {string} payload Fixed data. @param
   *   {Function[]} cleanup Original owners. @param {object} controls Separate port pair.
   */
  constructor(worker, payload, cleanup, controls) {
    this.#worker = worker
    this.#payload = payload
    this.#cleanup = cleanup
    this.#controls = controls
    worker.on('message', (value) =>
      this.#replies.settle(value === this.#payload ? undefined : new Error(IpcBenchErrorText.echo))
    )
    worker.on('error', (error) => this.#replies.rejectAll(error))
  }
  /** @returns {number} Native Workers share the original parent process. */
  get peerPid() {
    return process.pid
  }
  /** @returns {object} Existing complete rejection/report classification. */
  classification = () => classification
  /** @returns {Promise<void>} The original cold native readiness message was already joined. */
  ready = async () => undefined
  /** @returns {Promise<void>} One exact native message echo with FIFO correlation. */
  exchange = () => this.#replies.exchange(() => this.#worker.postMessage(this.#payload))
  /**
   * @param {object} [options] Cold snapshot boundary. @returns {Promise<object>} Actual Worker
   *   isolate evidence.
   */
  peerSnapshot = (options) =>
    new Promise((resolve) => {
      this.#controls.port1.once('message', resolve)
      this.#controls.port1.postMessage(options)
    })
  /** @returns {Promise<void>} Join native termination before closing the original observation port. */
  close = () => releaseAll(this.#cleanup)
}

/** One bare byte session retains the exact frame, native PID, snapshots and resource teardown. */
class BareByteSession {
  /** Native byte ownership stays with the physical streams or socket. */
  #raw
  /** The existing byte echo owner compares every reply and owns its stable exchange callback. */
  #echo
  /** Only this actual child process receives cold snapshot signals. */
  #pid
  /** Acquired native owners retain their original reverse teardown order. */
  #cleanup
  /** This process owns one out-of-band snapshot file sequence. */
  #snapshots
  /**
   * @param {object} raw Original native byte I/O. @param {number} pid Actual native identity.
   *   @param {string} payload Fixed data. @param {Function[]} cleanup Acquired owners.
   */
  constructor(raw, pid, payload, cleanup) {
    this.#raw = raw
    this.#pid = pid
    this.#cleanup = cleanup
    this.#snapshots = new ProcessSnapshots(pid)
    /** Encode this fixed payload once, before any business exchange or measurement. */
    const encoded = Buffer.from(JSON.stringify(payload))
    /** The physical baseline retains its original four-byte length prefix and JSON bytes. */
    const frame = Buffer.alloc(encoded.length + 4)
    frame.writeUInt32BE(encoded.length)
    frame.set(encoded, 4)
    this.#echo = new BareByteEcho(raw, frame, {
      mismatch: IpcBenchErrorText.echo,
      closed: IpcBenchErrorText.sideCleanup
    })
    cleanup.push(async () => {
      this.#echo.detach()
      await this.#raw.close()
    })
  }
  /** @returns {number} Actual child process identity. */
  get peerPid() {
    return this.#pid
  }
  /** @returns {object} Existing complete rejection/report classification. */
  classification = () => classification
  /** @returns {Promise<void>} The original cold readiness marker was already joined. */
  ready = async () => undefined
  /** @returns {() => Promise<void>} Preserve the original echo owner's callback identity. */
  get exchange() {
    return this.#echo.exchange
  }
  /**
   * @param {object} [options] Diagnostic boundary. @returns {Promise<object>} Actual native isolate
   *   evidence.
   */
  peerSnapshot = (options) => this.#snapshots.read(options)
  /** @returns {Promise<void>} Release framing listeners before the actual native child. */
  close = () => releaseAll(this.#cleanup)
}

/** Acquire a native bare child and retain its actual resource exit as the only close owner. */
async function openBareProcess(carrier, cleanup) {
  /** Socket paths stay within this one reversible local fixture directory. */
  const directory =
    carrier === 'socket-framed' ? await mkdtemp(join(tmpdir(), 'rpc-bench-')) : undefined
  if (directory) cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const address = directory ? join(directory, 'peer.sock') : undefined
  const child = spawn(
    process.execPath,
    [
      ...(typeof Deno !== 'undefined' ? ['run', '-A'] : []),
      entry,
      '--child',
      'bare',
      carrier,
      ...(address ? [address] : [])
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...peerEnvironment() }
    }
  )
  const exited = once(child, 'close')
  cleanup.push(async () => {
    child.kill()
    await exited
  })
  await waitReady(child)
  if (!address)
    return {
      pid: child.pid,
      raw: new BareByteIO(child.stdout, child.stdin, () => child.stdin.end())
    }
  const socket = connect(address)
  await once(socket, 'connect')
  return { pid: child.pid, raw: new BareByteIO(socket, socket, () => socket.destroy()) }
}

/** Genuine public hosts own negotiation, directory publication, calls and native supervision. */
async function openRpc(input, cleanup) {
  const { createRpcHost } = await import('@migaia/rpc-host')
  const { limits } = await import('@migaia/rpc-host/plugins/limits')
  /** Each selected plugin acquires its own real native resource from the public short recipe. */
  let definition
  if (input.carrier === 'worker') {
    const { threadPlugin } = await import('@migaia/rpc-plugin-thread')
    definition = threadPlugin({
      spawn: {
        entry: new URL(import.meta.url),
        data: {
          child: true,
          side: 'rpc',
          carrier: 'worker',
          ...(process.env.IPC_BENCH_STEM ? { benchStem: process.env.IPC_BENCH_STEM } : {})
        }
      },
      report
    })
  } else {
    const { processPlugin } = await import('@migaia/rpc-plugin-process')
    if (input.carrier === 'stdio-framed')
      definition = processPlugin({
        spawn: {
          entry: new URL(import.meta.url),
          args: ['--child', 'rpc', input.carrier],
          env: { inherit: ['PATH'], set: peerEnvironment() }
        },
        report
      })
    else {
      /** This parent owns only this fresh 0700 directory, including socket, owner record and token. */
      const directory = await mkdtemp(join(tmpdir(), 'rpc-bench-'))
      cleanup.push(() => rm(directory, { recursive: true, force: true }))
      const address = join(directory, 'peer.sock')
      /** Authentication bytes never enter child arguments, inherited environment or receipts. */
      const token = randomBytes(32).toString('base64url')
      await writeFile(join(directory, 'token'), token, { mode: 0o600, flag: 'wx' })
      const child = spawn(process.execPath, [entry, '--child', 'rpc', input.carrier, address], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, ...peerEnvironment() }
      })
      const exited = once(child, 'close')
      cleanup.push(async () => {
        child.kill()
        await exited
      })
      await waitReady(child)
      definition = processPlugin({ connect: { target: address }, token, report })
    }
  }
  const host = await createRpcHost({
    plugins: [
      ...(globalThis.__PROBE_BENCH_PROBE ? [globalThis.__PROBE_BENCH_PROBE] : []),
      limits(nativeProviderLimits),
      definition
    ],
    report
  })
  cleanup.push(() => host.close())
  const namespace = input.carrier === 'worker' ? host.thread : host.process
  const pid = await namespace.request('bench.pid')
  return new NativeRpcSession(namespace, input.carrier, input.payload, pid, cleanup)
}

/** A bare Worker performs exactly one parse/stringify echo without loading any RPC modules. */
async function openBareWorker(input, cleanup) {
  const controls = new MessageChannel()
  cleanup.push(() => controls.port1.close())
  const worker = new Worker(entry, {
    workerData: { child: true, side: 'bare', carrier: 'worker', benchPort: controls.port2 },
    transferList: [controls.port2]
  })
  const exited = once(worker, 'exit')
  cleanup.push(async () => {
    await worker.terminate()
    await exited
  })
  await once(worker, 'message')
  return new BareWorkerSession(worker, input.payload, cleanup, controls)
}

/**
 * Create one current native paired arm; no measurement begins during acquisition.
 *
 * @param {{
 *   carrier: string
 *   side: string
 *   payload: string
 * }} input
 *   Selected cell.
 * @returns {Promise<object>} Actual native owner, public namespace and exact echo.
 * @throws {unknown} Original native or public Host failure, with cleanup failures retained.
 */
export async function createIpcSession(input) {
  if (!['stdio-framed', 'socket-framed', 'worker'].includes(input.carrier))
    throw new Error(IpcBenchErrorText.carrier(input.carrier))
  const cleanup = []
  try {
    if (input.side === 'rpc') return await openRpc(input, cleanup)
    if (input.carrier === 'worker') return await openBareWorker(input, cleanup)
    const { pid, raw } = await openBareProcess(input.carrier, cleanup)
    return new BareByteSession(raw, pid, input.payload, cleanup)
  } catch (primary) {
    await releaseAll(cleanup, primary)
    throw primary
  }
}

/** Install the matching public child source; stdout remains owned by the byte protocol. */
async function childMain(side, carrier, address) {
  if (side === 'bare') {
    if (carrier === 'worker') {
      parentPort.on('message', (value) => parentPort.postMessage(JSON.parse(JSON.stringify(value))))
      parentPort.postMessage(readyText)
    } else if (carrier === 'socket-framed') {
      const server = createServer((socket) => {
        void serveBare(new BareByteIO(socket, socket, () => socket.destroy())).catch(report)
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, resolve)
      })
      process.stderr.write(readyText)
    } else {
      process.stderr.write(readyText)
      await serveBare(new BareByteIO(process.stdin, process.stdout, () => process.stdin.destroy()))
    }
    return
  }
  const { createRpcHost } = await import('@migaia/rpc-host')
  const { limits } = await import('@migaia/rpc-host/plugins/limits')
  const module = await import(
    carrier === 'worker' ? '@migaia/rpc-plugin-thread' : '@migaia/rpc-plugin-process'
  )
  const definition =
    carrier === 'worker'
      ? module.threadPlugin({ connectToParent: true, report })
      : module.processPlugin(
          carrier === 'socket-framed'
            ? {
                listen: address,
                token: readFileSync(join(dirname(address), 'token'), 'utf8'),
                report
              }
            : { connectToParent: true, report }
        )
  await createRpcHost({
    plugins: [limits(nativeProviderLimits), definition],
    provide: {
      bench: { echo: (value) => value, pid: () => process.pid, snapshot: captureSnapshot }
    },
    report
  })
  if (carrier === 'socket-framed') process.stderr.write(readyText)
}

/** Bootstrap role data comes only from the actual public launcher or the direct bare fixture. */
const input = workerData?.data ?? workerData
if (parentPort && input?.child) await childMain(input.side, input.carrier)
else if (
  (typeof Bun !== 'undefined' && !Bun.isMainThread) ||
  (typeof Deno !== 'undefined' && typeof globalThis.postMessage === 'function')
)
  await childMain('rpc', 'worker')
else if (process.argv.includes('--child'))
  await childMain(...process.argv.slice(process.argv.indexOf('--child') + 1))
