import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { measureBare } from './ipc.mjs'

/** Native framing ceiling matches the bare carrier's supported physical frame limit. */
const maxFrameBytes = 16 * 1024 * 1024
/** Worker readiness is out-of-band and carries no measured payload. */
const readyText = 'BARE_READY\n'

/**
 * Start one observer before the window; all subsequent reads use native PID syscalls.
 *
 * @param {number[]} pids Distinct parent and peer PIDs, or one shared worker PID.
 * @param {number} intervalMs Requested window RSS sampling interval.
 * @returns {Promise<object>} Observer plus close handle owned by this bare session.
 * @throws {Error} Observer startup or failed native reading never becomes unsupported.
 */
export async function createMacPidObserver(pids, intervalMs = 10) {
  /** One actual native observer owns both readiness and its original ordered replies. */
  const observer = new MacPidObserver(pids, intervalMs)
  await observer.ready()
  return observer
}

/** One observer process owns its native input, output framing and pending snapshot requests. */
class MacPidObserver {
  /**
   * Native commands retain the original admitted PID array even if a public observation is
   * reassigned.
   */
  #pids
  /** Sampling retains the admitted original interval independently of mutable receipt properties. */
  #intervalMs
  /** Python keeps its original persistent libproc handle outside measured endpoint totals. */
  #child
  /** Readline retains original physical line boundaries. */
  #lines
  /** FIFO membership is constant work per native reply without shifting a growing array. */
  #pending = new Map()
  /** Monotonic positions preserve the original ordered request/reply correlation. */
  #issued = 0
  /** Next physical reply consumes exactly one original queued request. */
  #received = 0
  /** Startup diagnostics remain outside endpoint CPU/RSS observations. */
  #diagnostic = ''
  /** Native readiness remains a separate receipt from resource snapshots. */
  #ready
  /** The original first readiness line settles this startup operation. */
  #resolveReady
  /** Startup and native pipe failure reject the same original readiness operation. */
  #rejectReady
  /**
   * @param {number[]} pids Actual distinct endpoint PIDs. @param {number} intervalMs Original
   *   interval.
   */
  constructor(pids, intervalMs) {
    this.#pids = [...new Set(pids)]
    this.pids = this.#pids
    this.#intervalMs = intervalMs
    this.intervalMs = intervalMs
    this.method = 'macOS proc_pid_rusage(RUSAGE_INFO_V0); no child totals; resident bytes'
    this.#child = spawn(
      'python3',
      ['-B', fileURLToPath(new URL('./native-pid-observer.py', import.meta.url))],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    this.#child.stderr.on('data', (chunk) => {
      this.#diagnostic += chunk.toString()
    })
    this.#child.on('error', (error) => this.#fail(error))
    this.#child.on('exit', (code) => {
      if (code !== 0) this.#fail(new Error(`PID observer exited ${code}: ${this.#diagnostic}`))
    })
    this.#lines = createInterface({ input: this.#child.stdout })
    this.#lines.on('line', (line) => this.#receive(line))
  }
  /** @returns {Promise<void>} Startup failure still kills only this native observer. */
  async ready() {
    try {
      await this.#ready
    } catch (error) {
      this.#child.kill()
      throw error
    }
  }
  /** @param {unknown} error Reject all original queued snapshots and the readiness receipt. */
  #fail(error) {
    this.#rejectReady(error)
    for (const waiter of this.#pending.values()) waiter.reject(error)
    this.#pending.clear()
    this.#received = this.#issued
  }
  /** @param {string} line Decode one physical reply without changing error ownership. */
  #receive(line) {
    try {
      /** Native observation data never substitutes the driver's own counters. */
      const message = JSON.parse(line)
      if (message.ready) {
        this.#resolveReady(message)
        return
      }
      /** Only the next original request may consume this ordered native reply. */
      const waiter = this.#pending.get(this.#received)
      this.#pending.delete(this.#received++)
      if (!waiter) throw new Error('Unexpected PID observer reply')
      if (message.error) waiter.reject(new Error(message.error))
      else waiter.resolve(message.rows)
    } catch (error) {
      this.#fail(error)
    }
  }
  /**
   * @param {unknown} payload Original observer command. @returns {Promise<object[]>} Actual PID
   *   rows.
   */
  #request(payload) {
    return new Promise((resolve, reject) => {
      this.#pending.set(this.#issued++, { resolve, reject })
      this.#child.stdin.write(JSON.stringify(payload) + '\n')
    })
  }
  /** @returns {Promise<object[]>} Original CPU/RSS request over the same native pipe. */
  read = () => this.#request(this.#pids)
  /** @returns {Promise<object[]>} Original extended resource command over the same native pipe. */
  readResources = () => this.#request({ pids: this.#pids, resources: true })
  /**
   * @param {(rows: object[]) => void} receive Sampling observer. @returns {()=>Promise<void>}
   *   Original join.
   */
  start(receive) {
    return new MacPidSampling(this, receive, this.#intervalMs).stop
  }
  /** @returns {Promise<void>} Join this observer's original physical close before readline teardown. */
  async close() {
    this.#child.stdin.end()
    await once(this.#child, 'close')
    this.#lines.close()
  }
}

/** One interval serializes its original native reads and retains the first sampling failure. */
class MacPidSampling {
  /** Original observer performs every native read; this owner only serializes interval receipts. */
  #observer
  /** Caller retains the same per-snapshot resource observation callback. */
  #receive
  /** One Promise chain preserves the original non-overlapping sample order. */
  #sampling = Promise.resolve()
  /** First interval error is surfaced when its original owner joins. */
  #error
  /** The same native interval is cleared exactly when sampling stops. */
  #timer
  /**
   * @param {MacPidObserver} observer Native owner. @param {(rows:object[])=>void} receive
   *   Observation.
   */
  constructor(observer, receive, intervalMs) {
    this.#observer = observer
    this.#receive = receive
    this.#timer = setInterval(() => {
      this.#sampling = this.#sampling.then(() => this.#sample())
    }, intervalMs)
  }
  /** @returns {Promise<void>} A failed sample retains the original first error without overlap. */
  async #sample() {
    try {
      this.#receive(await this.#observer.read())
    } catch (failure) {
      this.#error ??= failure
    }
  }
  /** @returns {Promise<void>} Stop the original timer and join every outstanding native read. */
  stop = async () => {
    clearInterval(this.#timer)
    await this.#sampling
    if (this.#error) throw this.#error
  }
}

/**
 * Create one raw stdio echo peer using the same Node runtime as its isolated parent.
 *
 * @param {Uint8Array} payload Caller supplies exactly the codec-produced paired bytes.
 * @returns {Promise<object>} Ready peer and sequential echo port; caller closes both pipes.
 * @throws {Error} Launch, frame or echo mismatch fails this bare side.
 */
export async function createBareNodeSession(payload) {
  if (!payload.length || payload.length > maxFrameBytes)
    throw new RangeError('Bare frame outside carrier limit')
  /** One actual peer retains its own readiness, physical frame and current echo. */
  const session = new BareNodeSession(payload)
  await session.ready()
  return session
}

/** One sequential bare peer owns the exact native process and outstanding echo receipt. */
class BareNodeSession {
  /** The actual child retains original stderr readiness and physical stdio lifetime. */
  #peer
  /** Encoded bytes remain the same reusable full frame for every exchange. */
  #frame
  /** Each partial echo is copied directly into its final comparison buffer. */
  #buffer
  /** Bytes received in the current original sequential echo. */
  #received = 0
  /** Original current echo success receipt. */
  #resolveEcho
  /** Original current echo failure receipt. */
  #rejectEcho
  /** Startup remains a distinct Promise that every ready caller receives unchanged. */
  #ready
  /** Physical readiness marker is accumulated outside formal timing. */
  #status = ''
  /** @param {Uint8Array} payload Exact paired encoded bytes. */
  constructor(payload) {
    this.#peer = spawn(process.execPath, [fileURLToPath(import.meta.url), '--echo'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.#frame = Buffer.alloc(4 + payload.length)
    this.#frame.writeUInt32BE(payload.length)
    this.#frame.set(payload, 4)
    this.#buffer = Buffer.alloc(this.#frame.length)
    this.#peer.stdout.on('data', (chunk) => this.#receive(chunk))
    this.#ready = new Promise((resolve, reject) => {
      this.#peer.stderr.on('data', (chunk) => {
        this.#status += chunk.toString()
        if (this.#status === readyText) resolve()
      })
      this.#peer.on('error', reject)
      this.#peer.on('exit', (code) => {
        if (code !== 0) {
          const error = new Error(`Bare peer exited ${code}`)
          reject(error)
          this.#rejectEcho?.(error)
        }
      })
    })
  }
  /** @param {Uint8Array} chunk Same incoming bytes, copied once instead of repeated concatenation. */
  #receive(chunk) {
    if (this.#received + chunk.length > this.#frame.length) {
      this.#rejectEcho?.(new Error('Bare echo byte mismatch'))
      return
    }
    this.#buffer.set(chunk, this.#received)
    this.#received += chunk.length
    if (this.#received < this.#frame.length) return
    if (!this.#buffer.equals(this.#frame)) {
      this.#rejectEcho?.(new Error('Bare echo byte mismatch'))
      return
    }
    this.#received = 0
    this.#resolveEcho?.()
  }
  /** @returns {number} Actual peer process identity. */
  get peerPid() {
    return this.#peer.pid
  }
  /** @returns {Promise<void>} Exact original readiness Promise. */
  ready = () => this.#ready
  /** @returns {Promise<void>} Original one-at-a-time physical echo Promise. */
  exchange = () =>
    new Promise((resolve, reject) => {
      this.#resolveEcho = resolve
      this.#rejectEcho = reject
      this.#peer.stdin.write(this.#frame)
    })
  /** @returns {Promise<void>} End original stdin and join native child close. */
  async close() {
    this.#peer.stdin.end()
    await once(this.#peer, 'close')
  }
}

/** Bare child parser fills one prefix and body, with total work linear in physical input. */
class BareEchoFrames {
  /** Four-byte native header is reused across complete frames. */
  #prefix = Buffer.alloc(4)
  /** Number of prefix bytes already received. */
  #prefixBytes = 0
  /** Only one validated frame body is allocated at a time. */
  #body
  /** Body bytes copied once into the final payload. */
  #bodyBytes = 0;
  /** @param {Uint8Array} chunk Physical input. @returns {Iterable<Buffer>} Complete original bodies. */
  *receive(chunk) {
    /** Each byte is consumed exactly once by its prefix or final body. */
    let cursor = 0
    while (cursor < chunk.length) {
      if (!this.#body) {
        /** Prefix completion never rescans already received bytes. */
        const take = Math.min(4 - this.#prefixBytes, chunk.length - cursor)
        this.#prefix.set(chunk.subarray(cursor, cursor + take), this.#prefixBytes)
        this.#prefixBytes += take
        cursor += take
        if (this.#prefixBytes < 4) continue
        /** Original encoded payload limit excludes the four-byte prefix. */
        const length = this.#prefix.readUInt32BE(0)
        if (!length || length > maxFrameBytes)
          throw new RangeError('Bare frame outside carrier limit')
        this.#body = Buffer.alloc(length)
        this.#bodyBytes = 0
      }
      /** Body fragments fill only their final assigned range. */
      const take = Math.min(this.#body.length - this.#bodyBytes, chunk.length - cursor)
      this.#body.set(chunk.subarray(cursor, cursor + take), this.#bodyBytes)
      this.#bodyBytes += take
      cursor += take
      if (this.#bodyBytes !== this.#body.length) continue
      yield this.#body
      this.#body = undefined
      this.#prefixBytes = 0
    }
  }
  /** @returns {boolean} The same EOF oracle rejects any partial physical frame. */
  get incomplete() {
    return this.#prefixBytes !== 0 || this.#body !== undefined
  }
}

/** Echo framed payloads after one JSON parse and serialization, matching the reference baseline. */
async function echo() {
  process.stderr.write(readyText)
  /** Only bare framing state persists across original physical stdin fragments. */
  const frames = new BareEchoFrames()
  for await (const chunk of process.stdin) {
    for (const payload of frames.receive(chunk)) {
      /** Bare JSON work retains one original parse and serialization per payload. */
      const body = Buffer.from(JSON.stringify(JSON.parse(payload.toString())))
      /** Physical length follows the same serialized JSON body. */
      const frame = Buffer.alloc(4 + body.length)
      frame.writeUInt32BE(body.length)
      frame.set(body, 4)
      if (!process.stdout.write(frame)) await once(process.stdout, 'drain')
    }
  }
  if (frames.incomplete) throw new Error('Incomplete bare frame at EOF')
}

/** CLI starts an isolated Node parent; preparation mode does not measure performance. */
async function main() {
  if (process.argv.includes('--echo')) {
    await echo()
    return
  }
  /** Argument default describes one prepared stdio/json unit, not a frozen full matrix. */
  const bytes = Number(process.argv[process.argv.indexOf('--bytes') + 1]) || 1024
  /** JSON codec output is retained verbatim for future paired RPC echo input. */
  const payload = Buffer.from(JSON.stringify('x'.repeat(bytes)))
  /** Owned peer is closed only after endpoint resource observation completes. */
  const session = await createBareNodeSession(payload)
  /** Observation excludes this separate tooling process from parent+peer endpoint totals. */
  let observer
  /** Both cleanup owners run even when measurement or the first close fails. */
  const failures = []
  try {
    observer = await createMacPidObserver([process.pid, session.peerPid])
    if (process.argv.includes('--check')) {
      /** Three real echoes and two native readings prove preparation only; no reference sample set. */
      const first = await observer.read()
      for (let index = 0; index < 3; index++) await session.exchange()
      /** Both PIDs stay live until the second native snapshot succeeds. */
      const last = await observer.read()
      console.log(
        JSON.stringify({
          type: 'bare-preparation',
          parentPid: process.pid,
          peerPid: session.peerPid,
          echoes: 3,
          encodedBytes: payload.length,
          first,
          last,
          method: observer.method
        })
      )
    } else {
      /** Only root's exclusive performance run invokes this measurement path. */
      const result = await measureBare({ ...session, observer })
      console.log(
        JSON.stringify({
          type: 'bare-side',
          runtime: process.version,
          carrier: 'stdio-framed',
          codec: 'json',
          payloadBytes: bytes,
          encodedBytes: payload.length,
          concurrency: 1,
          parentPid: process.pid,
          peerPid: session.peerPid,
          ...result
        })
      )
    }
  } catch (error) {
    failures.push(error)
  }
  /** Joining both owners prevents observer cleanup failure from abandoning the echo peer. */
  const cleanup = await Promise.allSettled([
    ...(observer ? [observer.close()] : []),
    session.close()
  ])
  for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason)
  if (failures.length > 1) throw new AggregateError(failures, 'Bare side and cleanup failed')
  if (failures.length) throw failures[0]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
