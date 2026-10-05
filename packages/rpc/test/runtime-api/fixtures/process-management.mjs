import assert from 'node:assert/strict'
import process from 'node:process'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '../../../dist/process/adapters/node-child-process.js'
import { createBunProcessLauncher } from '../../../dist/process/adapters/bun-spawn.js'
import { createDenoProcessLauncher } from '../../../dist/process/adapters/deno-command.js'

/** Each invocation uses the selected runtime's original launcher and real native children. */
const runtime = process.argv[2]
/** Deno Command and Bun's Node-compatible adapter retain their actual platform ownership. */
const launcher =
  runtime === 'deno'
    ? createDenoProcessLauncher()
    : runtime === 'bun'
      ? createBunProcessLauncher()
      : createNodeProcessLauncher()
/** The same runtime runs each child's allocation and native termination handlers. */
const command = process.execPath
/** Actual readiness is emitted only after memory is resident and SIGTERM handling is installed. */
const source = (mb, ignoreTerm) =>
  `globalThis.memory = new Uint8Array(${mb}*1024*1024).fill(7); ${
    runtime === 'deno'
      ? (ignoreTerm ? "Deno.addSignalListener('SIGTERM',()=>{});" : '') +
        "Deno.stderr.writeSync(new TextEncoder().encode('ready'));"
      : (ignoreTerm ? "process.on('SIGTERM',()=>{});" : '') + "process.stderr.write('ready');"
  } setInterval(()=>{},1000)`

/** Create one real supervisor, observing its existing output and exact terminate calls. */
async function started(mb, ignoreTerm, beforeTerminate) {
  /** The native readiness barrier prevents teardown from racing handler installation. */
  let ready
  const prepared = new Promise((resolve) => {
    ready = resolve
  })
  /** Calls are diagnostic fixture observations, never production lifecycle state. */
  const calls = []
  const budget = createUnitBudget({ kind: 'process', maxUnits: 1, launchRate: false })
  const supervisor = createProcessSupervisor({
    id: `management-${runtime}-${mb}`,
    launcher: {
      ...launcher,
      launch: async (spec, context) => {
        const handle = await launcher.launch(spec, context)
        return {
          ...handle,
          terminate: (mode) => {
            calls.push(mode)
            handle.terminate(mode)
          }
        }
      }
    },
    spec: {
      command,
      args: runtime === 'deno' ? ['eval', source(mb, ignoreTerm)] : ['-e', source(mb, ignoreTerm)],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }
    },
    output: { onChunk: () => ready() },
    ready: () => prepared,
    isolation: 'best-effort',
    restart: { mode: 'never' },
    budget,
    stop: {
      drainTimeoutMs: 20,
      exitTimeoutMs: 20,
      reapTimeoutMs: 1000,
      ...(beforeTerminate ? { beforeTerminate } : {})
    },
    report: () => undefined
  })
  const outcome = await supervisor.start()
  assert.equal(outcome.state, 'ready')
  return { supervisor, budget, calls, handle: outcome.unit }
}

/** Both live native PIDs provide independent current RSS and cumulative user/system CPU. */
const units = await Promise.all([started(8, true), started(48, true)])
try {
  assert.notEqual(units[0].handle.identity.pid, units[1].handle.identity.pid)
  for (const unit of units) {
    const sample = await unit.handle.sampleUsage()
    assert.ok(sample.rssBytes > 0, '[A44] RSS belongs to the selected actual PID')
    assert.ok(sample.cpuUserMicros >= 0 && sample.cpuSystemMicros >= 0)
    assert.equal(sample.cpuTimeMs, (sample.cpuUserMicros + sample.cpuSystemMicros) / 1000)
  }
  await units[0].supervisor.stop({ graceMs: 0 })
  assert.deepEqual(
    units[0].calls,
    ['graceful', 'force'],
    '[A46] stop(0) retains SIGTERM then SIGKILL'
  )
  assert.equal(units[0].supervisor.inspect().lastExit.status.signal, 'SIGKILL')
  await units[1].supervisor.kill()
  assert.deepEqual(units[1].calls, ['force'], '[A46] kill skips graceful termination')
  for (const unit of units) assert.equal(unit.budget.inUse, 0)
} finally {
  await Promise.all(units.map((unit) => unit.supervisor.dispose()))
}

/** A real pending drain is upgraded by the original force command, without a second stop owner. */
let entered
const draining = new Promise((resolve) => {
  entered = resolve
})
const held = await started(8, true, () => {
  entered()
  return new Promise(() => undefined)
})
try {
  const stop = held.supervisor.stop({ graceMs: 1000 })
  await draining
  assert.equal(held.supervisor.kill(), stop, '[A46] force joins the exact pending stop Promise')
  await stop
  assert.deepEqual(held.calls, ['force'])
  assert.equal(held.budget.inUse, 0)
} finally {
  await held.supervisor.dispose()
}

/** A successful graceful native exit must not be followed by an unnecessary force signal. */
const graceful = await started(8, false)
try {
  await graceful.supervisor.stop()
  assert.deepEqual(graceful.calls, ['graceful'])
  assert.equal(graceful.supervisor.inspect().lastExit.status.signal, 'SIGTERM')
  assert.equal(graceful.budget.inUse, 0)
} finally {
  await graceful.supervisor.dispose()
}
console.log(
  JSON.stringify({
    runtime,
    cases: ['A44-two-PID', 'A46-stop-zero', 'A46-kill', 'A46-pending-upgrade', 'A46-early-exit'],
    ok: true
  })
)
