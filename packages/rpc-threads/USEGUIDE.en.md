# `@migaia/rpc-threads` Usage guide

Run functions in real Workers while keeping Worker ownership separate from borrowed message ports. Start with the [README](./README.en.md).

## Find a scenario

| Task                                                                         | How to combine                                                   | Complete example                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Run work on a real Worker without confusing it with another process          | isThreadChild → createThreadPeer → request → close               | [Code and output](#run-work-on-a-real-worker-without-confusing-it-with-another-process)          |
| Call the parent and consume Worker results through one connection            | provide → request / stream → close                               | [Code and output](#call-the-parent-and-consume-worker-results-through-one-connection)            |
| Fail a stuck call at its deadline or cancel it midway                        | request + timeoutMs / signal                                     | [Code and output](#fail-a-stuck-call-at-its-deadline-or-cancel-it-midway)                        |
| Fail in-flight calls at once when the Worker crashes                         | request → Worker exits → REMOTE_RESULT_UNKNOWN                   | [Code and output](#fail-in-flight-calls-at-once-when-the-worker-crashes)                         |
| Get the error class, code and cause back from the Worker                     | provider throws → request catches                                | [Code and output](#get-the-error-class-code-and-cause-back-from-the-worker)                      |
| Reject calls beyond the Worker's limit instead of queueing them              | providerLimits → request → OVERLOADED                            | [Code and output](#reject-calls-beyond-the-workers-limit-instead-of-queueing-them)               |
| Keep copied bytes usable when unsigned RPC transfer is refused               | request → transfer admission → request                           | [Code and output](#keep-copied-bytes-usable-when-unsigned-rpc-transfer-is-refused)               |
| Call a restarted Worker as soon as its Host reports ready                    | createThreadPlugin → host.use → restart → request → dispose      | [Code and output](#call-a-restarted-worker-as-soon-as-its-host-reports-ready)                    |
| Close a borrowed channel while keeping its native port usable                | createNodeThreadChannel → subscribe → close → native postMessage | [Code and output](#close-a-borrowed-channel-while-keeping-its-native-port-usable)                |
| Retain captured bytes across a real native transfer and observer replacement | transport.observe → send(transfer) → replace / stop              | [Code and output](#retain-captured-bytes-across-a-real-native-transfer-and-observer-replacement) |

## Before running

Save each complete example as its own .ts file and run it with Node 24. Self spawn re-executes that file, so retain the child guard. These examples require no browser authorization and do not establish Electron or Web Worker exit capabilities.

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract @migaia/plugin-host @migaia/utils
```

PluginHost is used by the Host scenario; utils supplies the scheduler for the two channel scenarios. Each example releases its owned resources, and the caller closes borrowed native ports separately.

## Run work on a real Worker without confusing it with another process

CPU work should leave the main thread, but a returned number does not identify where it ran.

Reexecuting the same entry without a child branch creates more Workers, while checking only process ids cannot distinguish threads of one Node process.

Await isThreadChild(), provide methods in the Worker, and spawn the real current file; compare both native process and thread identities.

### Example parameters

spawn: true reuses the current entry. Omitted self uses a generated thread identity; omitted provide exposes no application methods. provide.double takes a number and identity returns native process.pid / threadId. TRemote describes remote methods only. The default call deadline is 30000 ms and report uses the default diagnostic output.

```ts doc-test=run
import { threadId } from 'node:worker_threads'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { double(value: number): number; identity(): { pid: number; threadId: number } }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      double: (value: number) => value * 2,
      identity: () => ({ pid: process.pid, threadId })
    }
  })
} else {
  const worker = await createThreadPeer<IWorkerApi>({ spawn: true })
  try {
    console.log(await worker.request('double', 21))
    const identity = await worker.request('identity')
    console.log(identity.pid === process.pid)
    console.log(identity.threadId !== threadId)
  } finally {
    await worker.close()
  }
}
```

Output:

```text
42
true
true
```

Output is `42`, `true`, `true`: the result is correct, process ids match, and native thread ids differ.

This proves a real Node Worker within one process; it does not provide process isolation, and the owning Peer must close the Worker explicitly.

## Call the parent and consume Worker results through one connection

A Worker needs a parent-owned operation while also exposing a sequence of task results.

Separate postMessage routes require their own correlation and cleanup, and collecting the whole sequence delays access to its individual values.

Provide the parent method, await its request from the Worker, and expose an async generator for stream(); the parent closes one owner afterward.

### Example parameters

The parent's provide.prefix accepts a string. The Worker's label awaits the reverse request, while count takes limit and returns an async generator. The stream sends when consumed; 3 bounds this sequence. Unset source, deadline, and close rules are unchanged from the first example.

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IParentApi = { prefix(value: string): string }
type IWorkerApi = {
  label(value: string): Promise<string>
  count(limit: number): AsyncGenerator<number>
}
if (await isThreadChild()) {
  const parent = createThreadPeer<IParentApi>({
    provide: {
      label: async (value: string): Promise<string> => (await parent).request('prefix', value),
      count: async function* (limit: number) {
        for (let value = 1; value <= limit; value++) yield value
      }
    }
  })
  await parent
} else {
  const worker = await createThreadPeer<IWorkerApi>({
    spawn: true,
    provide: { prefix: (value: string) => 'main:' + value }
  })
  try {
    console.log(await worker.request('label', 'job'))
    const values: number[] = []
    for await (const value of worker.stream('count', 3)) values.push(value)
    console.log(values.join(','))
  } finally {
    await worker.close()
  }
}
```

Output:

```text
main:job
1,2,3
```

Output is `main:job` and `1,2,3`: one request crosses back to the parent and the stream supplies three values.

These are separate methods on the same connection; streams are lazy until iteration, and notify completion would not acknowledge provider completion.

## Fail a stuck call at its deadline or cancel it midway

The main thread hands report rendering to a Worker. One input is too large and the Worker never finishes, or the user has already pressed "Cancel" and no longer needs the result.

A typical `postMessage` wrapper resolves only when a reply arrives. If the Worker gets stuck, that Promise stays pending forever. For a timeout you wrap it again in `Promise.race` and must remember to delete the entry from your callback table when time runs out. For cancellation you design another "cancel" message and teach the Worker to recognize it.

Here every `request` has a 30-second deadline by default, which `timeoutMs` overrides per call, and passing an `AbortSignal` cancels it. Both reject the call with a native error that carries a `code`.

### Example parameters

`render` takes about 20 ms per page, so 500 pages take about 10 seconds. The first call renders only 2 pages and returns normally. The second sets `timeoutMs: 100`. The third calls `controller.abort()` after 50 ms.

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IReportApi = { render(pages: number): Promise<string> }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      render: (pages: number) =>
        new Promise<string>((resolve) => setTimeout(() => resolve(`${pages} pages`), pages * 20))
    }
  })
} else {
  const worker = await createThreadPeer<IReportApi>({ spawn: true })
  try {
    console.log(await worker.request('render', 2))
    try {
      await worker.request('render', 500, { timeoutMs: 100 })
    } catch (error) {
      const failure = error as Error & { code?: string }
      console.log(failure.name, failure.code)
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    try {
      await worker.request('render', 500, { signal: controller.signal })
    } catch (error) {
      const failure = error as Error & { code?: string }
      console.log(failure.name, failure.code)
    }
  } finally {
    await worker.close()
  }
}
```

Output:

```text
2 pages
TimeoutError DEADLINE_EXCEEDED
AbortError CANCELLED
```

The normal call returns as usual. The call that runs out of time rejects with `TimeoutError`, the cancelled call with `AbortError`, and both carry a `code` you can branch on.

A deadline or cancellation only ends the caller's wait. It does not interrupt a function that has already started in the Worker; that function runs to completion and keeps its concurrency slot until then. So neither a timeout nor a cancellation proves the Worker did nothing, and a non-idempotent operation must be reconciled before it is retried. To stop the computation right away, close or restart the Worker.

## Fail in-flight calls at once when the Worker crashes

A Worker crashes while converting a file, for example because a native module fails and the thread exits.

A typical wrapper keeps each call's resolve and reject in a table and looks them up by id when the Worker replies. Once the Worker exits, no reply ever comes, and every call in that table stays pending forever. Unless you also listen for the `exit` event and walk the table to reject each call yourself, callers wait indefinitely.

Here, when the connection drops, every unfinished call rejects immediately with `REMOTE_RESULT_UNKNOWN`. The code means "result unknown": the Worker may have done part of the work, so the caller decides whether to reconcile or retry.

### Example parameters

`convert` takes 5 seconds to return. `crash` makes the Worker thread exit with `process.exit(1)`, and the parent triggers it with `notify`, which does not wait for a reply. The `spawn` object sets `supervisor.restart.mode` to `'never'` so the Worker is not restarted; this example only looks at the call in flight. The default `report` writes a "supervision stopped" diagnostic to stderr.

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IJobApi = { convert(file: string): Promise<string>; crash(): void }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      convert: (file: string) =>
        new Promise<string>((resolve) => setTimeout(() => resolve(file + '.pdf'), 5_000)),
      crash: () => process.exit(1)
    }
  })
} else {
  const worker = await createThreadPeer<IJobApi>({
    spawn: { entry: true, supervisor: { restart: { mode: 'never' } } }
  })
  try {
    const started = performance.now()
    const converting = worker.request('convert', 'invoice.docx')
    void worker.notify('crash')
    try {
      await converting
    } catch (error) {
      const failure = error as Error & { code?: string }
      console.log(failure.code)
      console.log(performance.now() - started < 1_000)
    }
  } finally {
    await worker.close()
  }
}
```

Output:

```text
REMOTE_RESULT_UNKNOWN
true
```

The conversion call rejects with `REMOTE_RESULT_UNKNOWN` less than a second after the Worker exits. It neither waits the full 5 seconds nor hangs forever.

The rejection only says the result is unknown; it does not say the Worker did nothing, so reconcile a non-idempotent operation before retrying it. Whether the Worker restarts after a crash is set by `supervisor.restart`; this example turns restarts off.

## Get the error class, code and cause back from the Worker

Order validation inside a Worker fails and throws a custom `OrderError`. It carries a `code`, and its `cause` holds the original `RangeError` behind the failure.

`postMessage` moves data by structured cloning. After cloning, built-in error types and `message` survive, but a custom error class turns into a plain `Error` and loses its name, and custom fields such as `code` are dropped. The main thread then has nothing to branch on.

Here an error coming back from a Worker keeps its class name, `message`, `code` and `cause` chain. The caller branches on `code` and follows `cause` exactly as it would for a local error.

### Example parameters

`OrderError` sets its own `name` and `code`, and its `cause` is a `RangeError`. The Worker's default `report` also writes this failure to stderr, so it can be traced from the Worker side too.

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

class OrderError extends Error {
  readonly code = 'ORDER_INVALID'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OrderError'
  }
}

type IOrderApi = { place(quantity: number): string }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      place: (quantity: number) => {
        if (quantity <= 0)
          throw new OrderError('order rejected', {
            cause: new RangeError('quantity must be positive')
          })
        return 'placed'
      }
    }
  })
} else {
  const worker = await createThreadPeer<IOrderApi>({ spawn: true })
  try {
    await worker.request('place', 0)
  } catch (error) {
    const failure = error as Error & { code?: string }
    console.log(failure.name, failure.code, failure.message)
    console.log(failure.cause instanceof RangeError, (failure.cause as Error).message)
  } finally {
    await worker.close()
  }
}
```

Output:

```text
OrderError ORDER_INVALID order rejected
true quantity must be positive
```

The class name, `code` and `message` are restored, and `cause` is still a `RangeError` with its original message.

What comes back is the error's name and fields, not the same object: the error the main thread receives is not an `OrderError` instance. Branch on `code`; do not rely on `instanceof` with a custom class or on matching `message` text.

## Reject calls beyond the Worker's limit instead of queueing them

During an upload peak, the main thread sends a burst of image resize requests to a Worker.

A typical wrapper posts every request straight to the Worker, where messages queue without limit. When the Worker cannot keep up, requests pile up, every call waits longer, memory grows, and the caller cannot tell that the Worker is overloaded.

Here the number of calls a provider runs at the same time is capped, by default 64 per peer and 256 overall, and `providerLimits` adjusts both. A call over the cap rejects at once with `OVERLOADED` and the provider function does not run, so the caller can degrade, throttle or retry later right away.

### Example parameters

The Worker sets `providerLimits.maxPerPeer: 2`, so it runs at most two calls from the parent at a time; each resize takes 100 ms. The parent sends three calls at once, and `started` counts how many times the provider actually began work.

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IResizeApi = { resize(id: number): Promise<number>; started(): number }
if (await isThreadChild()) {
  let started = 0
  await createThreadPeer({
    providerLimits: { maxPerPeer: 2 },
    provide: {
      resize: (id: number) => {
        started++
        return new Promise<number>((resolve) => setTimeout(() => resolve(id), 100))
      },
      started: () => started
    }
  })
} else {
  const worker = await createThreadPeer<IResizeApi>({ spawn: true })
  try {
    const results = await Promise.allSettled([1, 2, 3].map((id) => worker.request('resize', id)))
    console.log(
      results
        .map((result) =>
          result.status === 'fulfilled' ? result.value : (result.reason as { code?: string }).code
        )
        .join(' ')
    )
    console.log(await worker.request('started'))
  } finally {
    await worker.close()
  }
}
```

Output:

```text
1 2 OVERLOADED
2
```

The first two calls complete, the third is rejected at once, and the provider ran only twice.

The cap limits how many calls run at the same time, not how long a queue grows. A function that has timed out or been cancelled but is still running in the Worker keeps its slot. `OVERLOADED` guarantees the provider did not run, so the call is safe to retry.

## Keep copied bytes usable when unsigned RPC transfer is refused

A Worker mutates its input, but the caller still needs its original bytes for later work.

Assuming every native port send transfers ownership can detach storage unexpectedly; requesting RPC transfer without its trust configuration must not silently bypass that boundary.

Use the default copying request, then attempt transfer without authentication and check the error, original storage and provider call count.

### Example parameters

inspect accepts an ArrayBuffer and changes its own copy; calls reports actual executions. The final request option requests transfer of that backing. Authentication is absent, so rejection occurs before detachment or a second inspect invocation. Default copying needs no signature; signed-transfer deployment is described below.

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IBytesApi = {
  inspect(buffer: ArrayBuffer): { length: number; first: number }
  calls(): number
}
if (await isThreadChild()) {
  let calls = 0
  await createThreadPeer({
    provide: {
      inspect: (buffer: ArrayBuffer) => {
        calls++
        const bytes = new Uint8Array(buffer)
        const result = { length: buffer.byteLength, first: bytes[0]! }
        bytes[0] = 99
        return result
      },
      calls: () => calls
    }
  })
} else {
  const worker = await createThreadPeer<IBytesApi>({ spawn: true })
  try {
    const bytes = new Uint8Array([7, 8, 9])
    const result = await worker.request('inspect', bytes.buffer)
    console.log(result.length, result.first)
    console.log(bytes.byteLength, bytes[0])
    try {
      await worker.request('inspect', bytes.buffer, { transfer: [bytes.buffer] })
    } catch (error) {
      const failure = error as Error & { code?: string }
      if (failure.code !== 'CAPABILITY_UNSUPPORTED') throw error
      console.log(failure.code)
    }
    console.log(bytes.byteLength, await worker.request('calls'))
  } finally {
    await worker.close()
  }
}
```

Output:

```text
3 7
3 7
CAPABILITY_UNSUPPORTED
3 1
```

Output is `3 7`, `3 7`, `CAPABILITY_UNSUPPORTED`, then `3 1`: the Worker changed only its copy, and rejected transfer neither detached the original nor invoked it again.

Signed RPC transfer requires both endpoints' real authentication configuration and negotiated native capabilities; this example intentionally leaves it disabled.

## Call a restarted Worker as soon as its Host reports ready

A Host restarts a Worker, and the next request must reach the fresh generation rather than a retired instance.

A native restart result alone may not mean an application directory has rebound; adding arbitrary delays obscures that boundary.

Install a named thread plugin in a real Host, await its restart result, and immediately call its counter again without a sleep.

### Example parameters

The plugin requires name, here worker; spawn: true uses the current entry. Both Host execution.mutationTimeoutMs and pipelineDrainTimeoutMs are required. false explicitly disables those budgets rather than selecting an omitted default. expose defaults to an empty array. restart reports ready after catalog publication; dispose returns a cleanup result containing cleanupComplete.

```ts doc-test=run
import { defineHost } from '@migaia/plugin-host'
import { createThreadPeer, createThreadPlugin, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { next(): number }
if (await isThreadChild()) {
  let count = 0
  await createThreadPeer({ provide: { next: () => ++count } })
} else {
  const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({
    name: 'worker',
    spawn: true
  })
  const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(worker)
    console.log(await host.thread!.request('worker', 'next'))
    const restarted = await host.thread!.restart('worker')
    console.log(restarted.state)
    console.log(await host.thread!.request('worker', 'next'))
  } finally {
    const result = await host.dispose()
    console.log(result.cleanupComplete)
  }
}
```

Output:

```text
1
ready
1
true
```

Output is `1`, `ready`, `1`, then `true`: the fresh Worker starts its counter again, accepts an immediate call, and Host cleanup completes.

The Host owns the installed Worker; both required execution budgets are explicitly false for no deadline, and restart does not migrate the old Worker's in-memory state.

## Close a borrowed channel while keeping its native port usable

A component stops using an existing MessagePort, but its caller still owns that physical port.

Unconditionally closing the port during adapter cleanup can break the caller's remaining protocol or another explicitly managed use.

Construct a fixed-profile Node channel, release its subscription and shared close result, then send a native message through the same held port.

### Example parameters

createNodeThreadChannel borrows a native MessagePort. peerId labels its opposite connection, and options.scheduler is required; this example passes systemScheduler directly. Omitted capabilities select the synchronous static profile. subscribe returns a subscription disposer, and close shares its Promise without owning the native port.

```ts doc-test=run
import { once } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { createNodeThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'

const { port1, port2 } = new MessageChannel()
const channel = createNodeThreadChannel(port1, 'remote', { scheduler: systemScheduler })
try {
  const off = channel.transport.subscribe(() => undefined)
  console.log(channel.agreement.source, channel.scheduler === systemScheduler)
  off()
  const closing = channel.close()
  console.log(closing === channel.close())
  await closing
  const received = once(port2, 'message')
  port1.postMessage('still open')
  console.log((await received)[0])
} finally {
  await channel.close()
  port1.close()
  port2.close()
}
```

Output:

```text
static true
true
still open
```

Output is `static true`, `true`, then `still open`: fixed construction preserves the scheduler, close shares its Promise, and the native port still delivers afterward.

This is a borrowed low-level channel, not a spawned Worker owner; the caller finally closes both ports, and omitted capabilities do not perform runtime-extension ACK.

## Retain captured bytes across a real native transfer and observer replacement

A diagnostics tool must retain transferred bytes even after native sending detaches the caller's original buffer.

Keeping only the detached reference loses those bytes, while an old unsubscribe can accidentally remove a replacement observer if generations are not distinguished.

Observe the actual Node carrier, replace its observer, invoke the old disposer, and transfer through two real MessagePorts before stopping the current observer.

### Example parameters

capturing controls whether observation includes content; the example explicitly uses false and true. emit receives direction, sizeBytes, carrier, detail, and content. send.transfer is a native carrier transfer list. subscribe receives the carrier value as message.data. This is not an RPC request or an authentication agreement. Install utils directly because this example imports it.

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createNodeThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'

const { port1, port2 } = new MessageChannel()
const left = createNodeThreadChannel(port1, 'right', { scheduler: systemScheduler })
const right = createNodeThreadChannel(port2, 'left', { scheduler: systemScheduler })
const captures: unknown[] = []
let staleCalls = 0
const stale = left.transport.observe!({
  capturing: false,
  emit: () => {
    staleCalls++
  }
})
const stop = left.transport.observe!({
  capturing: true,
  emit(_direction, _size, _carrier, _detail, content) {
    captures.push(content)
  }
})
stale()
let off: () => void = () => undefined
try {
  const received = new Promise<ArrayBuffer>((resolve) => {
    off = right.transport.subscribe((message) => {
      resolve(message.data as ArrayBuffer)
    })
  })
  const buffer = new Uint8Array([7, 9]).buffer
  left.transport.send(buffer, { transfer: [buffer] })
  console.log(buffer.byteLength)
  console.log(new Uint8Array(await received).join(','))
  console.log(new Uint8Array(captures[0] as ArrayBuffer).join(','))
  console.log(staleCalls, captures.length)
  off()
  stop()
  const next = new Promise<unknown>((resolve) => {
    off = right.transport.subscribe((message) => {
      resolve(message.data)
    })
  })
  left.transport.send(42)
  console.log(await next, captures.length)
} finally {
  off()
  stop()
  await left.close()
  await right.close()
  port1.close()
  port2.close()
}
```

Output:

```text
0
7,9
7,9
0 1
42 1
```

Output is `0`, `7,9`, `7,9`, `0 1`, then `42 1`: storage detaches, delivery and captured bytes agree, the old disposer leaves the new observer active, and stopping it prevents another capture.

This is physical carrier transfer, not signed RPC admission; captured transferred bytes require a copy, and no end-to-end allocation or speed claim follows.

## Contract details

### Responsibility, installation, and entries

This package creates Workers, connects their message ports, and delegates admission budgets, startup, restart, and release to supervision. Core owns call correlation, catalogs, deadlines, cancellation, error restoration, and retry; Contract owns the protocol and portable values. Use it to move parsing, compression, image processing, or similar work off the main thread, or to let a Host manage several Worker connections.

Threads share a process and do not replace separate process permissions or fault isolation. Use [rpc-process](../rpc-process/README.en.md) for a separate process. [rpc-browser](../rpc-browser/README.en.md) provides Peers for windows, iframes, SharedWorkers, and reliable ordered RTCDataChannels, and Endpoint transports for Service Workers and BroadcastChannels. SharedArrayBuffer / Atomics shared memory is outside this package's supported profile.

| Entry                                        | Contents                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@migaia/rpc-threads`                        | Peer, Plugin, child guard, error codes, advanced channels and Web launcher, plus public configuration and handle types. |
| `@migaia/rpc-threads/adapters/node`          | `createNodeThreadLauncher`, `createNodeThreadChannelFactory`.                                                           |
| `@migaia/rpc-threads/adapters/electron-main` | `createElectronMainThreadLauncher`, `createElectronMainThreadChannelFactory`.                                           |

Install both Core and Contract peer dependencies explicitly. The package does not enforce a hardcoded equality between their version numbers. lifecycle, supervision, and utils are runtime dependencies. The Electron-main entry additionally uses the optional peer `electron: ^44.0.0`. Install PluginHost or utils directly when an example imports them.

Web, Bun, Deno, and Electron renderer use the root Web launcher and channel factory. Import `INodeThreadHandle`, `IWebThreadHandle`, `IWebThreadLauncherOptions`, and advanced native runtime types from the root. Core's typed surfaces, query/detail/list/event types, and thread stop options are re-exported rather than defining another call protocol.

### Peer sources, typing, and calls

`createThreadPeer<TRemote>(options, runtime?)` returns a typed Peer. `TRemote` defaults to `Record<never, never>`; it checks the caller's paths without registering Worker methods. `IRuntimeDynamicSurface` relaxes static path checking while the actual remote catalog still controls runtime admission. The default local identity is `{ name: 'thread', instanceId: generated value }`; set self.name and self.instanceId for a stable address.

On the main thread, choose a short spawn, a full spawn source, or Core's connect / listen source; do not combine sources. Inside a Worker launched by this library, omit the source to connect through its real Node parentPort / workerData or Web bootstrap. Running an ordinary Worker file separately does not grant that connection. `isThreadChild()` reads the launch marker to choose a branch; it does not authorize an external Worker or replace capability acknowledgement.

Omitting provide exposes no application methods. Own enumerable data properties containing functions define methods; nested objects form dotted paths. Accessors are not method declarations. Call iterable / async iterable providers through stream. The Worker also receives a Peer and can request methods from its parent's provide descriptor.

| Operation                            | Purpose and boundary                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `request(method, ...args)`           | Await one result using the actual catalog and typed surface.                                                                          |
| `notify(method, ...args)`            | Send a one-way invocation without a receipt proving business completion.                                                              |
| `stream(method, ...args)`            | Consume a remote iterable / async iterable incrementally; cancellation remains cooperative.                                           |
| `group`, `outcome`, `describe`, `on` | Use Core's group, result reconciliation, catalog, and event contracts.                                                                |
| `close()` and async disposal         | The creator releases an independent Peer; spawn also releases its owned Worker, while a borrowed source releases only its connection. |

defaultTimeoutMs defaults to 30000, must be positive and finite, and applies only to request / stream. Per-call timeoutMs accepts a nonnegative finite value or false: 0 expires immediately and false disables that deadline. Provider concurrency defaults to 256 globally and 64 per peer, configurable through providerLimits.maxGlobal and providerLimits.maxPerPeer. OVERLOADED rejects before running that provider. spec.limits.callWallTimeMs, when present, caps a longer call deadline.

signal requests cooperative cancellation. A timeout, cancellation, or disconnect does not prove the Worker did not execute. Reconcile non-idempotent writes using a business identifier. For declared idempotent calls with retained results, idempotencyKey and outcome(key) can help; arbitrary retries do not become exactly-once execution. report defaults to Core's diagnostic reporter, normally console.error. probe, contract, authentication, endpointFactory, keyFactory, and retryPort retain their Core-owned contracts.

### Short spawn, entry resolution, and supervision defaults

| spawn                   | Meaning                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| true                    | Re-execute every top-level statement in the main module; await the child guard and keep parent-only effects in the parent branch. |
| URL                     | Use that exact URL.                                                                                                               |
| Path string             | Resolve relative to the main module under Node / Bun / Deno; encode absolute filesystem paths as file URLs.                       |
| `{ entry, ...options }` | entry accepts true, URL, or string; the following fields override defaults.                                                       |

| Short-source field       | Omitted value and purpose                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base                     | Unset. Relative entries use the main module unless an explicit module URL / URL string changes the base; no stack inspection guesses the caller.                    |
| name, data, limits       | Unset; passed into the Worker spec. normalizePortable snapshots data before Worker construction; invalid data produces Core INVALID_CONFIG with its cause retained. |
| scheduler                | systemScheduler, shared by the budget and default channel factory.                                                                                                  |
| budget                   | `createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler })`.                                                                                                     |
| launcher, channelFactory | Loaded lazily for the actual runtime; a custom factory must use the same scheduler.                                                                                 |
| report                   | source.report, then top-level options.report, then Core's default reporter.                                                                                         |
| health                   | Unset. Only launchers without enforced exit observation receive an actual Endpoint ping by default; explicit health takes precedence and retains its identity.      |
| supervisor.isolation     | Short sources default to best-effort; accepted values are required and best-effort.                                                                                 |
| keyFactory, retryPort    | Unset; top-level fields take precedence over source fields.                                                                                                         |

Short syntax expands the existing full source. It accepts no declaration that negotiation or trust has already occurred. Supervision still validates and executes the following policy:

| Field                                                   | Default and values                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| supervisor.id                                           | Generated.                                                                                                                                                                        |
| supervisor.ready                                        | Unset; may provide a real readiness check.                                                                                                                                        |
| supervisor.startupTimeoutMs                             | 10000 ms.                                                                                                                                                                         |
| supervisor.restart.mode                                 | on-failure; alternatives never and always.                                                                                                                                        |
| supervisor.restart.maxRestarts / windowMs               | 5 / 60000 ms.                                                                                                                                                                     |
| supervisor.restart.initialDelayMs / factor / maxDelayMs | 250 ms / 2 / 30000 ms, bounding exponential backoff.                                                                                                                              |
| supervisor.terminalPolicy                               | Omission behaves as mode stay, leaving the supervisor terminal; mode cooldown with afterMs permits another attempt later. Terminal does not mean explicit recovery is impossible. |
| supervisor.stop.exitTimeoutMs / reapTimeoutMs           | 5000 ms each.                                                                                                                                                                     |
| supervisor.stop.beforeTerminate                         | Unset; the binding first drains current calls within the remaining budget, then invokes a custom hook.                                                                            |

The default RPC health policy uses a 5000 ms interval, a 2000 ms check budget, and 3 consecutive failures. The original preparation deadline governs an unbound Endpoint; a bound check addresses only the Endpoint for that actual handle. Removing ping without supplying custom health produces INVALID_CONFIG. A health check does not strengthen an unsupported native exit capability.

Node / Bun self spawn retains runtime flags. A different explicit entry filters the parent's eval, print, and test controller flags while retaining loader and runtime flags. Self spawn rejects with INVALID_CONFIG when a REPL, eval, single binary, Electron application, or test runner has no reusable main module. It does not guess an entry, nor does this rule prohibit an explicitly supplied usable entry.

Node 24 strips TypeScript types but does not redirect a relative ./x.js import to ./x.ts; Bun supports that mapping. Use built output or a suitable loader under Node / Deno for modules containing such specifiers; resolution failures retain the original cause. Browsers require an explicit URL and reject true / bare strings. Dynamic Worker construction also cannot replace a bundler's literal source discovery: supply a built module URL or keep the literal Worker construction in a custom constructor. Deno Workers still require the appropriate host permissions.

### PluginHost and generation ownership

`createThreadPlugin(options, runtime?)` shares Peer sources, provide, and authentication. It additionally requires name. expose defaults to an empty array, exposing no Host application methods to the Worker; only explicitly selected paths are visible. The Host owns installed connections and Workers through host.thread, while the creator owns an independent Peer.

host.thread.request / notify / stream / group / outcome take a connection name or `{ name, instanceId }` first. list / get inspect connections and generations; broadcast returns an individual outcome per target; on / watch use Core's event catalog. stop / kill / restart / replace apply only to spawn sources and cannot terminate an external Worker behind a borrowed connection. Thread stop accepts only `{ graceMs }`; a signal field is rejected even when its value is undefined.

When restart returns ready or replace returns replaced, the new generation is already in the call catalog and may be called immediately. No extra ready event or application backoff is required. Replacement does not move calls already sent to the old generation. Host execution.mutationTimeoutMs and pipelineDrainTimeoutMs require explicit configuration; false disables the respective budget.

### Binary copying, signing, and transfer

| Input or option                       | Behavior                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ArrayBuffer / Uint8Array              | Copied by default, leaving caller storage usable; Uint8Array offset / length are preserved.                             |
| `{ transfer: [buffer] }`              | Requires actual agreement on native binary and transfer, plus signing authentication; otherwise CAPABILITY_UNSUPPORTED. |
| SharedArrayBuffer / other TypedArrays | Unsupported and rejected during call admission.                                                                         |

Configure authentication with sign and verify on both ordinary createThreadPeer factories to use signed native binary; a custom Endpoint is unnecessary. sign must protect the complete semantic input, including Core's integrity digest for native backing storage; verify must reject forged signatures. This profile signs without encryption and uses the default any encodedType. Actual ports acknowledge capability proposals; configuration labels do not establish trust.

For HMAC, both sides obtain the same key from their own deployment configuration. Never send it over RPC or log it. Application code can sign the complete input using createHmac, check the received signature length, then verify with timingSafeEqual and reject invalid authentication. RPC_SIGNING_KEY in the previous example is an application environment variable, not a credential supplied by the library. Node Workers inherit the environment; configure it before importing a module that reads the key.

Storage detaches when the message is physically submitted: byteLength becomes 0 and every view sharing its backing becomes unusable. A later signature rejection or failed call cannot restore it. Transfer calls are not automatically retried, and the library retains no input copy. Reconcile the business outcome before rebuilding data for a retry. This describes the native mechanism without making an unmeasured speed claim.

### Existing ports and advanced sources

createNodeThreadChannel(port, peerId, options) borrows an EventEmitter port; createWebThreadChannel borrows an EventTarget port. options.scheduler is required. Omitted capabilities select the fixed baseline, return synchronously, and perform no runtime hello. Fixed subsets containing only stream / batch also use this synchronous path. Extension proposals return a Promise and wait for Core's bilateral ACK on the actual ports; missing or invalid ACK rejects rather than accepting a one-sided declaration.

In a Peer connect callback, pass context.capabilities to the channel and start both sides together. context.self is Core's prepared local address; peerId identifies the opposite connection. Explicit capabilities narrow the proposal and cannot expand a real launch offer or counterfeit agreement or trust. Logical channel.close / Peer.close removes its own listeners and observer without closing the borrowed native port. The caller closes that port last. A fixed raw channel is not a complete runtime Peer.

A full IRuntimeThreadSpawn requires spec, launcher, budget, scheduler, channelFactory, and report; health, supervisor, keyFactory, and retryPort are optional. It does not inherit the short syntax's isolation override: omitting supervisor.isolation leaves supervision's required default. spec.entry is a Node absolute path / file URL or a Web absolute module URL; spec.name / data / limits are optional. heapBytes and callWallTimeMs are positive limits. The former maps to Node Worker's maxOldGenerationSizeMb, while the latter caps a call deadline; neither is a whole-process memory or CPU quota.

| Platform                          | Launcher / channel factory   | Native capability                                                                                                            |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Node                              | The two node-entry factories | termination, exit-observation, and heap-limit are enforced; only a real exit settles exited.                                 |
| Bun                               | The root Web factories       | termination and exit-observation are enforced; the native Worker close event settles exited. heap-limit remains unsupported. |
| Deno, browsers, Electron renderer | The root Web factories       | All three are unsupported; a terminate request supplies no actual-exit receipt.                                              |
| Electron main                     | The electron-main factories  | Reuse worker_threads but explicitly retain all three as unsupported; Node evidence is not Electron proof.                    |

The Web launcher requires report and accepts a Worker constructor, defaulting to global Worker, plus optional runtimeApi. Its constructor receives entry and `{ type: 'module', name }`. Node launcher options default to an empty object and accept execArgv / runtimeApi; advanced createAdapterNodeThreadLauncher also takes a real runtime resource. Host capabilities are acquired only when a launch occurs. Node sampleUsage is a cold query for this isolate's available heap, CPU microseconds, and ELU. sharedPid is identity only; unavailable native methods leave fields absent, and an exited Worker returns an empty object rather than borrowing parent-process totals.

handle.identity contains a stable fingerprint and, on Node, the threadId captured at construction. handle.port holds real messaging; terminate requests stopping; exited observes exit; Web also exposes prepared. Node settles exited from native exit and Bun from native Worker close. Deno, browsers and Electron renderer declare exit observation unsupported: forced reap immediately reports supervision EXIT_UNOBSERVABLE and retains an abandoned budget lease without waiting for reapTimeoutMs or falsely freeing admission capacity. Observable exit timeouts still report REAP_TIMEOUT; best-effort admission still reports CAPABILITY_UNSUPPORTED. Custom Node / Web handles open a generation with open(signal, { scheduler, capabilities? }); the factory must share its scheduler.

When construction or opening fails, launcher / supervision ownership releases acquired listeners and the candidate Worker. The primary exception stays identical or reachable through cause, with cleanup failures retained in errors. A Node Endpoint construction failure reaps the real Worker and frees its budget. A Web terminate request still cannot manufacture exit proof. Advanced callers that launch directly own logical channel closure, termination, and actual-exit observation; do not await Web exited forever when the platform supplies no receipt.

AdapterNodeThreadParentChannel retains the real parentPort without adding listeners until open selects the fixed profile. createAdapterNodeThreadPeer receives an already held parentPort and original workerData. A runtime resource loads the real Worker module; its pid identifies the shared process. receiveThreadData consumes the matching initial bootstrap, removes its listener, awaits prepare(data, peerId), sends ready, and returns portable business data. readThreadBootstrap validates and extracts peerId / data. These helpers do not authorize arbitrary external Workers.

New adapters reuse defineMessageAdapter from the [Core adapter SDK](../rpc-core/USEGUIDE.en.md); complex native assembly may use its internal-advanced entry without duplicating capability negotiation, retries, or lifecycle ownership. Node Workers and Bun 1.4.3 native Workers have business and shutdown evidence; these results do not establish browser, Deno, or Electron permissions and exit capabilities.

### Carrier observation

transport.observe(probe) on the final channel installs physical message observation, with one event per send and receive. Outbound detail.transfers is the native transfer-list length; inbound is -1 because structured clone does not reveal whether a received buffer was copied or transferred. sizeBytes is the byte length for a direct ArrayBuffer / view and -1 for other native messages, without additional object serialization.

Content is read only when probe.capturing is enabled. Non-transferred content borrows the original reference; transferred backing is copied before sending to preserve observable bytes. Core's selective own-data capture preserves cycles, shared backing, and non-transferred references inside Array, Record, Map, and Set. No additional getter evaluation is promised for transferred buffers exposed only through accessors.

Probe failures report Core TRANSPORT through onListenerError with the original exception on cause, while messaging continues. Reinstalling observe replaces its generation; an old disposer cannot remove the new one. The current disposer, logical close, and existing native terminal path retire observation. Closing a borrowed channel changes neither physical port ownership nor the existing listener and error-cause ordering.

### Errors and retry

| Source / code                                    | Meaning and response                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| @migaia/rpc/threads / THREAD_USAGE_SAMPLE_FAILED | Thread CPU / memory sampling failed, with cause retained; display unavailable without changing Worker lifecycle.    |
| @migaia/supervision / EXIT_UNOBSERVABLE          | Exit observation is explicitly unsupported; immediate abandonment retains the lease without a reap wait.            |
| @migaia/rpc/core / INVALID_CONFIG                | Invalid entry, source, bootstrap, capability ACK, portable data, or configuration; inspect field details and cause. |
| @migaia/rpc/core / TRANSPORT                     | Native message I/O or startup resource failure, preserving native error type and cause.                             |
| @migaia/rpc/core / DEADLINE_EXCEEDED             | TimeoutError; the Worker may already have executed, so reconcile first.                                             |
| @migaia/rpc/core / CANCELLED                     | AbortError; cooperative cancellation does not prove non-execution.                                                  |
| @migaia/rpc/core / OVERLOADED                    | Provider concurrency was full and that provider was not called; reduce load before retrying.                        |
| @migaia/rpc/core / CAPABILITY_UNSUPPORTED        | A required capability was not agreed, such as unsigned transfer.                                                    |
| @migaia/rpc/core / TARGET_UNKNOWN                | No current catalog target; check its name and active generation.                                                    |
| @migaia/rpc/remote / REMOTE_CLOSED               | Connection or generation is closed; select a current target and reconcile previously sent work.                     |

When native Node Worker construction rejects its arguments, the Node launcher classifies the failure as Core INVALID_CONFIG. If a native code already exists, a wrapper keeps the original Error, name, message, stack, and native code on cause rather than overwriting them. This describes the Node constructor boundary, not every Web constructor exception.

The local RpcThreadErrorCode object contains only usageSampleFailed, whose value is THREAD_USAGE_SAMPLE_FAILED; RPC_THREAD_ERROR_SOURCE is @migaia/rpc/threads. Calls, supervision, and Host boundaries retain their own sources rather than becoming sampling failures. Branch on source / code rather than message text. Business errors crossing Workers preserve native type, message, stack, source/code, and cause / errors chains; the received object cannot retain sender-side identity.

A standalone Worker configuration failure usually means no library bootstrap exists. A caller buffer that remains attached is the default copy behavior. Restart depends on policy; use Host restart / replace for explicit recovery and list / get for generation and exit information.
