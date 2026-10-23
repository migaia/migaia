# @migaia/supervision

[中文](./README.md)

Background tasks, child processes and worker threads fail sooner or later: they crash on startup, hang while still "running", or refuse to exit when you stop them. `@migaia/supervision` looks after them for you. It caps how many run at once, hands a unit to you only after it is actually ready, restarts it with a growing delay after a failure, and gives up with a clear error when failures pile up. Stopping is bounded in time, and a unit's slot is released only after the unit has really exited.

## Sound familiar?

- **Crash loops.** A child process exits right after start because of a bad config, and the restart in your `on('exit')` handler fires hundreds of times a second, flooding CPU and logs. The restart has no delay and no "give up after N failures" limit.
- **Hung but "running".** The process is alive but no longer handles anything. Listening for exit cannot catch this; something has to check periodically that it still makes progress.
- **Overlap or a gap during deploys.** Stop-then-start leaves a window where nobody serves requests; start-then-stop can let two versions consume the same job.
- **Shutdowns that hang, or orphans left behind.** A child ignores the exit signal and your deploy script waits forever; after the parent is killed, children keep holding memory.

## Start here

The formatter service below fails on its first two starts. The supervisor waits a little after each failure and tries again; `start()` returns `ready` only once the service is actually usable.

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let launches = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const formatter = createCoroutineSupervisor<{ format(text: string): string }>({
  id: 'formatter',
  budget,
  spec: {
    task: async ({ expose, signal }) => {
      launches += 1
      if (launches <= 2) throw new Error(`start ${launches} failed`)
      expose({ format: (text) => text.trim().replace(/\s+/g, ' ') })
      // Keep serving until the supervisor asks this task to stop.
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  restart: { initialDelayMs: 100 },
  report: console.error
})

const outcome = await formatter.start()
if (outcome.state === 'ready') {
  const service = await outcome.unit.exposed
  console.log(service.format('  hello    world  '), '| launches:', launches)
}
await formatter.dispose()
budget.close()
```

Output:

```text
hello world | launches: 3
```

Next steps:

- To supervise a real child process, read [USEGUIDE: Supervise a real child process](./USEGUIDE.en.md#supervise-a-real-child-process).
- To see what happens when failures pile up, read [USEGUIDE: Stop after too many crashes](./USEGUIDE.en.md#stop-after-too-many-crashes).
- To swap versions without downtime, read [USEGUIDE: Replace a unit without downtime](./USEGUIDE.en.md#replace-a-unit-without-downtime).

## What hand-written supervision gets wrong

Many projects "babysit" a child process with a few lines like these:

```ts doc-test=check
import { spawn, type ChildProcess } from 'node:child_process'

let child: ChildProcess = start()

function start(): ChildProcess {
  const proc = spawn('node', ['indexer.js'])
  // Pitfall 1: a process that crashes on start is restarted immediately, with no delay or limit.
  proc.on('exit', () => {
    child = start()
  })
  return proc
}

export async function shutdown(): Promise<void> {
  child.kill('SIGTERM')
  // Pitfall 2: if the process ignores SIGTERM, this never resolves and shutdown hangs.
  await new Promise((resolve) => child.once('exit', resolve))
  // Pitfall 3: the exit listener above is still active, so shutdown just started a new process.
}
```

With a supervisor, restart delay, restart limit, stop deadlines and "do not restart after stop" belong to one object, instead of being rewritten in every project.

## What makes it different

- **A unit that crashes on start is never restarted forever.** The first retry waits 250 ms and each later one doubles, up to 30 s. At most 5 automatic restarts happen within 60 s; the next failure moves the supervisor to `terminal` and sends a `SUPERVISION_EXHAUSTED` error to `report`. Your original error stays on its `cause` chain.
- **`stop()` returns on time even if the task ignores the stop signal.** Stopping has three phases: let the application drain, wait for a normal exit, then force and wait to reap. Each defaults to 5 s. The unit's slot, however, is released only when it really exits, so new work never piles onto a unit that has not finished stopping.
- **Replacement can start the new unit before stopping the old one.** `replace({ strategy: 'start-then-switch' })` switches only after the new unit is ready; the old unit receives its stop signal after the switch.
- **An old unit cannot pass itself off as the new one.** Every successful start gets a new `generation` number, so late results from an old unit never overwrite current state.
- **One set of rules for coroutines, threads and processes.** Platform differences live only in the launcher; restart, health and stop policies are written once and apply to all three.
- **Guarantees it cannot keep are reported up front.** A launcher must declare honestly what it can do, for example whether it can end a whole process tree. By default every guarantee is required and construction fails otherwise; you may opt into `best-effort`, and the missing guarantees appear in `inspect().degraded`.

## The model in three minutes

A supervised unit (one started coroutine, thread or child process) goes through these stages:

1. **Get a slot.** It asks a budget for a place. When the budget is full it queues or is rejected.
2. **Launch.** The launcher creates the unit from its spec.
3. **Confirm readiness.** If you supply `ready`, the supervisor waits for it. Missing the startup deadline (10 s by default) counts as a failed start.
4. **Run.** `start()` returns `ready`. With health checks configured, the supervisor checks the unit periodically.
5. **Fail.** A crash, repeated failed health checks or a resource limit ends the unit; the restart policy then backs off and retries, or moves to `terminal`.
6. **Stop.** `stop()`, `replace()` and `dispose()` end the unit within the three stop phases.
7. **Release the slot.** The slot returns to the budget only after the unit has really exited.

| Term | Meaning |
| --- | --- |
| unit | One started execution unit: a coroutine, a thread or a child process. |
| launcher | The code that actually creates a unit. Node, Bun, Deno and Electron create processes differently, so the application or an adapter package supplies it; this package handles everything after launch. |
| budget | Slots shared by a group of units: how many may run at once, how many may start per second, how long a request may queue. |
| spec | What a unit needs to start, such as a coroutine's task function or a process's command and arguments. |
| generation | The number of each start attempt. After a successful start it identifies the unit currently serving. |
| `ready` | Your readiness check, answering "can this unit be used now?". |
| `report` | Receives errors that are not thrown to a caller: entering terminal, cleanup failures, late failures and capability degradation. |

## Typical scenarios

| Scenario | Building blocks | Details |
| --- | --- | --- |
| Recover a crashed indexing or transcoding child process | `createProcessSupervisor` + the Node launcher from `@migaia/rpc-process` | [Supervise a real child process](./USEGUIDE.en.md#supervise-a-real-child-process) |
| Stop a crash loop caused by bad configuration | `restart.maxRestarts` + `report` | [Stop after too many crashes](./USEGUIDE.en.md#stop-after-too-many-crashes) |
| Restart a background scan that got stuck | Coroutine `heartbeat` | [Detect a stuck task with heartbeats](./USEGUIDE.en.md#detect-a-stuck-task-with-heartbeats) |
| Limit concurrent jobs during a bulk export | `createUnitBudget({ maxUnits })` | [Limit how many run at once](./USEGUIDE.en.md#limit-how-many-run-at-once) |
| Ship a new version without downtime | `replace({ strategy: 'start-then-switch' })` | [Replace a unit without downtime](./USEGUIDE.en.md#replace-a-unit-without-downtime) |
| Keep application shutdown from hanging | The three `stop` deadlines | [Bounded stop and slot release](./USEGUIDE.en.md#bounded-stop-and-slot-release) |
| Let children clean up when the parent dies; reclaim leftovers on the next start | `createParentLossGuard`, `reclaimOrphanProcesses` | [Parent loss and leftover processes](./USEGUIDE.en.md#parent-loss-and-leftover-processes) |
| Cut cold-start latency | `createPrewarmPool` | [Prewarm processes](./USEGUIDE.en.md#prewarm-processes) |

## Install

```bash
pnpm add @migaia/supervision
```

## Essential API

| API | Purpose |
| --- | --- |
| `createUnitBudget()` | Creates slots shared by a group of units. |
| `createCoroutineSupervisor()` | Supervises a cancellable task on the current event loop. |
| `createProcessSupervisor()` | Supervises a child process created by a launcher. |
| `createThreadSupervisor()` | Supervises a worker thread created by a launcher. |
| `start()` / `stop()` / `replace()` / `dispose()` | Start, stop, replace and permanently close. |
| `subscribe()` / `inspect()` | Observe state changes; read the current state and the last exit reason. |

See [USEGUIDE.en.md](./USEGUIDE.en.md) for complete usage.

## Contract details

Runtime-neutral supervision for execution units. The root entry owns unit budgets, attempts, active-unit lifecycle, bounded teardown, restart policy, health checks, capability admission, and observation. The `./coroutine` entry adds cooperative tasks; other unit profiles use the same root contracts.

Create a budget with `createUnitBudget({ kind, maxUnits })`, then pass that budget, a matching profile, a launcher, a specification, and a `report` callback to `createSupervisor`. Call `start()` and use the unit only when its result is `ready`. Call `dispose()` when finished. The complete coroutine example is in [USEGUIDE.en.md](./USEGUIDE.en.md).

The launcher must fulfill `handle.exited` only after its unit has stopped and its own resources are closed. `exited` never rejects. The profile validates specifications, declares required capabilities, terminates idempotently, and classifies fulfilled exit statuses. `report` receives terminal, cleanup, late rejection, and degraded-capability diagnostics. A health check that rejects its own failure while responding to cancellation is still reported after monitor closure; the exact cancellation reason need not be reported again. `inspect()` and `subscribe()` expose state without creating a unit.

Budgets return `{ kind: 'granted', lease }` or `{ kind: 'rejected', reason }`. Release each granted lease once; `release()` is idempotent. Closing a budget rejects pending and future admissions while existing leases remain held until their units actually exit. Nested budgets share the unit kind and release parent before child.

The default startup timeout is 10 seconds. A startup timeout follows the same restart/terminal policy as other startup failures and publishes a stable readiness result; acquireUnit failures are LAUNCH_FAILED with the original cause, even before a lease exists. Stop uses 5 seconds each for drain, graceful exit, and force reap. Restart defaults to `on-failure`, with 250 ms initial delay, factor 2, 30 seconds maximum delay, five restarts in 60 seconds. The default terminal policy stays terminal until explicit restart; a configured cooldown schedules one unref'd retry. Health checks default to a 5 second interval, 2 second check timeout, and three consecutive failures. Budget defaults are queue overflow, 30 second queue timeout, and eight grants per second. Supply a scheduler for deterministic timing.

The core depends only on `@migaia/lifecycle` and `@migaia/utils`. A profile may use `hooks.acquireUnit` for a preacquired unit, `hooks.afterLaunch` to own attachments, `hooks.onReady` to own monitors or fail the unit, and `hooks.inspectUnit` for a read-only snapshot. Attachments registered in `unit.scope` release after `exited`; monitors registered in `unit.monitors` release before termination. Unit-specific entry points belong beside, never inside, the root implementation.

Supervisor-created failures carry `source: 'supervision'` and one semantic `SupervisionErrorCode`; wrapped original failures remain on `cause`, and cleanup failures remain reachable through `errors`. Passive observer and late-check failures sent to `report` retain their original objects. States and budget outcomes are values, not thrown codes.

When a launcher explicitly declares `exit-observation: 'unsupported'`, forced termination immediately reports `EXIT_UNOBSERVABLE` and marks the generation abandoned without waiting for `reapTimeoutMs`. Details include kind, generation and capability. Its lease remains held until actual exit: an unavailable observation is not an exit receipt. Observable exit that misses its deadline still reports `REAP_TIMEOUT`; launch-phase recovery timeouts also retain their existing behavior.

The `./process` entry adds a shell-free specification, capability checks, usage monitoring,
bounded output tails, durable orphan records and recovery, a parent-loss guard, and an optional
bounded prewarm pool. It defines a launcher port and does not start an operating-system process
itself. See [USEGUIDE.en.md](./USEGUIDE.en.md) for the process contract, defaults and cleanup.

The `./threads` entry supervises a launcher-owned thread with the same core budget, restart,
health, replacement, and bounded release policy. The launcher declares `heap-limit` and
`exit-observation` as `enforced` or `unsupported`; a launcher without enforced exit observation
requires a health check. A thread is not a fault-isolation or CPU-limit boundary. Choose the
process profile when either guarantee is required. See [USEGUIDE.en.md](./USEGUIDE.en.md) for the
thread launcher contract and example.

`health.intervalMs` must be finite and greater than zero, so recurring health checks cannot run at a zero interval.

`startupTimeoutMs` may be zero for an immediate one-shot startup deadline.

`restart` selects a supported mode and bounded exponential backoff; unknown modes fail option admission.

`terminalPolicy` selects stay or cooldown; unknown modes fail option admission.

`isolation` accepts required or best-effort; unknown modes fail option admission.

`stop` defines drain, exit and reap phases. Their one-shot budgets may be zero for an immediate deadline.

An unknown replacement strategy throws coded `INVALID_OPTION` before enqueuing or retiring the serving unit. The prewarm pool snapshots its injected scheduler through the same lifecycle admission as the supervisor.
