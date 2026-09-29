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
