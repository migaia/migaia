#!/usr/bin/env node
// Machine-wide exclusive measurement window. Every heavy command that must not share the CPU
// with another measurement runs through `run`.
//
// Ownership protocol: mutual exclusion comes from the kernel, not from the lock file. The runner
// listens on a fixed loopback TCP port for the whole window; only one process can hold that port,
// and the kernel frees it when the holder exits or dies, so the mutex itself never goes stale and
// never needs reaping. The lock file is written only by the port holder and is metadata for
// readers (status, other tools that follow the file protocol). Because exactly one process can
// hold the port, only that process creates, rewrites or removes the lock file, so heartbeat and
// release need no compare-and-swap.
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { constants, homedir, hostname, loadavg } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Exit codes. `busy`, `load` and `heartbeatFailed` use EX_TEMPFAIL so callers can retry later;
 * `heartbeatFailed` means the lock file could not be refreshed (for example ENOSPC), so the window
 * was ended early and its measurement is invalid. `portConflict` means an unrelated service owns
 * the mutex port, which no amount of waiting fixes (EX_UNAVAILABLE). `timeout` matches coreutils
 * `timeout`; `usage` matches common CLI usage errors. A child killed by a signal exits with 128 +
 * the signal number (130 for SIGINT, 143 for SIGTERM).
 */
export const ExitCode = {
  ok: 0,
  held: 1,
  stale: 2,
  usage: 64,
  portConflict: 69,
  busy: 75,
  load: 75,
  heartbeatFailed: 75,
  timeout: 124
}

/** Defaults shared by the CLI and the tests; each can be overridden per invocation. */
export const WindowDefault = {
  /** Hard cap for one window (45 minutes); the runner terminates the whole process group then. */
  maxSeconds: 2700,
  /** Highest 1-minute load average accepted at window start and end. */
  maxLoad: 5,
  /** Lock-file heartbeat period, for readers that follow the file protocol. */
  heartbeatSeconds: 15,
  /** A lock file without a live port holder is stale once its heartbeat is older than this. */
  staleSeconds: 600,
  /** Poll period while `--wait` is waiting for a held window or high load. */
  pollSeconds: 5,
  /** Grace period between SIGTERM and SIGKILL once the window must end. */
  killGraceSeconds: 10,
  /** Loopback port used as the kernel-held mutex; override with MIGAIA_EXCLUSIVE_WINDOW_PORT. */
  port: 47219
}

/** Greeting the port holder sends to every probe, so status can tell this tool from a stranger. */
const Greeting = 'migaia-exclusive-window/1'

/** Stable operator-facing text; tests and callers compare these prefixes. */
export const WindowText = {
  usage:
    'usage: exclusive-window <run|status|check|reap> [--window NAME] [--max-seconds N] [--max-load N] [--wait SECONDS] -- <command...>',
  missingCommand: 'run requires a command after --',
  busy: (owner) => `exclusive window is held by ${owner}`,
  load: (value, max) => `load average ${value.toFixed(2)} exceeds ${max}`,
  timeout: (seconds) => `window exceeded ${seconds}s; process group terminated`,
  bookkeepingFailed: (message) => `lock release bookkeeping failed (${message}); port released`,
  heartbeatFailed: (message) => `lock heartbeat failed (${message}); process group terminated`,
  portConflict: (port) =>
    `port ${port} is used by another service; set MIGAIA_EXCLUSIVE_WINDOW_PORT`,
  reaped: (reason) => `stale lock archived: ${reason}`,
  invalidNumber: (flag) => `${flag} requires a finite number in range`,
  free: 'exclusive window is free'
}

/** Returns the directory that holds the lock and its history; shared by every worktree. */
export function lockDirectory(env = process.env) {
  return (
    env.MIGAIA_EXCLUSIVE_WINDOW_DIR ||
    join(homedir(), '.local', 'state', 'migaia', 'exclusive-window')
  )
}

/** Returns the mutex port; tests isolate themselves with MIGAIA_EXCLUSIVE_WINDOW_PORT. */
export function mutexPort(env = process.env) {
  /** Configured port, when set. */
  const configured = Number(env.MIGAIA_EXCLUSIVE_WINDOW_PORT)
  return Number.isInteger(configured) && configured > 0 && configured < 65536
    ? configured
    : WindowDefault.port
}

/** Lock and history file paths inside the lock directory. */
export function lockPaths(directory) {
  return {
    lock: join(directory, 'EXCLUSIVE-WINDOW.lock'),
    history: join(directory, 'EXCLUSIVE-WINDOW.history.jsonl')
  }
}

/**
 * Reads the current 1-minute load average. Tests inject a value through
 * MIGAIA_EXCLUSIVE_WINDOW_LOAD so admission can be exercised deterministically.
 */
export function currentLoad(env = process.env) {
  /** Injected load for deterministic tests; unset in normal use. */
  const injected = env.MIGAIA_EXCLUSIVE_WINDOW_LOAD
  return injected === undefined ? loadavg()[0] : Number(injected)
}

/** Reports whether a local process id is alive; signal 0 only probes. */
export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Parses a heartbeat from the current UTC field or the legacy epoch-seconds field. */
function heartbeatMillis(record) {
  if (typeof record.heartbeatUTC === 'string') return Date.parse(record.heartbeatUTC)
  if (typeof record.heartbeat === 'string') return Date.parse(record.heartbeat)
  if (typeof record.heartbeatAt === 'number') return record.heartbeatAt * 1000
  return Number.NaN
}

/**
 * Classifies a lock file by content only. When the owner ran on this host with a recorded pid,
 * liveness decides directly: alive is `held`, dead is `stale`. Otherwise (other host, legacy
 * pid-less records) a fresh heartbeat counts as `held` and an old one as `stale`. Unreadable files
 * count as stale only after `staleSeconds`, so a write in progress is never judged stale. Read and
 * stat use one file descriptor, so a concurrent release cannot make this throw.
 */
export function inspectLock(path, now = Date.now(), staleSeconds = WindowDefault.staleSeconds) {
  /** Descriptor kept open across read and stat. */
  let fd
  try {
    fd = openSync(path, 'r')
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'free' }
    throw error
  }
  /** Raw lock text. */
  let text
  /** Modification time of the same file that was read. */
  let mtimeMs
  try {
    text = readFileSync(fd, 'utf8')
    mtimeMs = fstatSync(fd).mtimeMs
  } finally {
    closeSync(fd)
  }
  /** Parsed lock record, or undefined when the file is not valid JSON. */
  let record
  try {
    record = JSON.parse(text)
  } catch {
    record = undefined
  }
  if (record === undefined || typeof record !== 'object' || record === null)
    return (now - mtimeMs) / 1000 > staleSeconds
      ? { state: 'stale', reason: 'unreadable lock', record: text }
      : { state: 'held', reason: 'unreadable lock being written', record: text }
  /** Seconds since the owner last proved it was alive. */
  const heartbeatAge = (now - heartbeatMillis(record)) / 1000
  /** Whether the owner's liveness can be checked directly: same host and a recorded pid. */
  const checkable = record.host === hostname() && Number.isSafeInteger(record.pid)
  if (checkable && processAlive(record.pid)) return { state: 'held', record }
  // A dead local owner is stale at once; a fresh heartbeat proves nothing once its writer is gone.
  if (checkable) return { state: 'stale', reason: 'owner process not alive', record }
  if (Number.isFinite(heartbeatAge) && heartbeatAge <= staleSeconds)
    return { state: 'held', record }
  return {
    state: 'stale',
    reason: Number.isFinite(heartbeatAge)
      ? `heartbeat ${Math.round(heartbeatAge)}s old and owner not alive`
      : 'missing heartbeat and owner not alive',
    record
  }
}

/** Appends one history entry; history is append-only so no earlier window is rewritten. */
function appendHistory(path, entry) {
  appendFileSync(path, `${JSON.stringify(entry)}\n`)
}

/**
 * Classifies a lock file given one more fact: `freePort`, a mutex port known to have no live
 * window, either because the caller holds it or because a probe found it free. A record this tool
 * wrote on this host for exactly that port cannot belong to a live window, since a live window
 * holds its port; it is stale even if its pid is alive (a previous window of the same process whose
 * release could not delete the file, or a reused pid). Records for any other port, and records
 * without a port (tools that follow only the file protocol), keep the content-only verdict.
 */
export function classifyLock(path, options = {}) {
  /** Content-only classification. */
  const verdict = inspectLock(path, options.now, options.staleSeconds)
  return options.freePort !== undefined &&
    verdict.state === 'held' &&
    verdict.record?.port === options.freePort &&
    verdict.record.host === hostname()
    ? {
        state: 'stale',
        reason: 'window no longer holds its mutex port',
        portReleased: true,
        record: verdict.record
      }
    : verdict
}

/**
 * Archives a stale lock file. Callers must hold the mutex port, so no other runner of this tool can
 * reap or acquire concurrently. A tool that follows only the file protocol may still refresh its
 * own heartbeat between the verdict and the rename, so the archived file is classified again; if it
 * is no longer stale it is restored with `link`, which never overwrites a newer file.
 */
export function reapLock(directory, options = {}) {
  /** Reference time for the verdict. */
  const now = options.now ?? Date.now()
  /** Heartbeat age after which a pid-less record is stale. */
  const staleSeconds = options.staleSeconds ?? WindowDefault.staleSeconds
  /** Test seam only: lets a test interleave a heartbeat between the verdict and the rename. */
  const afterVerdict = options.afterVerdict
  /** Classifies with the port the caller holds, when it holds one. */
  const classify = (path, at) =>
    classifyLock(path, { now: at, staleSeconds, freePort: options.heldPort })
  /** Lock and history locations for this directory. */
  const paths = lockPaths(directory)
  /** Current classification of the lock file. */
  const verdict = classify(paths.lock, now)
  if (verdict.state !== 'stale') return verdict
  afterVerdict?.()
  /** Unique archive name for this reap attempt. */
  const archive = `${paths.lock}.stale-${now}-${process.pid}`
  try {
    renameSync(paths.lock, archive)
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'free' }
    throw error
  }
  /** The archived file, classified again at the current time. */
  const archived = classify(archive, Date.now())
  if (archived.state !== 'stale') {
    try {
      linkSync(archive, paths.lock)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    rmSync(archive, { force: true })
    return { state: 'held', reason: 'owner refreshed while reaping', record: archived.record }
  }
  appendHistory(paths.history, {
    released: new Date(now).toISOString(),
    releasedBy: 'reap',
    reason: verdict.reason,
    lock: verdict.record
  })
  rmSync(archive, { force: true })
  return { state: 'reaped', reason: verdict.reason }
}

/**
 * Connects to the mutex port. Resolves `free` when nothing listens, `held` with the holder's record
 * when this tool listens, and `conflict` when something else answers or stays silent.
 */
export function probePort(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    /** Bytes received from the listener. */
    let data = ''
    /** Whether the probe already resolved. */
    let settled = false
    /** Probe connection to the mutex port. */
    const socket = createConnection({ port, host: '127.0.0.1' })
    /** Resolves once, whatever happens first, and closes the connection. */
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish({ state: 'conflict' }))
    socket.on('data', (chunk) => {
      data += chunk
    })
    socket.on('error', (error) =>
      finish(error.code === 'ECONNREFUSED' ? { state: 'free' } : { state: 'conflict' })
    )
    socket.on('end', () => {
      /** Greeting line followed by the holder's lock record. */
      const [greeting, ...rest] = data.split('\n')
      if (greeting !== Greeting) return finish({ state: 'conflict' })
      /** Holder's lock record; absent while the holder is still preparing it. */
      let record
      try {
        record = JSON.parse(rest.join('\n'))
      } catch {
        record = undefined
      }
      finish({ state: 'held', record })
    })
  })
}

/**
 * Tries to take the kernel-held mutex. Resolves with the listening server, `held` when another
 * runner of this tool owns the port, `retry` when the port was busy but freed before the probe (the
 * owner just released it), or `conflict` when an unrelated service owns it. The server answers
 * every connection with the greeting and the current lock record, then closes it. Its socket is
 * close-on-exec, so spawned commands never inherit the port.
 */
function acquirePort(port, recordText) {
  return new Promise((resolve, reject) => {
    /** Mutex server answering probes. */
    const server = createServer((socket) => socket.end(`${Greeting}\n${recordText()}\n`))
    server.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') return reject(error)
      probePort(port).then((probe) =>
        resolve(probe.state === 'free' ? 'retry' : probe.state === 'held' ? 'held' : 'conflict')
      )
    })
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(server))
  })
}

/** Closes the mutex server and resolves once the port is released. */
function releasePort(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

/** Writes the lock file with O_EXCL; returns false when a file-protocol owner already has it. */
function createLockFile(paths, record) {
  /** File descriptor of the newly created lock. */
  let fd
  try {
    fd = openSync(paths.lock, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') return false
    throw error
  }
  try {
    writeFileSync(fd, JSON.stringify(record, null, 2))
  } finally {
    closeSync(fd)
  }
  return true
}

/** Rewrites the heartbeat; only the port holder calls this, so no other writer can interleave. */
function heartbeat(paths, record) {
  record.heartbeatUTC = new Date().toISOString()
  /** Temporary file so readers never observe a partial heartbeat. */
  const temporary = `${paths.lock}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(record, null, 2))
  renameSync(temporary, paths.lock)
}

/** Sleeps for the given number of seconds. */
function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

/**
 * Numeric option rules: name, CLI flag, and the accepted range. NaN, infinities and out-of-range
 * values are usage errors, so a typo can neither disable the load gate nor wait forever.
 */
const NumericOption = [
  { name: 'maxSeconds', flag: '--max-seconds', valid: (value) => value > 0 },
  { name: 'maxLoad', flag: '--max-load', valid: (value) => value > 0 },
  { name: 'waitSeconds', flag: '--wait', valid: (value) => value >= 0 }
]

/** Returns the usage text for the first invalid numeric option, or undefined when all are valid. */
export function invalidNumericOption(options) {
  for (const { name, flag, valid } of NumericOption) {
    /** Supplied value; absent values fall back to defaults. */
    const value = options[name]
    if (value !== undefined && !(Number.isFinite(value) && valid(value)))
      return WindowText.invalidNumber(flag)
  }
  return undefined
}

/** Exit code for a finished child: its own code, or 128 + signal number when a signal killed it. */
function childExitCode(status) {
  if (status.code !== null && status.code !== undefined) return status.code
  /** Signal number from the platform table; unknown signals fall back to the generic 128. */
  const number = status.signal ? constants.signals[status.signal] : undefined
  return 128 + (number ?? 0)
}

/** Reports whether any process of the group still exists; signal 0 only probes. */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Sends a signal to the whole process group, ignoring a group that already exited. */
function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

/** Resolves once no member of the process group remains. */
async function groupGone(pgid) {
  while (groupAlive(pgid)) await sleep(0.05)
}

/**
 * Runs `command` inside an exclusive window and resolves with the exit code to use. Owns the full
 * lifecycle: load admission, the kernel-held mutex, the lock file, heartbeat, the window cap with
 * SIGTERM-then-SIGKILL escalation, signal forwarding, and release with history. The window is
 * released only after the whole process group of the command is gone.
 *
 * Limitation: if this runner itself is killed with SIGKILL, the kernel frees the port while the
 * command's process group may keep running; nothing in user space can prevent that.
 *
 * @param {{
 *   command: string[]
 *   window?: string
 *   maxSeconds?: number
 *   maxLoad?: number
 *   waitSeconds?: number
 *   pollSeconds?: number
 *   heartbeatSeconds?: number
 *   killGraceSeconds?: number
 *   env?: NodeJS.ProcessEnv
 *   log?: (line: string) => void
 * }} options
 * @returns {Promise<number>}
 */
export async function runWindow(options) {
  /** Effective environment for this run. */
  const env = options.env ?? process.env
  /** Operator log sink. */
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`))
  /** Rejected numeric option, checked here too for programmatic callers. */
  const invalid = invalidNumericOption(options)
  if (invalid) {
    log(invalid)
    return ExitCode.usage
  }
  /** Effective window cap in seconds. */
  const maxSeconds = options.maxSeconds ?? WindowDefault.maxSeconds
  /** Effective load admission ceiling. */
  const maxLoad = options.maxLoad ?? WindowDefault.maxLoad
  /** Poll period while waiting; tests shorten it. */
  const pollSeconds = options.pollSeconds ?? WindowDefault.pollSeconds
  /** Heartbeat period; tests shorten it. */
  const heartbeatSeconds = options.heartbeatSeconds ?? WindowDefault.heartbeatSeconds
  /** Grace before SIGKILL; tests shorten it. */
  const killGraceSeconds = options.killGraceSeconds ?? WindowDefault.killGraceSeconds
  /** Lock directory shared by every worktree. */
  const directory = lockDirectory(env)
  mkdirSync(directory, { recursive: true })
  /** Lock and history paths. */
  const paths = lockPaths(directory)
  /** Mutex port for this machine. */
  const port = mutexPort(env)
  /** Deadline for waiting on a held window or high load. */
  const waitUntil = Date.now() + (options.waitSeconds ?? 0) * 1000
  /** Lock record; rebuilt on every attempt so its times and load describe the real start. */
  let record
  /** Listening mutex server once acquired. */
  let server
  /** Reason the latest attempt did not start; reported when the deadline ends the wait. */
  let refusal
  for (let attempt = 0; ; attempt += 1) {
    // No attempt may start after the deadline; the first attempt always runs.
    if (attempt > 0 && Date.now() > waitUntil) {
      log(refusal.text)
      return refusal.code
    }
    /** Load observed at this admission attempt. */
    const startLoad = currentLoad(env)
    if (startLoad > maxLoad)
      refusal = { code: ExitCode.load, text: WindowText.load(startLoad, maxLoad) }
    else {
      /** Attempt start, shared by the record's time fields. */
      const startedAt = Date.now()
      record = {
        window: options.window ?? 'unnamed',
        owner: env.MIGAIA_EXCLUSIVE_WINDOW_OWNER ?? `pid-${process.pid}`,
        host: hostname(),
        pid: process.pid,
        port,
        startUTC: new Date(startedAt).toISOString(),
        heartbeatUTC: new Date(startedAt).toISOString(),
        expectedEnd: new Date(startedAt + maxSeconds * 1000).toISOString(),
        startLoad,
        cwd: process.cwd(),
        command: options.command
      }
      /** Record captured for the probe responder. */
      const current = record
      /** Outcome of the port attempt. */
      const taken = await acquirePort(port, () => JSON.stringify(current))
      if (taken === 'conflict') {
        log(WindowText.portConflict(port))
        return ExitCode.portConflict
      }
      // The previous owner released the port between our listen and the probe: try again now,
      // subject to the deadline check at the top of the loop.
      if (taken === 'retry') {
        refusal = { code: ExitCode.busy, text: WindowText.busy('a window that just ended') }
        continue
      }
      if (taken === 'held') {
        /** Holder that answered the probe. */
        const probe = await probePort(port)
        refusal = { code: ExitCode.busy, text: WindowText.busy(probe.record?.owner ?? 'unknown') }
      } else {
        // Holding the port: no runner of this tool can touch the file now. A leftover file is
        // either stale (reaped here) or owned by a tool that follows only the file protocol.
        reapLock(directory, { heldPort: port })
        if (createLockFile(paths, record)) {
          server = taken
          break
        }
        await releasePort(taken)
        /** File-protocol owner that still holds the lock file. */
        const file = inspectLock(paths.lock)
        refusal = { code: ExitCode.busy, text: WindowText.busy(file.record?.owner ?? 'unknown') }
      }
    }
    /** Milliseconds left before the wait deadline. */
    const remaining = waitUntil - Date.now()
    if (remaining > 0) await sleep(Math.min(pollSeconds, remaining / 1000))
  }
  // The child leads its own process group, so the cap and forwarded signals reach every
  // descendant. stdin is not inherited: a background group reading the terminal would stop.
  /** Child process running the measured command. */
  const child = spawn(options.command[0], options.command.slice(1), {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
    detached: true
  })
  /** Whether the window cap ended the run. */
  let timedOut = false
  /** SIGKILL escalation timer, armed once termination starts. */
  let killTimer
  /**
   * Starts terminating the whole group: SIGTERM now, SIGKILL after the grace period whether or not
   * the direct child has exited, so a child that ignores SIGTERM cannot outlive the cap.
   */
  const terminate = () => {
    if (killTimer !== undefined || child.pid === undefined) return
    signalGroup(child.pid, 'SIGTERM')
    killTimer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), killGraceSeconds * 1000)
  }
  /** Heartbeat failure, when the lock file could not be refreshed. */
  let heartbeatError
  /**
   * Lock-file heartbeat for file-protocol readers. A write failure (ENOSPC, EACCES) must not crash
   * the runner: that would free the port while the detached group keeps running. It ends the window
   * instead, through the same group termination as the cap.
   */
  const beat = setInterval(() => {
    try {
      heartbeat(paths, record)
    } catch (error) {
      if (heartbeatError !== undefined) return
      heartbeatError = error
      log(WindowText.heartbeatFailed(error.message))
      terminate()
    }
  }, heartbeatSeconds * 1000)
  /** Window cap enforcement. */
  const cap = setTimeout(() => {
    timedOut = true
    log(WindowText.timeout(maxSeconds))
    terminate()
  }, maxSeconds * 1000)
  /** Forwards an operator interrupt to the whole group; release happens after it exits. */
  const forward = (signal) => {
    if (child.pid !== undefined) signalGroup(child.pid, signal)
  }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  /** Child termination status. */
  const status = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: 127, error: error.message }))
    child.on('exit', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(cap)
  // Descendants may outlive the launcher; the window ends only when the whole group is gone.
  if (child.pid !== undefined) {
    if (groupAlive(child.pid)) terminate()
    await groupGone(child.pid)
  }
  clearTimeout(killTimer)
  clearInterval(beat)
  process.off('SIGINT', forward)
  process.off('SIGTERM', forward)
  /** Load observed at window end; reported, and a breach marks the window as environment error. */
  const endLoad = currentLoad(env)
  /** Exit code returned to the caller. */
  const exitCode = timedOut
    ? ExitCode.timeout
    : heartbeatError !== undefined
      ? ExitCode.heartbeatFailed
      : childExitCode(status)
  // The group is gone, so releasing the port is safe even if the bookkeeping below fails (for
  // example ENOSPC); the port is released last either way.
  try {
    rmSync(paths.lock, { force: true })
    appendHistory(paths.history, {
      released: new Date().toISOString(),
      releasedBy: 'owner',
      exitCode,
      signal: status.signal ?? null,
      endLoad,
      timedOut,
      heartbeatFailed: heartbeatError !== undefined,
      endLoadExceeded: endLoad > maxLoad,
      lock: record
    })
  } catch (error) {
    log(WindowText.bookkeepingFailed(error.message))
  } finally {
    await releasePort(server)
  }
  if (endLoad > maxLoad) log(WindowText.load(endLoad, maxLoad))
  return exitCode
}

/**
 * Classifies the window for status/check: the port holder first, then the lock file for tools that
 * follow only the file protocol.
 */
export async function windowState(env = process.env) {
  /** Mutex port for this machine. */
  const port = mutexPort(env)
  /** Probe of the kernel-held mutex. */
  const probe = await probePort(port)
  if (probe.state !== 'free') return probe
  /** File verdict, assuming the port is still free. */
  const verdict = classifyLock(lockPaths(lockDirectory(env)).lock, { freePort: port })
  if (!verdict.portReleased) return verdict
  // A window may have started between the probe and the read: its fresh record then names this
  // port. Probe again; a window still holding the port is reported as held. A window removes its
  // file before releasing the port, so a record read while no window holds the port is stale.
  /** Second probe, taken after the file was read. */
  const recheck = await probePort(port)
  return recheck.state === 'free' ? verdict : recheck
}

/** Parses CLI arguments into a command and options; unknown flags are usage errors. */
export function parseArgs(argv) {
  /** Subcommand name. */
  const [action, ...rest] = argv
  /** Parsed options. */
  const options = {}
  /** Index of the `--` separator before the command. */
  const separator = rest.indexOf('--')
  /** Flag arguments before the separator. */
  const flags = separator === -1 ? rest : rest.slice(0, separator)
  for (let index = 0; index < flags.length; index += 2) {
    /** Flag value. */
    const value = flags[index + 1]
    if (value === undefined) return { error: WindowText.usage }
    if (flags[index] === '--window') options.window = value
    else if (flags[index] === '--max-seconds') options.maxSeconds = Number(value)
    else if (flags[index] === '--max-load') options.maxLoad = Number(value)
    else if (flags[index] === '--wait') options.waitSeconds = Number(value)
    else return { error: WindowText.usage }
  }
  options.command = separator === -1 ? [] : rest.slice(separator + 1)
  /** First invalid numeric flag, reported as a usage error. */
  const invalid = invalidNumericOption(options)
  if (invalid) return { error: `${invalid}\n${WindowText.usage}` }
  return { action, options }
}

/** Maps a window classification to the status/check exit code. */
function stateExitCode(state) {
  if (state === 'free') return ExitCode.ok
  if (state === 'held') return ExitCode.held
  if (state === 'conflict') return ExitCode.portConflict
  return ExitCode.stale
}

/** CLI entry point. */
async function main() {
  /** Parsed CLI input. */
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`)
    return ExitCode.usage
  }
  /** Lock directory for status/check/reap. */
  const directory = lockDirectory()
  if (parsed.action === 'run') {
    if (parsed.options.command.length === 0) {
      process.stderr.write(`${WindowText.missingCommand}\n`)
      return ExitCode.usage
    }
    return runWindow(parsed.options)
  }
  if (parsed.action === 'status' || parsed.action === 'check') {
    mkdirSync(directory, { recursive: true })
    /** Current window classification. */
    const verdict = await windowState()
    if (parsed.action === 'status')
      process.stdout.write(
        `${JSON.stringify({ path: lockPaths(directory).lock, port: mutexPort(), ...verdict }, null, 2)}\n`
      )
    return stateExitCode(verdict.state)
  }
  if (parsed.action === 'reap') {
    mkdirSync(directory, { recursive: true })
    /** Reaping is only safe while holding the mutex port; a just-released port is retried. */
    let taken = await acquirePort(mutexPort(), () => '{}')
    for (let attempt = 0; taken === 'retry' && attempt < 3; attempt += 1)
      taken = await acquirePort(mutexPort(), () => '{}')
    if (taken === 'conflict') {
      process.stderr.write(`${WindowText.portConflict(mutexPort())}\n`)
      return ExitCode.portConflict
    }
    if (taken === 'held' || taken === 'retry') {
      process.stdout.write(`${WindowText.busy('a running window')}\n`)
      return ExitCode.held
    }
    /** Reap outcome. */
    const outcome = reapLock(directory, { heldPort: mutexPort() })
    await releasePort(taken)
    process.stdout.write(
      `${outcome.state === 'reaped' ? WindowText.reaped(outcome.reason) : outcome.state === 'free' ? WindowText.free : WindowText.busy(outcome.record?.owner ?? 'unknown')}\n`
    )
    return outcome.state === 'held' ? ExitCode.held : ExitCode.ok
  }
  process.stderr.write(`${WindowText.usage}\n`)
  return ExitCode.usage
}

/** True when this file is executed directly rather than imported by tests. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (invokedDirectly) process.exitCode = await main()
