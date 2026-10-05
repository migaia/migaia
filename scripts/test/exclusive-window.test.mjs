import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ExitCode,
  inspectLock,
  lockPaths,
  parseArgs,
  probePort,
  reapLock,
  runWindow
} from '../exclusive-window.mjs'

/** CLI entry under test. */
const script = resolve(dirname(fileURLToPath(import.meta.url)), '../exclusive-window.mjs')

/** Returns a loopback port that is free right now, so each test owns its own mutex. */
function freePort() {
  return new Promise((resolvePort) => {
    /** Throwaway server used only to let the kernel pick a port. */
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      /** Port the kernel assigned. */
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

/** Creates an isolated lock directory, mutex port and matching environment for one test. */
async function sandbox(extra = {}) {
  /** Fresh lock directory owned by this test. */
  const directory = mkdtempSync(join(tmpdir(), 'exclusive-window-'))
  /** Mutex port owned by this test. */
  const port = await freePort()
  return {
    directory,
    port,
    paths: lockPaths(directory),
    env: {
      ...process.env,
      MIGAIA_EXCLUSIVE_WINDOW_DIR: directory,
      MIGAIA_EXCLUSIVE_WINDOW_PORT: String(port),
      MIGAIA_EXCLUSIVE_WINDOW_LOAD: '0',
      ...extra
    }
  }
}

/** Reads the append-only history as parsed entries. */
function history(paths) {
  return existsSync(paths.history)
    ? readFileSync(paths.history, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : []
}

/** Reports whether a pid still exists; signal 0 only probes. */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Resolves after the given number of milliseconds. */
function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

/** Polls until `predicate` holds or the deadline passes; returns whether it held. */
async function eventually(predicate, ms = 5000) {
  /** Moment after which polling stops. */
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await delay(50)
  }
  return false
}

test('run acquires, propagates the child exit code, releases and records history', async () => {
  /** Isolated environment. */
  const { paths, port, env } = await sandbox()
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['node', '-e', 'process.exit(3)'],
    window: 'w1',
    env,
    log: () => {}
  })
  assert.equal(code, 3)
  assert.equal(existsSync(paths.lock), false)
  assert.equal((await probePort(port)).state, 'free')
  /** History written on release. */
  const entries = history(paths)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].releasedBy, 'owner')
  assert.equal(entries[0].exitCode, 3)
  assert.equal(entries[0].lock.window, 'w1')
  assert.equal(entries[0].lock.host, hostname())
  for (const field of ['owner', 'pid', 'startUTC', 'heartbeatUTC', 'expectedEnd'])
    assert.ok(field in entries[0].lock, field)
})

test('two runners never overlap: the second is busy while the first holds the port', async () => {
  /** Isolated environment. */
  const { port, env } = await sandbox()
  /** First window, holding the mutex for a while. */
  const first = runWindow({
    command: ['node', '-e', 'setTimeout(() => {}, 1500)'],
    window: 'first',
    env: { ...env, MIGAIA_EXCLUSIVE_WINDOW_OWNER: 'first' },
    log: () => {}
  })
  assert.ok(await eventually(async () => (await probePort(port)).state === 'held'))
  /** Lines logged by the second runner. */
  const lines = []
  /** Exit code of the second runner. */
  const second = await runWindow({
    command: ['node', '-e', ''],
    env,
    log: (line) => lines.push(line)
  })
  assert.equal(second, ExitCode.busy)
  assert.match(lines[0], /held by first/)
  assert.equal(await first, 0)
})

test('a lock file held by a live file-protocol owner makes run busy without running', async () => {
  /** Isolated environment. */
  const { paths, env } = await sandbox()
  writeFileSync(
    paths.lock,
    JSON.stringify({
      owner: 'other',
      host: hostname(),
      pid: process.pid,
      heartbeatUTC: new Date().toISOString()
    })
  )
  /** Marker file the command would create if it ran. */
  const marker = join(tmpdir(), `exclusive-window-marker-${process.pid}-${Date.now()}`)
  /** Lines logged by the runner. */
  const lines = []
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`],
    env,
    log: (line) => lines.push(line)
  })
  assert.equal(code, ExitCode.busy)
  assert.equal(existsSync(marker), false)
  assert.match(lines[0], /held by other/)
  assert.equal(existsSync(paths.lock), true)
})

test('a runner killed with SIGKILL frees the mutex, and its leftover lock file is reaped', async () => {
  /** Isolated environment. */
  const { paths, port, env } = await sandbox()
  /** Unique marker so cleanup kills only this test's orphaned command. */
  const marker = `exclusive-window-orphan-${process.pid}-${Date.now()}`
  /** Runner process that will be killed. */
  const runner = spawn(
    process.execPath,
    [script, 'run', '--', 'node', '-e', `setTimeout(() => {}, 60000) // ${marker}`],
    { env, stdio: 'ignore' }
  )
  assert.ok(await eventually(() => existsSync(paths.lock)))
  assert.equal(JSON.parse(readFileSync(paths.lock, 'utf8')).pid, runner.pid)
  runner.kill('SIGKILL')
  assert.ok(await eventually(async () => (await probePort(port)).state === 'free'))
  // The orphaned command group keeps running (documented limitation); stop it for hygiene.
  spawnSync('pkill', ['-f', marker])
  /** Exit code of the next runner. */
  const code = await runWindow({ command: ['node', '-e', ''], env, log: () => {} })
  assert.equal(code, 0)
  assert.equal(history(paths)[0].releasedBy, 'reap')
})

test('an unrelated service on the mutex port is a conflict, not a wait', async () => {
  /** Isolated environment. */
  const { port, env } = await sandbox()
  /** Stranger listening on the port. */
  const stranger = createServer((socket) => socket.end('hello\n'))
  await new Promise((resolveListen) => stranger.listen(port, '127.0.0.1', resolveListen))
  try {
    /** Exit code returned by the window. */
    const code = await runWindow({
      command: ['node', '-e', ''],
      waitSeconds: 5,
      env,
      log: () => {}
    })
    assert.equal(code, ExitCode.portConflict)
  } finally {
    await new Promise((resolveClose) => stranger.close(resolveClose))
  }
})

test('a lock with a stale heartbeat and no provable owner is reaped and archived', async () => {
  /** Isolated environment. */
  const { directory, paths } = await sandbox()
  /** Legacy-format lock seen in practice: epoch heartbeat, no pid. */
  const legacy = {
    owner: 'runtime-api-prototype',
    startedAt: 1,
    heartbeatAt: (Date.now() - 3600_000) / 1000,
    maxWindowSeconds: 2700
  }
  writeFileSync(paths.lock, JSON.stringify(legacy))
  assert.equal(inspectLock(paths.lock).state, 'stale')
  /** Reap outcome. */
  const outcome = reapLock(directory)
  assert.equal(outcome.state, 'reaped')
  assert.equal(existsSync(paths.lock), false)
  assert.equal(history(paths)[0].lock.owner, 'runtime-api-prototype')
})

test('a pid-less owner that refreshes its heartbeat during reaping keeps its lock', async () => {
  /** Isolated environment. */
  const { directory, paths } = await sandbox()
  /** Same owner, first with an old heartbeat, then refreshed. */
  const owner = { owner: 'legacy', startUTC: '2026-10-05T00:00:00Z' }
  writeFileSync(paths.lock, JSON.stringify({ ...owner, heartbeatUTC: '2000-01-01T00:00:00Z' }))
  /** Reap outcome when the heartbeat is refreshed between verdict and rename. */
  const outcome = reapLock(directory, {
    afterVerdict: () =>
      writeFileSync(
        paths.lock,
        JSON.stringify({ ...owner, heartbeatUTC: new Date().toISOString() })
      )
  })
  assert.equal(outcome.state, 'held')
  assert.equal(inspectLock(paths.lock).state, 'held')
  assert.equal(history(paths).length, 0)
})

test('a fresh heartbeat is held even when the pid is unknown, and an alive owner is held even when old', async () => {
  /** Isolated environment. */
  const { directory, paths } = await sandbox()
  writeFileSync(paths.lock, JSON.stringify({ owner: 'x', heartbeatUTC: new Date().toISOString() }))
  assert.equal(reapLock(directory).state, 'held')
  writeFileSync(
    paths.lock,
    JSON.stringify({
      owner: 'y',
      host: hostname(),
      pid: process.pid,
      heartbeatUTC: '2000-01-01T00:00:00Z'
    })
  )
  assert.equal(reapLock(directory).state, 'held')
  assert.equal(existsSync(paths.lock), true)
})

test('an unreadable lock is held while recent and stale only after the stale period', async () => {
  /** Isolated environment. */
  const { paths } = await sandbox()
  writeFileSync(paths.lock, '{"owner": "partial')
  assert.equal(inspectLock(paths.lock).state, 'held')
  /** An old modification time. */
  const old = new Date(Date.now() - 3600_000)
  utimesSync(paths.lock, old, old)
  assert.equal(inspectLock(paths.lock).state, 'stale')
})

test('load above the ceiling refuses to start and leaves no lock', async () => {
  /** Isolated environment with injected high load. */
  const { paths, env } = await sandbox({ MIGAIA_EXCLUSIVE_WINDOW_LOAD: '9' })
  /** Exit code returned by the window. */
  const code = await runWindow({ command: ['node', '-e', ''], maxLoad: 5, env, log: () => {} })
  assert.equal(code, ExitCode.load)
  assert.equal(existsSync(paths.lock), false)
})

test('the window cap terminates the whole process tree', async () => {
  /** Isolated environment. */
  const { directory, paths, env } = await sandbox()
  /** File where the launcher records its background grandchild pid. */
  const pidFile = join(directory, 'grandchild.pid')
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['sh', '-c', `sleep 60 & echo $! > ${JSON.stringify(pidFile)}; wait`],
    maxSeconds: 1,
    env,
    log: () => {}
  })
  assert.equal(code, ExitCode.timeout)
  assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), false)
  assert.equal(history(paths)[0].timedOut, true)
})

test('a child that ignores SIGTERM is killed after the grace period', async () => {
  /** Isolated environment. */
  const { env } = await sandbox()
  /** Moment the window started. */
  const begin = Date.now()
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['node', '-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    maxSeconds: 1,
    killGraceSeconds: 0.5,
    env,
    log: () => {}
  })
  assert.equal(code, ExitCode.timeout)
  assert.ok(Date.now() - begin < 5000)
})

test('the window is released only after descendants that outlive the launcher are gone', async () => {
  /** Isolated environment. */
  const { directory, paths, env } = await sandbox()
  /** File where the launcher records its background grandchild pid. */
  const pidFile = join(directory, 'grandchild.pid')
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['sh', '-c', `sleep 60 & echo $! > ${JSON.stringify(pidFile)}; exit 0`],
    env,
    log: () => {}
  })
  assert.equal(code, 0)
  assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), false)
  assert.equal(existsSync(paths.lock), false)
})

test('a child killed by a signal returns 128 plus the signal number', async () => {
  /** Isolated environment. */
  const { env } = await sandbox()
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['node', '-e', "process.kill(process.pid, 'SIGTERM')"],
    env,
    log: () => {}
  })
  assert.equal(code, 143)
})

test('waiting re-checks load and records the load and start time of the real start', async () => {
  /** Isolated environment with injected high load. */
  const { paths, env } = await sandbox({ MIGAIA_EXCLUSIVE_WINDOW_LOAD: '9' })
  /** Moment the wait began. */
  const begin = Date.now()
  setTimeout(() => {
    env.MIGAIA_EXCLUSIVE_WINDOW_LOAD = '1'
  }, 300)
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['node', '-e', ''],
    waitSeconds: 5,
    pollSeconds: 0.05,
    env,
    log: () => {}
  })
  assert.equal(code, 0)
  /** Lock record of the window that actually ran. */
  const record = history(paths)[0].lock
  assert.equal(record.startLoad, 1)
  assert.ok(Date.parse(record.startUTC) >= begin + 250)
})

test('load that stays high through the wait returns the load code without running', async () => {
  /** Isolated environment with injected high load. */
  const { paths, env } = await sandbox({ MIGAIA_EXCLUSIVE_WINDOW_LOAD: '9' })
  /** Exit code returned by the window. */
  const code = await runWindow({
    command: ['node', '-e', ''],
    waitSeconds: 0.3,
    pollSeconds: 0.05,
    env,
    log: () => {}
  })
  assert.equal(code, ExitCode.load)
  assert.equal(existsSync(paths.lock), false)
})

test('non-finite or out-of-range numbers are usage errors', async () => {
  for (const args of [
    ['--max-load', 'abc'],
    ['--wait', 'abc'],
    ['--max-seconds', '0'],
    ['--wait', '-1'],
    ['--max-load', 'Infinity']
  ])
    assert.ok(parseArgs(['run', ...args, '--', 'x']).error, args.join(' '))
  /** Isolated environment. */
  const { paths, env } = await sandbox()
  assert.equal(
    await runWindow({ command: ['node', '-e', ''], maxLoad: Number.NaN, env, log: () => {} }),
    ExitCode.usage
  )
  assert.equal(existsSync(paths.lock), false)
})

test('CLI check and status report free, held and stale states with distinct exit codes', async () => {
  /** Isolated environment. */
  const { paths, env } = await sandbox()
  /** Runs the CLI with the sandbox environment. */
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
  assert.equal(cli('check').status, ExitCode.ok)
  writeFileSync(
    paths.lock,
    JSON.stringify({
      owner: 'z',
      host: hostname(),
      pid: process.pid,
      heartbeatUTC: new Date().toISOString()
    })
  )
  assert.equal(cli('check').status, ExitCode.held)
  writeFileSync(paths.lock, JSON.stringify({ owner: 'z', heartbeatUTC: '2000-01-01T00:00:00Z' }))
  assert.equal(cli('check').status, ExitCode.stale)
  assert.match(cli('status').stdout, /"state": "stale"/)
  assert.equal(cli('run', '--window', 'w').status, ExitCode.usage)
})

test('parseArgs separates flags from the command and rejects unknown flags', () => {
  assert.deepEqual(
    parseArgs(['run', '--window', 'a', '--max-load', '4', '--', 'pnpm', 'test']).options,
    {
      window: 'a',
      maxLoad: 4,
      command: ['pnpm', 'test']
    }
  )
  assert.ok(parseArgs(['run', '--bogus', '1', '--', 'x']).error)
})

test('a heartbeat write failure ends the window through group termination, then frees the port', async () => {
  /** Isolated environment. */
  const { directory, port, env } = await sandbox()
  /** File where the command records its own pid. */
  const pidFile = join(tmpdir(), `exclusive-window-hb-${process.pid}-${Date.now()}.pid`)
  // Make the lock directory read-only once the window has started, so the heartbeat fails.
  setTimeout(() => chmodSync(directory, 0o500), 300)
  try {
    /** Lines logged by the runner. */
    const lines = []
    /** Exit code returned by the window. */
    const code = await runWindow({
      command: [
        'node',
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`
      ],
      heartbeatSeconds: 0.5,
      killGraceSeconds: 0.5,
      env,
      log: (line) => lines.push(line)
    })
    assert.equal(code, ExitCode.heartbeatFailed)
    assert.ok(lines.some((line) => /heartbeat failed/.test(line)))
    assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), false)
    assert.equal((await probePort(port)).state, 'free')
  } finally {
    chmodSync(directory, 0o700)
  }
})

test('--wait never starts after its deadline, even with a long poll period', async () => {
  /** Isolated environment. */
  const { port, env } = await sandbox()
  /** First window holding the mutex past the second runner's deadline. */
  const first = runWindow({
    command: ['node', '-e', 'setTimeout(() => {}, 2500)'],
    env,
    log: () => {}
  })
  assert.ok(await eventually(async () => (await probePort(port)).state === 'held'))
  /** Moment the second runner began waiting. */
  const begin = Date.now()
  /** Exit code of the second runner. */
  const second = await runWindow({
    command: ['node', '-e', ''],
    waitSeconds: 0.5,
    pollSeconds: 5,
    env,
    log: () => {}
  })
  assert.equal(second, ExitCode.busy)
  assert.ok(Date.now() - begin < 2000)
  assert.equal(await first, 0)
})

test('a leftover lock file from an earlier window of this same process does not block it', async () => {
  /** Isolated environment. */
  const { paths, port, env } = await sandbox()
  // What a failed release leaves behind: this process's pid and a port-protocol record.
  writeFileSync(
    paths.lock,
    JSON.stringify({
      owner: 'earlier',
      host: hostname(),
      pid: process.pid,
      port,
      startUTC: '2026-10-05T00:00:00Z',
      heartbeatUTC: new Date().toISOString()
    })
  )
  /** Exit code of the next window in the same process. */
  const code = await runWindow({ command: ['node', '-e', ''], env, log: () => {} })
  assert.equal(code, 0)
  assert.equal(history(paths)[0].releasedBy, 'reap')
  assert.equal(history(paths)[0].lock.owner, 'earlier')
})

test('a live file-protocol lock without a port field is still respected by a port holder', async () => {
  /** Isolated environment. */
  const { paths, env } = await sandbox()
  writeFileSync(
    paths.lock,
    JSON.stringify({ owner: 'python-window', host: hostname(), pid: process.pid })
  )
  /** Exit code returned by the window. */
  const code = await runWindow({ command: ['node', '-e', ''], env, log: () => {} })
  assert.equal(code, ExitCode.busy)
  assert.equal(existsSync(paths.lock), true)
})

test('a live window on a different port is never reaped by a holder of another port', async () => {
  /** Isolated environment. */
  const { directory, paths, port } = await sandbox()
  writeFileSync(
    paths.lock,
    JSON.stringify({ owner: 'other-port', host: hostname(), pid: process.pid, port: port + 1 })
  )
  /** Reap outcome while holding `port`. */
  const outcome = reapLock(directory, { heldPort: port })
  assert.equal(outcome.state, 'held')
  assert.equal(JSON.parse(readFileSync(paths.lock, 'utf8')).owner, 'other-port')
})

test('status and check report an ended window of this port as stale, not held', async () => {
  /** Isolated environment. */
  const { paths, port, env } = await sandbox()
  // Leftover record of this port whose pid is alive (the test process), but the port is free.
  writeFileSync(
    paths.lock,
    JSON.stringify({
      owner: 'ended',
      host: hostname(),
      pid: process.pid,
      port,
      heartbeatUTC: new Date().toISOString()
    })
  )
  /** Runs the CLI with the sandbox environment. */
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
  assert.equal(cli('check').status, ExitCode.stale)
  assert.match(cli('status').stdout, /"state": "stale"/)
})
