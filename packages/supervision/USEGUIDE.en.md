# Supervision usage guide

[中文](./USEGUIDE.md)

The [README](./README.en.md) explains what the package is for, what sets it apart and the mental model. This guide starts with runnable examples organised by scenario, then describes the full contracts for coroutines, processes and threads.

## Find your scenario

| Your problem                                                          | Read                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A child process should restart after it crashes                       | [Supervise a real child process](#supervise-a-real-child-process)           |
| A bad config causes a crash loop; you want it to stop and show why    | [Stop after too many crashes](#stop-after-too-many-crashes)                 |
| A background task hangs without exiting                               | [Detect a stuck task with heartbeats](#detect-a-stuck-task-with-heartbeats) |
| Too many jobs start at once and the machine struggles                 | [Limit how many run at once](#limit-how-many-run-at-once)                   |
| A new version must ship without downtime                              | [Replace a unit without downtime](#replace-a-unit-without-downtime)         |
| Shutdown hangs on a task that will not exit                           | [Bounded stop and slot release](#bounded-stop-and-slot-release)             |
| Children outlive a killed parent; the next start spawns another batch | [Parent loss and leftover processes](#parent-loss-and-leftover-processes)   |
| Spawning a process on demand takes too long                           | [Prewarm processes](#prewarm-processes)                                     |

## Supervise a real child process

This package defines a public launcher interface and never calls operating-system APIs itself. Production transports provide real launchers. The user-written launcher below only illustrates that interface, using a timer-backed handle rather than creating a child process.

The example handle below always exits with code 3, 200 ms after starting, like an indexing service that reads a broken config. The supervisor waits between restarts; after 2 restarts it still fails, so the supervisor moves to `terminal` and stops trying.

```ts doc-test=run
import { createUnitBudget, CapabilityLevel, StandardCapability } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import type {
  IProcessLauncher,
  IProcessHandle,
  IProcessExitStatus
} from '@migaia/supervision/process'

/** This example owns only a timer and a completion receipt; it creates no OS process. */
class ExampleProcess implements IProcessHandle {
  /** Each launch has a distinct execution identity. */
  readonly identity = { fingerprint: crypto.randomUUID() }
  /** The completion settles once after the example timer has been cleared. */
  readonly exited: Promise<IProcessExitStatus>
  /** Only this handle may complete its original exit receipt. */
  #finish!: (status: IProcessExitStatus) => void
  /** The optional timer represents the demonstrated process crash. */
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(crashAfterMs?: number) {
    this.exited = new Promise((resolve) => {
      this.#finish = resolve
    })
    if (crashAfterMs !== undefined) this.#timer = setTimeout(() => this.#exit(3), crashAfterMs)
  }

  /** Repeated termination is harmless; the original exit Promise settles only once. */
  terminate(): void {
    this.#exit(0)
  }

  /** Stop the example resource before publishing its exit status. */
  #exit(code: number): void {
    clearTimeout(this.#timer)
    this.#finish({ code, signal: null })
  }
}

/** Production transports provide real launchers; this one only demonstrates the public port. */
const launcher: IProcessLauncher = {
  capabilities: {
    [StandardCapability.termination]: CapabilityLevel.enforced,
    [StandardCapability.faultIsolation]: CapabilityLevel.unsupported
  },
  async launch(_spec, context) {
    if (context.signal.aborted) throw context.signal.reason
    return new ExampleProcess(200)
  }
}

const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const indexer = createProcessSupervisor({
  id: 'search-indexer',
  launcher,
  budget,
  // The example declares no fault isolation; accept that capability gap explicitly.
  isolation: 'best-effort',
  spec: {
    command: process.execPath,
    args: ['-e', 'setTimeout(() => process.exit(3), 200)'],
    env: { inherit: [], set: {} },
    stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
  },
  restart: { initialDelayMs: 100, maxRestarts: 2 },
  report: (error) => console.log('report:', (error as { code?: string }).code)
})
indexer.subscribe((event) => {
  if (event.type === 'exit') console.log('exit:', event.reason, event.status)
  if (event.type === 'restart') console.log('restart', event.count, 'succeeded')
})

await indexer.start()
await new Promise((resolve) => setTimeout(resolve, 2000))
console.log('final state:', indexer.state)
await indexer.dispose()
budget.close()
```

Output:

```text
report: CAPABILITY_UNSUPPORTED
exit: crashed { code: 3, signal: null }
restart 1 succeeded
exit: crashed { code: 3, signal: null }
restart 2 succeeded
exit: crashed { code: 3, signal: null }
report: SUPERVISION_EXHAUSTED
final state: terminal
```

The first line, `CAPABILITY_UNSUPPORTED`, is a degradation notice. The example launcher declares that it provides no fault isolation. With `best-effort` the supervisor works normally, reports the gap once and records it in `inspect().degraded`. Without `isolation: 'best-effort'`, creating the supervisor throws this error instead.

"Restart succeeded" means the new process started; it says nothing about whether it crashes later. This example passes no `ready`, so a process counts as usable as soon as it starts. A real service should pass `ready`, for example waiting for a "ready" line on stdout or for one successful connection.

## Stop after too many crashes

Default rule: the first restart waits 250 ms and each later one doubles, up to 30 s. At most 5 automatic restarts happen within 60 s; the next failure moves the supervisor to `terminal`. At that point `report` receives `SUPERVISION_EXHAUSTED`, with your original error on its `cause` chain.

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
let launches = 0
const thumbnailer = createCoroutineSupervisor({
  id: 'thumbnailer',
  budget,
  spec: {
    task: async () => {
      launches += 1
      throw new Error('config file missing')
    }
  },
  restart: { initialDelayMs: 10, maxRestarts: 3 },
  report: (error) => {
    // Follow the cause chain all the way to the first error.
    const chain: string[] = []
    for (let current: any = error; current; current = current.cause)
      chain.push(current.code ?? current.message)
    console.log(chain.join(' <- '))
  }
})

const outcome = await thumbnailer.start()
console.log('start():', outcome.state, '| launches:', launches, '| slots in use:', budget.inUse)
await thumbnailer.dispose()
budget.close()
```

Output:

```text
SUPERVISION_EXHAUSTED <- LAUNCH_FAILED <- EXIT_UNEXPECTED <- config file missing
start(): terminal | launches: 4 | slots in use: 0
```

Four launches are the first start plus 3 restarts. `start()` never throws because a unit failed; it returns `terminal`. Failure details go to `report` and are readable from `inspect().lastExit` and `inspect().terminalError`.

Once `terminal`, the supervisor does not recover by itself unless you call `restart()`, or configure `terminalPolicy: { mode: 'cooldown', afterMs }` so it tries once more after a cool-down. `restart: { mode: 'never' }` sends every failure straight to `terminal`.

## Detect a stuck task with heartbeats

Listening for exit cannot catch a task that is stuck. A coroutine supervisor can require the task to call `heartbeat()` regularly. If no heartbeat arrives within `heartbeat.timeoutMs`, the run is declared unhealthy, ended and restarted under the restart rules.

The scanner below sends a heartbeat after each page. On its first run it gets stuck on page 3, waiting for a request that never returns.

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let run = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const scanner = createCoroutineSupervisor({
  id: 'page-scanner',
  budget,
  spec: {
    task: async ({ heartbeat, signal }) => {
      run += 1
      for (let page = 1; page <= 3; page++) {
        if (run === 1 && page === 3)
          // A stuck request. It honours the stop signal, so the supervisor can end it.
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        if (signal.aborted) return
        await new Promise((resolve) => setTimeout(resolve, 20))
        heartbeat()
        console.log(`run ${run}: page ${page} done`)
      }
    }
  },
  heartbeat: { timeoutMs: 100 },
  restart: { initialDelayMs: 50 },
  report: console.error
})
scanner.subscribe((event) => {
  if (event.type === 'exit') console.log('exit:', event.reason)
})

await scanner.start()
await new Promise((resolve) => setTimeout(resolve, 800))
await scanner.dispose()
budget.close()
```

Output:

```text
run 1: page 1 done
run 1: page 2 done
exit: unhealthy
run 2: page 1 done
run 2: page 2 done
run 2: page 3 done
exit: exited
```

A coroutine shares the event loop with the rest of your code, so the supervisor can only ask it to stop. A task stuck in a synchronous loop, or one that ignores the stop signal entirely, cannot be forced to end, and its slot is not released (see [Bounded stop and slot release](#bounded-stop-and-slot-release)). Use a child process when you need a forced stop.

Processes and threads have no `heartbeat` option. They use the generic `health: { check, intervalMs, timeoutMs, failureThreshold }`: by default a check every 5 s, 2 s per check, and 3 consecutive failures mean unhealthy. `heartbeat` and `health` cannot be combined.

## Limit how many run at once

A budget is a set of slots shared by several supervisors. When every slot is taken, a new start queues by default for up to 30 s; with `overflow: 'reject'` it returns `full` immediately. A budget also allows at most 8 starts per second by default, so a burst cannot start everything at once.

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

// Three export jobs share one budget; at most two run at the same time.
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
let running = 0
const exportFile = (name: string) =>
  createCoroutineSupervisor({
    id: `export-${name}`,
    budget,
    spec: {
      task: async () => {
        running += 1
        console.log(`exporting ${name}, running: ${running}`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        running -= 1
      }
    },
    restart: { mode: 'never' },
    report: console.error
  })

const jobs = ['a.csv', 'b.csv', 'c.csv'].map(exportFile)
await Promise.all(jobs.map((job) => job.start()))
await new Promise((resolve) => setTimeout(resolve, 300))
await Promise.all(jobs.map((job) => job.dispose()))
budget.close()
```

Output:

```text
exporting a.csv, running: 1
exporting b.csv, running: 2
exporting c.csv, running: 2
```

`c.csv` starts only after `a.csv` finishes and frees its slot. A budget serves one kind of unit: coroutines, threads and processes each need their own budget, and a mismatched `kind` fails supervisor creation with `INVALID_OPTION`.

## Replace a unit without downtime

`replace()` swaps the serving unit for a new one, optionally with a new spec such as new command arguments. The default `stop-then-start` stops the old unit first. `start-then-switch` starts the new unit first and switches only when it is ready; the old unit receives its stop signal after the switch. The latter needs a budget with room for two units.

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
let version = 0
const consumer = createCoroutineSupervisor<{ version: number }>({
  id: 'queue-consumer',
  budget,
  spec: {
    task: async ({ expose, signal }) => {
      const mine = ++version
      expose({ version: mine })
      console.log(`v${mine} consuming`)
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      console.log(`v${mine} stopped`)
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: console.error
})
consumer.subscribe((event) => {
  if (event.type === 'switched') console.log(`switched: generation ${event.from} -> ${event.to}`)
})

await consumer.start()
const outcome = await consumer.replace({ strategy: 'start-then-switch' })
console.log('replace():', outcome.kind)
await consumer.dispose()
budget.close()
```

Output:

```text
v1 consuming
v2 consuming
switched: generation 1 -> 2
v1 stopped
replace(): replaced
v2 stopped
```

If the new unit fails to start, `replace()` returns `{ kind: 'failed', error }` and the old unit keeps serving. A new spec is validated before the old unit is touched; an unknown strategy name throws `INVALID_OPTION` right away.

## Bounded stop and slot release

`stop()` has three phases, 5 s each by default:

1. **Application drain.** If you passed `stop.beforeTerminate`, it finishes in-flight work first (`drainTimeoutMs`).
2. **Normal exit.** The unit is asked to exit and the supervisor waits for the actual exit (`exitTimeoutMs`).
3. **Forced reap.** After a forced stop, the supervisor waits for actual exit (`reapTimeoutMs`) and reports `REAP_TIMEOUT` on expiry. If the launcher explicitly declares `exit-observation: 'unsupported'`, it immediately reports `EXIT_UNOBSERVABLE` and abandons that generation without waiting for this window. Details contain kind, generation and capability: `'exit-observation'`. Repeated disposal does not repeat the report.

`stop()` always returns within these deadlines. If the unit has not really exited, though, its slot stays occupied until it does, so new work never runs next to a unit that has not finished stopping.

`EXIT_UNOBSERVABLE` identifies a capability boundary, not a stuck thread or confirmed exit. Branch on source/code to distinguish it from `REAP_TIMEOUT`; choose another launcher when actual-exit guarantees are required. Best-effort admission's `CAPABILITY_UNSUPPORTED`, required-mode admission rejection and launch-phase timeouts remain unchanged.

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const job = createCoroutineSupervisor({
  id: 'export-job',
  budget,
  spec: {
    task: async () => {
      // Ignores the stop signal and ends on its own after 300 ms.
      await new Promise((resolve) => setTimeout(resolve, 300))
      console.log('task actually ended')
    }
  },
  stop: { drainTimeoutMs: 0, exitTimeoutMs: 50, reapTimeoutMs: 50 },
  report: (error) => console.log('report:', (error as { code?: string }).code)
})

await job.start()
await job.stop()
console.log('stop() returned, slots in use:', budget.inUse)
const attempt = budget.tryAcquire()
console.log('asking for a slot now:', attempt.kind === 'rejected' ? attempt.reason : attempt.kind)
await new Promise((resolve) => setTimeout(resolve, 400))
console.log('after the task ended, slots in use:', budget.inUse)
await job.dispose()
budget.close()
```

Output:

```text
report: REAP_TIMEOUT
stop() returned, slots in use: 1
asking for a slot now: full
task actually ended
after the task ended, slots in use: 0
```

`stop({ graceMs })` shortens only this call's drain phase. `kill()` skips the first two phases and forces the stop. You can `start()` again after `stop()`; after `dispose()` the supervisor is closed for good and `start()` is rejected.

## Parent loss and leftover processes

When a parent process is killed, its children never receive a normal stop request. Two things help:

- **In the child**, `createParentLossGuard` starts cleanup when the parent connection drops and guarantees an exit within `graceMs` (5 s by default). The exit code is 0 when cleanup completes and 1 on timeout or cleanup failure.
- **In the parent**, a durable registry records every child it starts. On the next start, call `reclaimOrphanProcesses` first to clean up what the previous run left behind. It ends only processes whose fingerprint still matches; if the old pid now belongs to another program, it removes the record without killing anything.

```ts doc-test=run
import { createParentLossGuard, reclaimOrphanProcesses } from '@migaia/supervision/process'
import type {
  IProcessLauncher,
  IProcessRecord,
  IProcessRegistry
} from '@migaia/supervision/process'

// Child side: once the parent is gone, clean up and exit within 1 second.
const guard = createParentLossGuard({
  graceMs: 1000,
  shutdown: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    console.log('progress saved')
  },
  exit: (code) => console.log('exit code:', code),
  report: console.error
})
guard.trigger() // In a real program, call this when the parent connection closes.
await new Promise((resolve) => setTimeout(resolve, 100))

// Parent side: an in-memory stand-in for durable storage; use a file or database in practice.
const records = new Map<string, IProcessRecord>([
  [
    'a',
    {
      id: 'a',
      namespace: 'indexer',
      identity: { fingerprint: 'boot-1:4101', pid: 4101 },
      launchedAt: 0
    }
  ],
  [
    'b',
    {
      id: 'b',
      namespace: 'indexer',
      identity: { fingerprint: 'boot-1:4102', pid: 4102 },
      launchedAt: 0
    }
  ]
])
const registry: IProcessRegistry = {
  add: async (record) => void records.set(record.id, record),
  remove: async (id) => void records.delete(id),
  list: async (namespace) =>
    [...records.values()].filter((record) => record.namespace === namespace)
}
// Reclaiming needs a launcher that can probe and end recorded processes; only those steps are faked here.
const launcher: IProcessLauncher = {
  capabilities: {},
  launch: () => Promise.reject(new Error('this launcher only reclaims')),
  probe: async (record) => (record.identity.pid === 4101 ? 'alive' : 'reused'),
  terminateRecord: async (record) => console.log('ending leftover process', record.identity.pid)
}
const result = await reclaimOrphanProcesses({
  registry,
  namespace: 'indexer',
  launcher,
  report: console.error
})
console.log('terminated:', result.terminated, '| records removed:', result.removed)
```

Output:

```text
progress saved
exit code: 0
ending leftover process 4101
terminated: [ 'a' ] | records removed: [ 'a', 'b' ]
```

Pass `registry: { port, namespace }` to `createProcessSupervisor` and the supervisor adds a record when it starts a process and removes it after the actual exit. With a registry, the launcher must implement `probe` and `terminateRecord`. A record that fails to reclaim is kept for the next attempt, and the failure is reported as `ORPHAN_RECLAIM_FAILED`.

## Prewarm processes

`createPrewarmPool` starts idle processes ahead of time. When a supervisor calls `start()`, it takes one instead of spawning, and still runs its `ready` check afterwards. The pool must use the same budget, launcher and spec objects as the supervisor, and every idle process occupies a budget slot.

```ts doc-test=run
import { createUnitBudget, CapabilityLevel, StandardCapability } from '@migaia/supervision'
import { createPrewarmPool, createProcessSupervisor } from '@migaia/supervision/process'
import type {
  IProcessSpec,
  IProcessLauncher,
  IProcessHandle,
  IProcessExitStatus
} from '@migaia/supervision/process'

/** This example owns only a timer and a completion receipt; it creates no OS process. */
class ExampleProcess implements IProcessHandle {
  /** Each launch has a distinct execution identity. */
  readonly identity = { fingerprint: crypto.randomUUID() }
  /** The completion settles once after the example timer has been cleared. */
  readonly exited: Promise<IProcessExitStatus>
  /** Only this handle may complete its original exit receipt. */
  #finish!: (status: IProcessExitStatus) => void
  /** The optional timer represents the demonstrated process crash. */
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(crashAfterMs?: number) {
    this.exited = new Promise((resolve) => {
      this.#finish = resolve
    })
    if (crashAfterMs !== undefined) this.#timer = setTimeout(() => this.#exit(3), crashAfterMs)
  }

  /** Repeated termination is harmless; the original exit Promise settles only once. */
  terminate(): void {
    this.#exit(0)
  }

  /** Stop the example resource before publishing its exit status. */
  #exit(code: number): void {
    clearTimeout(this.#timer)
    this.#finish({ code, signal: null })
  }
}

/** Production transports provide real launchers; this one only demonstrates the public port. */
const launcher: IProcessLauncher = {
  capabilities: {
    [StandardCapability.termination]: CapabilityLevel.enforced,
    [StandardCapability.faultIsolation]: CapabilityLevel.unsupported
  },
  async launch(_spec, context) {
    if (context.signal.aborted) throw context.signal.reason
    return new ExampleProcess()
  }
}

const budget = createUnitBudget({ kind: 'process', maxUnits: 2 })
const spec: IProcessSpec = {
  command: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  env: { inherit: [], set: {} },
  stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
}
const options = {
  id: 'renderer',
  launcher,
  budget,
  spec,
  isolation: 'best-effort' as const,
  report: () => undefined
}
const pool = createPrewarmPool({ ...options, size: 1 })
await new Promise((resolve) => setTimeout(resolve, 300))
console.log('idle processes:', pool.idle)

const renderer = createProcessSupervisor({ ...options, prewarm: pool })
const outcome = await renderer.start()
console.log('start():', outcome.state, '| idle left:', pool.idle)
await renderer.dispose()
await pool.dispose()
budget.close()
```

Output:

```text
idle processes: 1
start(): ready | idle left: 1
```

Taking an idle handle triggers replenishment. This example launcher returns immediately, so one idle handle has already been refilled when `start()` completes.

An idle process that nobody takes within 60 s (the default) is ended. `restart()` and `replace()` skip idle processes that may be stale and start fresh ones.

## Coroutine contract in full

```ts
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
type IEchoPort = { call(value: unknown): Promise<unknown> }
const supervisor = createCoroutineSupervisor<IEchoPort>({
  id: 'echo',
  budget,
  spec: {
    task: async ({ signal, expose, heartbeat }) => {
      const port = { call: async (value: unknown) => value }
      expose(port)
      heartbeat()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      // Close resources owned by this task before returning.
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: (error) => {
    console.error(error)
  }
})

const ready = await supervisor.start()
if (ready.state === 'ready') {
  const port = await ready.unit.exposed
  await port.call({ message: 'hello' })
}
await supervisor.dispose()
```

`expose(port)` may be called once. A second call throws a coded `TypeError` inside the task. If the task ends before exposure, `exposed` remains pending, so the readiness hook waits until the startup deadline. The task's own signal aborts on stop, replacement, and dispose. Async generators also receive one `return()` request. `exited` always fulfills with `{ outcome: 'fulfilled' }` or `{ outcome: 'rejected', error }`. For a custom AsyncIterable, a rejected return request is reported immediately, but exited remains pending until the outstanding next finishes. Its lease is retained until that actual exit.

Cooperative termination depends on the task settling. A task that ignores cancellation can outlive the 5 second reap deadline. The supervisor reports `REAP_TIMEOUT`, records `abandoned`, and retains its budget lease until the task actually exits. It cannot preempt a synchronous loop or isolate a crash from the event loop. The `fault-isolation` capability is therefore `unsupported`; requests for it are rejected under the default `isolation: 'required'` policy.

`replace({ strategy: 'start-then-switch' })` needs a budget with room for two concurrent units. The old port stays usable until the candidate is ready and the `switched` event fires; then the old task receives cancellation. `replace({ spec })` validates the new specification before touching the active unit. The default strategy stops the old unit before launching the new one.

Use `heartbeat: { timeoutMs, intervalMs?, failureThreshold? }` when the task calls `heartbeat()` or yields from an async generator. A missed heartbeat becomes `UNHEALTHY` with `HEARTBEAT_MISSED` on its cause chain. `heartbeat` and the generic `health` option are mutually exclusive.

## Process contract in full

`@migaia/supervision/process` is a platform-neutral contract. Supply an adapter whose
`launch(spec, context)` starts without a shell, transfers only the named `env.inherit` keys plus
`env.set`, drains every `drain` stream from startup through `context.output`, and fulfills
`handle.exited` only after the unit and adapter-owned resources have closed. The adapter must
generate a fingerprint that changes across pid reuse, terminate the declared process tree
idempotently, and report capability strengths honestly. The profile itself never calls a
platform spawn API.

```ts
import { createUnitBudget } from '@migaia/supervision'
import {
  createProcessSupervisor,
  StdinMode,
  StdoutMode,
  StderrMode
} from '@migaia/supervision/process'
import type { IProcessLauncher } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
const budget = createUnitBudget({ kind: 'process', maxUnits: 2 })
const supervisor = createProcessSupervisor({
  id: 'service',
  launcher,
  budget,
  spec: {
    command: '/usr/bin/service',
    args: [],
    env: { inherit: [], set: {} },
    stdio: { stdin: StdinMode.ignore, stdout: StdoutMode.drain, stderr: StderrMode.drain }
  },
  report: (error) => {
    console.error(error)
  }
})

const outcome = await supervisor.start()
if (outcome.state === 'ready') {
  // Use the adapter-owned channel carried by outcome.unit.
}
await supervisor.dispose()
```

The default isolation is `required`; a missing `termination` or `fault-isolation`
guarantee rejects construction with `CAPABILITY_UNSUPPORTED`. A caller may explicitly select
`best-effort` and inspect `degraded`, but this does not improve the adapter's actual
guarantees. A monitored memory or CPU limit requires `sampleUsage`; sampling defaults to
1 second. Three consecutive sampleUsage rejections mark the unit unhealthy; a successful sample exceeding a monitored limit terminates it immediately. The supervisor and prewarm pool both require a finite positive usage.intervalMs and a positive safe-integer failureThreshold. Each output tail keeps the latest 65,536 bytes per
stream. The parent-loss guard defaults to a 5 second shutdown grace period; prewarm idle units
default to 60 seconds.

Bootstrap bytes travel only as a stdin prefix or dedicated fd. Never put them in arguments,
environment, errors, snapshots or logs. The adapter must declare `bootstrap-stdin` or
`bootstrap-fd` as `unsupported` when it cannot prove that carrier safe. Electron
`utilityProcess` currently has neither approved bootstrap carrier. Windows tree termination
may be declared `enforced` only after an adapter has proved creation inside a Job Object, or
suspended creation followed by assignment and resume, including failure cleanup. The profile's
in-memory tests do not establish those platform guarantees.

For durable recovery, inject a registry and call `reclaimOrphanProcesses` before creating a
supervisor or pool. Recovery terminates only a record whose fingerprint still matches; reused
pids are removed without termination. Each failed record stays available for another attempt.
An optional prewarm pool uses the same budget, launcher and specification objects as its
supervisor. It starts idle units but the supervisor still performs readiness after taking one.
`restart()` and `replace()` bypass stale idle units. When pool and supervisor use the same id, registry port and namespace, adoption reuses the exact warm durable record and its actual-exit cleanup. Distinct owners register their own records. Output sink exceptions during buffered replay or live forwarding are reported without stopping delivery. A registry list failure is collected and reported as ORPHAN_RECLAIM_FAILED with detail.step set to list; no record is touched.

## Thread contract in full

`@migaia/supervision/threads` owns a runtime-neutral thread contract. Supply a launcher whose
`launch(spec, context)` creates a thread and returns an idempotently terminable handle. Its
`exited` promise must fulfill only after thread code stops executing, and must never reject.
An error event that leaves a Web-style thread running requires the adapter to terminate it and
fulfill `exited` with `{ code: null, error }`. A termination request or a runtime close marker
alone is not evidence of actual exit. If `context.signal` is already aborted, the launcher
must reject without creating a thread.

```ts
import { createUnitBudget } from '@migaia/supervision'
import { createThreadSupervisor, ThreadUnitKind } from '@migaia/supervision/threads'
import type { IThreadLauncher } from '@migaia/supervision/threads'

declare const launcher: IThreadLauncher
const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 2 })
const supervisor = createThreadSupervisor({
  id: 'compute',
  launcher,
  budget,
  spec: { entry: './compute-thread.js', limits: { heapBytes: 32 * 1024 * 1024 } },
  report: (error) => {
    console.error(error)
  }
})

const outcome = await supervisor.start()
if (outcome.state === 'ready') {
  // Use the adapter-owned channel associated with outcome.unit.
}
await supervisor.dispose()
```

The launcher must declare `termination: 'enforced' | 'monitored' | 'unsupported'` and `fault-isolation: 'unsupported'` truthfully. Required isolation accepts enforced or monitored termination, and rejects unsupported termination; a monitored declaration does not promise native enforcement. It also declares
`heap-limit: 'enforced' | 'unsupported'`, and `exit-observation: 'enforced' | 'unsupported'`
truthfully. `heapBytes` is accepted only when `heap-limit` is enforced; `callWallTimeMs` is
passed unchanged to the launcher for its caller-facing operations. A launcher without enforced
exit observation requires a `health` check so a silent exit or stalled thread can be stopped.
The supervisor performs no heap sampling and has no separate graceful thread phase: it drains
the optional `beforeTerminate` hook and requests `terminate()` once. Observable exit waits up to
the core reap deadline; explicitly unsupported exit observation reports `EXIT_UNOBSERVABLE`
immediately instead. Either abandoned outcome keeps its budget lease occupied until actual exit.

Use `@migaia/supervision/process` when you need crash isolation, a CPU limit, durable orphan
recovery, or output draining. Thread code shares the host process and cannot provide those
guarantees. Platform adapters and their runtime-specific proof belong to their owning packages;
this profile does not assert that Bun, Deno, browser, or Electron thread termination has been
verified by its in-memory tests.

`health.intervalMs` must be finite and greater than zero, so recurring health checks cannot run at a zero interval.

`startupTimeoutMs` may be zero for an immediate one-shot startup deadline.

`restart` selects a supported mode and bounded exponential backoff; unknown modes fail option admission.

`terminalPolicy` selects stay or cooldown; unknown modes fail option admission.

`isolation` accepts required or best-effort; unknown modes fail option admission.

`stop` defines drain, exit and reap phases. Their one-shot budgets may be zero for an immediate deadline.

An unknown replacement strategy throws coded `INVALID_OPTION` before enqueuing or retiring the serving unit. The prewarm pool snapshots its injected scheduler through the same lifecycle admission as the supervisor.
