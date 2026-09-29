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
