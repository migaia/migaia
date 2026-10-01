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
  /** Python owns one persistent native library handle, created before readiness/warmup. */
  const child = spawn(
    'python3',
    ['-B', fileURLToPath(new URL('./native-pid-observer.py', import.meta.url))],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  /** Ordered replies bind each requested snapshot to exactly one pending read. */
  const pending = []
  /** The observer's first line proves ctypes/libproc are loaded before sampling can begin. */
  let resolveReady
  /** Startup and pipe errors reject readiness rather than hanging the paired driver. */
  let rejectReady
  /** Startup receipt has a different shape from resource snapshots. */
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  /** Fixed observer diagnostics are kept outside CPU/RSS endpoint totals. */
  let diagnostic = ''
  child.stderr.on('data', (chunk) => {
    diagnostic += chunk.toString()
  })
  /** Reject every queued read on startup, pipe or observer exit failure. */
  const fail = (error) => {
    rejectReady(error)
    for (const waiter of pending.splice(0)) waiter.reject(error)
  }
  child.on('error', fail)
  child.on('exit', (code) => {
    if (code !== 0) fail(new Error(`PID observer exited ${code}: ${diagnostic}`))
  })
  /** Line framing is only observer control; it is not an RPC protocol implementation. */
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try {
      /** Native observation data is consumed without substituting local resource totals. */
      const message = JSON.parse(line)
      if (message.ready) {
        resolveReady(message)
        return
      }
      /** Each native error rejects its own snapshot instead of emitting a ratio assertion. */
      const waiter = pending.shift()
      if (!waiter) throw new Error('Unexpected PID observer reply')
      if (message.error) waiter.reject(new Error(message.error))
      else waiter.resolve(message.rows)
    } catch (error) {
      fail(error)
    }
  })
  try {
    await ready
  } catch (error) {
    child.kill()
    throw error
  }
  /** Deduplicated PID array is sent on every read, so thread endpoints count once. */
  const uniquePids = [...new Set(pids)]
  /** A single read promise includes both endpoint PID syscalls. */
  const read = () =>
    new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
      child.stdin.write(JSON.stringify(uniquePids) + '\n')
    })
  return {
    pids: uniquePids,
    method: 'macOS proc_pid_rusage(RUSAGE_INFO_V0); no child totals; resident bytes',
    intervalMs,
    read,
    start(receive) {
      /** All samples are serialized; one slow read cannot create overlapping sampler children. */
      let sampling = Promise.resolve()
      /** Timer failure is retained and surfaced when the sampling owner joins. */
      let error
      /** Interval runs only inside measureBare's ready/warmup-completed window. */
      const timer = setInterval(() => {
        sampling = sampling.then(async () => {
          try {
            receive(await read())
          } catch (failure) {
            error ??= failure
          }
        })
      }, intervalMs)
      return async () => {
        clearInterval(timer)
        await sampling
        if (error) throw error
      }
    },
    async close() {
      child.stdin.end()
      await once(child, 'close')
      lines.close()
    }
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
  /** A bare peer owns no codec, handshake, endpoint or business protocol. */
  const peer = spawn(process.execPath, [fileURLToPath(import.meta.url), '--echo'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  /** Exactly one outstanding echo represents concurrency one for the paired unit. */
  let resolveEcho
  /** The outstanding echo fails on process or stream failure. */
  let rejectEcho
  /** Partial physical bytes are bounded by one supported frame. */
  let buffered = Buffer.alloc(0)
  /** Reusable full frame preserves identical encoded payload bytes across all echoes. */
  const frame = Buffer.alloc(4 + payload.length)
  frame.writeUInt32BE(payload.length)
  frame.set(payload, 4)
  peer.stdout.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    if (buffered.length < frame.length) return
    if (!buffered.equals(frame)) {
      rejectEcho?.(new Error('Bare echo byte mismatch'))
      return
    }
    buffered = Buffer.alloc(0)
    resolveEcho?.()
  })
  /** Readiness precedes all warmup and endpoint observation. */
  const ready = new Promise((resolve, reject) => {
    /** The worker emits one fixed marker before handling echo bytes. */
    let status = ''
    peer.stderr.on('data', (chunk) => {
      status += chunk.toString()
      if (status === readyText) resolve()
    })
    peer.on('error', reject)
    peer.on('exit', (code) => {
      if (code !== 0) {
        const error = new Error(`Bare peer exited ${code}`)
        reject(error)
        rejectEcho?.(error)
      }
    })
  })
  await ready
  return {
    peerPid: peer.pid,
    ready: () => ready,
    exchange: () =>
      new Promise((resolve, reject) => {
        resolveEcho = resolve
        rejectEcho = reject
        peer.stdin.write(frame)
      }),
    async close() {
      peer.stdin.end()
      await once(peer, 'close')
    }
  }
}

/** Echo only physical frames; no JSON/codec/RPC work is added to the bare counterpart. */
async function echo() {
  process.stderr.write(readyText)
  /**
   * Buffer holds at most one validated frame and any coalesced input from the same sequential
   * sender.
   */
  let bytes = Buffer.alloc(0)
  for await (const chunk of process.stdin) {
    bytes = Buffer.concat([bytes, chunk])
    while (bytes.length >= 4) {
      /** Length counts encoded payload bytes, never the four-byte prefix. */
      const length = bytes.readUInt32BE(0)
      if (!length || length > maxFrameBytes)
        throw new RangeError('Bare frame outside carrier limit')
      if (bytes.length < length + 4) break
      /** Backpressure drain is part of each physical echo's completion path. */
      const frame = bytes.subarray(0, length + 4)
      bytes = bytes.subarray(length + 4)
      if (!process.stdout.write(frame)) await once(process.stdout, 'drain')
    }
  }
  if (bytes.length) throw new Error('Incomplete bare frame at EOF')
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
      /** Three real echoes and two native readings prove preparation only; no A10 sample set. */
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
