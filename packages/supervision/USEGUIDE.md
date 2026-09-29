# Supervision usage guide

## A cooperative coroutine

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
      await new Promise<void>((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      // Close resources owned by this task before returning.
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: (error) => { console.error(error) }
})

const ready = await supervisor.start()
if (ready.state === 'ready') {
  const port = await ready.unit.exposed
  await port.call({ message: 'hello' })
}
await supervisor.dispose()
```

`expose(port)` may be called once. A second call throws a coded `TypeError` inside the task. If the task ends before exposure, `exposed` remains pending, so the readiness hook waits until the startup deadline. The task's own signal aborts on stop, replacement, and dispose. Async generators also receive one `return()` request. `exited` always fulfills with `{ outcome: 'fulfilled' }` or `{ outcome: 'rejected', error }`.

Cooperative termination depends on the task settling. A task that ignores cancellation can outlive the 5 second reap deadline. The supervisor reports `REAP_TIMEOUT`, records `abandoned`, and retains its budget lease until the task actually exits. It cannot preempt a synchronous loop or isolate a crash from the event loop. The `fault-isolation` capability is therefore `unsupported`; requests for it are rejected under the default `isolation: 'required'` policy.

`replace({ strategy: 'start-then-switch' })` needs a budget with room for two concurrent units. The old port stays usable until the candidate is ready and the `switched` event fires; then the old task receives cancellation. `replace({ spec })` validates the new specification before touching the active unit. The default strategy stops the old unit before launching the new one.

Use `heartbeat: { timeoutMs, intervalMs?, failureThreshold? }` when the task calls `heartbeat()` or yields from an async generator. A missed heartbeat becomes `UNHEALTHY` with `HEARTBEAT_MISSED` on its cause chain. `heartbeat` and the generic `health` option are mutually exclusive.

## A supervised process profile

`@migaia/supervision/process` is a platform-neutral contract. Supply an adapter whose
`launch(spec, context)` starts without a shell, transfers only the named `env.inherit` keys plus
`env.set`, drains every `drain` stream from startup through `context.output`, and fulfills
`handle.exited` only after the unit and adapter-owned resources have closed. The adapter must
generate a fingerprint that changes across pid reuse, terminate the declared process tree
idempotently, and report capability strengths honestly. The profile itself never calls a
platform spawn API.

```ts
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor, StdinMode, StdoutMode, StderrMode } from '@migaia/supervision/process'
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
  report: (error) => { console.error(error) }
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
1 second and three consecutive failures. Each output tail keeps the latest 65,536 bytes per
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
`restart()` and `replace()` bypass stale idle units.

## A supervised thread profile

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
  report: (error) => { console.error(error) }
})

const outcome = await supervisor.start()
if (outcome.state === 'ready') {
  // Use the adapter-owned channel associated with outcome.unit.
}
await supervisor.dispose()
```

The launcher must declare `termination: 'enforced'`, `fault-isolation: 'unsupported'`,
`heap-limit: 'enforced' | 'unsupported'`, and `exit-observation: 'enforced' | 'unsupported'`
truthfully. `heapBytes` is accepted only when `heap-limit` is enforced; `callWallTimeMs` is
passed unchanged to the launcher for its caller-facing operations. A launcher without enforced
exit observation requires a `health` check so a silent exit or stalled thread can be stopped.
The supervisor performs no heap sampling and has no separate graceful thread phase: it drains
the optional `beforeTerminate` hook, requests `terminate()` once, then waits up to the core
reap deadline for actual exit. An unconfirmed exit keeps its budget lease occupied.

Use `@migaia/supervision/process` when you need crash isolation, a CPU limit, durable orphan
recovery, or output draining. Thread code shares the host process and cannot provide those
guarantees. Platform adapters and their runtime-specific proof belong to their owning packages;
this profile does not assert that Bun, Deno, browser, or Electron thread termination has been
verified by its in-memory tests.
