# @migaia/rpc-pool usage guide

These six scenarios use real Node 24 Workers or child processes through public Peer factories, where a Peer is a connection to remote business methods. Choose a task, then consult the full parameter and lifecycle contract below. Thread and Process factories are the two construction entries; resizing uses their returned public controls.

## Find a scenario

| Scenario                                                  | Entry or control    | Details                                                                        |
| --------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| Distribute calls over independent native Workers          | `createThreadPool`  | [Complete example](#distribute-calls-over-independent-native-workers)          |
| Bound waiting work and cancel one queued call             | `createThreadPool`  | [Complete example](#bound-waiting-work-and-cancel-one-queued-call)             |
| Shrink idle capacity without cutting an active stream     | `pool.resize`       | [Complete example](#shrink-idle-capacity-without-cutting-an-active-stream)     |
| Use real child processes for pooled business calls        | `createProcessPool` | [Complete example](#use-real-child-processes-for-pooled-business-calls)        |
| Drain accepted work while rejecting new calls             | `createProcessPool` | [Complete example](#drain-accepted-work-while-rejecting-new-calls)             |
| Keep the original Peer failure without replaying the call | `createProcessPool` | [Complete example](#keep-the-original-peer-failure-without-replaying-the-call) |

## Run the examples

Install this package and its three required peer dependencies. Examples directly use Thread/Process child guards and method publication.

```bash
pnpm add @migaia/rpc-pool @migaia/rpc-core @migaia/rpc-process @migaia/rpc-threads
```

Save each example as a separate ESM TypeScript file and execute it with Node 24, avoiding interactive standard input. spawn: true reruns the same entry; branch into the child first, publish its methods there, and create the pool only in the parent. Thread examples launch real Workers and Process examples launch real child processes. Finally awaits pool close so the original Peer owner can release its physical resources. Node results do not establish another runtime or OS.

A short Process source can report supervision's CAPABILITY_UNSUPPORTED notice for unsupported process termination under its best-effort capability policy. This does not prevent established business calls from succeeding or establish forced termination of an entire process tree. The pool preserves the original owner's diagnostic without suppressing it or adding another termination strategy.

## Distribute calls over independent native Workers

Independent jobs need more than one Worker, but callers should not select a thread or repeat its startup logic for every request.

A single shared client can serialize work unintentionally; creating a Worker per call repeatedly acquires resources and loses a stable capacity limit.

Create a Thread pool with size 2 and provide methods through the real ThreadPeer child branch. Two sequential identity calls demonstrate rotation between idle members; pool stats describe client slots, not provider concurrency.

### Example parameters

`spawn: true` is required and reruns this entry. `await isThreadChild()` branches before the child installs its no-argument identity method with `createThreadPeer({ provide: ... })`. `size: 2` creates two members. Omitted options are `maxQueue: 256`, `idleTimeoutMs: undefined`, `scheduler: systemScheduler`, and `probe: undefined`. The two payload-free identity requests check rotation between idle members. `IWorkerApi` describes methods statically on the caller side.

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'
import { threadId } from 'node:worker_threads'

type IWorkerApi = { identity(): { pid: number; threadId: number } }
if (await isThreadChild()) {
  await createThreadPeer({ provide: { identity: () => ({ pid: process.pid, threadId }) } })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 2 })
  try {
    const first = await pool.request('identity')
    const second = await pool.request('identity')
    console.log('workers:', first.threadId !== second.threadId)
    console.log('process:', first.pid === process.pid, second.pid === process.pid)
    const stats = pool.stats()
    console.log(
      'pool:',
      stats.targetSize,
      stats.memberCount,
      stats.inFlight,
      stats.queued,
      stats.state
    )
  } finally {
    await pool.close()
  }
}
```

Output:

```text
workers: true
process: true true
pool: 2 2 0 0 open
```

The output is `workers: true`, `process: true true`, then `pool: 2 2 0 0 open`: two different native threads share the parent process and return to idle slots.

size is required; maxQueue defaults to 256, idleTimeoutMs to undefined, and scheduler to systemScheduler. The original Peer owns startup, wire calls and supervision; the pool does not add another native recovery mechanism.

## Bound waiting work and cancel one queued call

All member slots are occupied, more calls arrive, and one queued request is no longer needed.

An unbounded pending list keeps obsolete work alive; cancelling a request without removing its exact queue entry can leave capacity occupied or remove another caller's work.

Hold the sole client slot with a real stream, set maxQueue to 1, then cancel the queued request with its own signal. A further call is rejected before dispatch, and returning the stream releases the active slot.

### Example parameters

`size: 1` supplies one client slot, and `maxQueue: 1` overrides the default 256 waiting entries. The payload-free values stream reserves only on first next; the consumer must finish or return it even if the provider has produced later items. The queued echo request receives its own AbortController signal, and abort(reason) preserves that exact object as the queued failure's cause. The extra echo(9) is never dispatched. Idle retirement and a pool queue deadline are not configured.

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { values(): AsyncIterableIterator<number>; echo(value: number): number }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      values: async function* () {
        yield 1
        yield 2
      },
      echo: (value: number) => value
    }
  })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1, maxQueue: 1 })
  const stream = pool.stream('values')
  try {
    console.log('lazy:', pool.stats().inFlight)
    await stream.next()
    const controller = new AbortController()
    const queued = pool
      .request('echo', 7, { signal: controller.signal })
      .catch((error: unknown) => error)
    const overflow = await pool.request('echo', 9).catch((error: unknown) => error)
    console.log(
      'capacity:',
      pool.stats().inFlight,
      pool.stats().queued,
      (overflow as { code?: string }).code
    )
    const reason = new Error('Queued request is no longer needed')
    controller.abort(reason)
    const failure = (await queued) as Error & { code?: string }
    console.log('cancelled:', failure.name, failure.code, failure.cause === reason)
    console.log('waiting:', pool.stats().queued)
    await stream.return?.()
    console.log('released:', pool.stats().inFlight)
  } finally {
    await stream.return?.()
    await pool.close()
  }
}
```

Output:

```text
lazy: 0
capacity: 1 1 QUEUE_FULL
cancelled: AbortError CALL_ABORTED true
waiting: 0
released: 0
```

The output is `lazy: 0`, `capacity: 1 1 QUEUE_FULL`, `cancelled: AbortError CALL_ABORTED true`, `waiting: 0`, then `released: 0`.

The cancellation belongs to pool waiting and preserves the exact reason on cause. After dispatch, cancellation belongs to the original Peer. maxQueue defaults to 256; zero forbids waiting. Stream creation is lazy, but first next holds a slot until completion or return.

## Shrink idle capacity without cutting an active stream

The configured capacity needs to decrease while one member is still serving a stream.

Closing arbitrary members can interrupt accepted work; merely changing a number can leave unwanted native Workers alive indefinitely.

Await resize to grow or shrink the real pool. Shrinking prefers idle members and waits for their original Peer cleanup; the retained busy member continues its stream, and returning that stream releases its client slot.

### Example parameters

`resize(2)` and `resize(1)` each require a positive integer, growing to two members and shrinking to one. Creating the stream does not reserve; first next does. This shrink can retire the other idle member while retaining the active stream. If an occupied member must retire, resize waits for its operation. Omitted defaults are `maxQueue: 256`, `idleTimeoutMs: undefined`, and `scheduler: systemScheduler`; the printed stats measure target, acquired members and occupied client slots.

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { values(): AsyncIterableIterator<number> }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      values: async function* () {
        yield 1
        yield 2
      }
    }
  })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1 })
  const stream = pool.stream('values')
  try {
    await pool.resize(2)
    console.log('grown:', pool.stats().targetSize, pool.stats().memberCount)
    console.log('first:', (await stream.next()).value)
    await pool.resize(1)
    console.log('shrunk:', pool.stats().targetSize, pool.stats().memberCount, pool.stats().inFlight)
    console.log('continued:', (await stream.next()).value)
    await stream.return?.()
    console.log('released:', pool.stats().inFlight)
  } finally {
    await stream.return?.()
    await pool.close()
  }
}
```

Output:

```text
grown: 2 2
first: 1
shrunk: 1 1 1
continued: 2
released: 0
```

The output is `grown: 2 2`, `first: 1`, `shrunk: 1 1 1`, `continued: 2`, then `released: 0`.

resize requires a positive integer and has no default size. Resize operations execute in call order. If a busy member must itself retire, resize waits for its accepted operation; there is no pool-level forced interruption or added drain deadline.

## Use real child processes for pooled business calls

Some jobs need separate processes, while callers still want the same typed request API used for ordinary Peers.

Treating a Worker thread as a process does not create a separate PID; replacing native creation with a local object also cannot demonstrate process ownership.

Create a Process pool from the guarded entry and let the real ProcessPeer publish its methods. Call the business method, then query two member PIDs through the same public request path.

### Example parameters

`spawn: true` reruns this entry, and `isProcessChild()` installs real Peer methods through provide.double and provide.identity. The required `size: 2` sets target capacity. double(21) returns 42, then two identity calls check distinct PIDs. No probe, idle retirement or call options are supplied; maxQueue defaults to 256 and scheduler to systemScheduler. Process call options retain their original type without Thread transfer lists.

```ts doc-test=run
import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number; identity(): number }
if (isProcessChild()) {
  await createProcessPeer({
    provide: {
      double: (value: number) => value * 2,
      identity: () => process.pid
    }
  })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 2 })
  try {
    console.log('result:', await pool.request('double', 21))
    const first = await pool.request('identity')
    const second = await pool.request('identity')
    console.log('processes:', first !== process.pid, second !== process.pid, first !== second)
    console.log('members:', pool.stats().memberCount)
  } finally {
    await pool.close()
  }
}
```

Output:

```text
result: 42
processes: true true true
members: 2
```

The output is `result: 42`, `processes: true true true`, then `members: 2`: both members have PIDs different from the parent and from each other.

spawn and size are required; spawn true reruns the guarded entry. Process call options keep their original type and do not accept Thread transfer lists. These are Node 24 process results, not evidence for another runtime or OS.

## Drain accepted work while rejecting new calls

An application starts shutdown with an active stream and a request already waiting behind it.

Stopping every process immediately loses accepted work; continuing to accept new calls prevents shutdown from converging.

Call close to switch admission to closing and retain its shared Promise. End the active stream explicitly so the already-queued request can finish; await close before considering the owned processes released.

### Example parameters

`size: 1` lets the active stream hold the sole slot, and double(21) waits in the default 256-entry FIFO. close() and stats() take no arguments. Close enters closing synchronously, shares its Promise and rejects a new double(1). Returning the stream allows the previously accepted request to acquire the slot. There is no added pool drain deadline. The finally block still observes close completion rather than treating initiation as completed cleanup.

```ts doc-test=run
import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { values(): AsyncIterableIterator<number>; double(value: number): number }
if (isProcessChild()) {
  await createProcessPeer({
    provide: {
      values: async function* () {
        yield 1
        yield 2
      },
      double: (value: number) => value * 2
    }
  })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })
  const stream = pool.stream('values')
  try {
    await stream.next()
    const accepted = pool.request('double', 21)
    const closing = pool.close()
    console.log('closing:', pool.stats().state, closing === pool.close(), pool.stats().queued)
    const rejected = await pool.request('double', 1).catch((error: unknown) => error)
    console.log('new work:', (rejected as { code?: string }).code)
    await stream.return?.()
    console.log('accepted:', await accepted)
    await closing
    console.log('closed:', pool.stats().state, pool.stats().memberCount)
  } finally {
    await stream.return?.()
    await pool.close()
  }
}
```

Output:

```text
closing: closing true 1
new work: POOL_CLOSED
accepted: 42
closed: closed 0
```

The output is `closing: closing true 1`, `new work: POOL_CLOSED`, `accepted: 42`, then `closed: closed 0`.

close has no arguments, is stable across repeated calls, and adds no pool drain timeout. A long-lived stream can keep shutdown waiting; consume it, return it or cancel it. An unstarted stream has not acquired a slot and does not block close.

## Keep the original Peer failure without replaying the call

A child process reports a business failure after entering the method, and retrying that method could repeat its side effects.

Wrapping every error with a pool code hides the original owner; silently replaying a failed operation makes one client call execute more than once.

Let createProcessPool forward the original Peer rejection. Inspect the returned native TypeError and its RangeError cause, then query the actual child method's attempt count to confirm that this failed business call ran once.

### Example parameters

provide.fail increments child-local state and throws a TypeError caused by a RangeError. These are business fixture errors, without pool reclassification. `size: 1` ensures the later attempts query reaches the same process. RPC_POOL_ERROR_SOURCE distinguishes the failure's owner. Here, the transferred TypeError is top-level with a RangeError cause. The received object need not share identity with the original child error. No extra call options are supplied; the original Peer's deadline and recovery rules remain in effect.

```ts doc-test=run
import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { fail(): never; attempts(): number }
if (isProcessChild()) {
  let attempts = 0
  const root = new RangeError('invalid amount')
  const failure = new TypeError('payment calculation failed', { cause: root })
  await createProcessPeer({
    provide: {
      fail: () => {
        attempts += 1
        throw failure
      },
      attempts: () => attempts
    }
  })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })
  try {
    const failure = (await pool.request('fail').catch((error: unknown) => error)) as Error & {
      source?: string
    }
    const primary = failure
    console.log('remote:', failure.name, failure.source !== RPC_POOL_ERROR_SOURCE)
    console.log('native:', primary instanceof TypeError, primary.message)
    console.log('cause:', primary.cause instanceof RangeError)
    console.log('attempts:', await pool.request('attempts'))
  } finally {
    await pool.close()
  }
}
```

Output:

```text
remote: TypeError true
native: true payment calculation failed
cause: true
attempts: 1
```

The output is `remote: TypeError true`, `native: true payment calculation failed`, `cause: true`, then `attempts: 1`.

The pool owns admission and cleanup errors, not this Peer error. This example proves no replay of the business failure; it does not simulate a process crash. Native restart policy remains with the original ProcessPeer source, and failed work is not automatically replayed by the pool.

## Contract details

### Responsibilities, entry and ownership

This package combines connections created by the public createThreadPeer / createProcessPeer factories. It assigns client-operation slots and owns a bounded waiting FIFO. Communication, method directories, handshakes, authentication, request matching, cancellation, deadlines, native startup, supervision and restart stay with the corresponding Peer. The pool adds no native thread scheduler, RPC protocol, work stealing, cross-machine pool or Proxy call surface.

The only entry is `rpc.pool`. Runtime exports are createThreadPool, createProcessPool, RpcPoolState, RpcPoolErrorCode and RPC_POOL_ERROR_SOURCE. Public types include IThreadPool, IProcessPool, their options, IRpcPoolControls, IRpcPoolStats and IRpcPoolErrorCode. Internal createPool, validation and error-tagging helpers are not application exports. Lifecycle and utils are runtime dependencies; core, process and threads are required RPC peer dependencies. Install a package directly when directly importing its API.

The pool owns its created Peers, local FIFO and idle tasks. It exposes no internal native handles, handshake, admission or trust controls. Member retirement calls the original Peer.close; its owner performs the port, Worker/process and supervision cleanup.

### Factories and options

`createThreadPool<TRemote>(options)` and `createProcessPool<TRemote>(options)` return Promises that resolve after the initial member batch has been acquired. The remote type defaults to `Record<never, never>`; applications describe their business methods. That type argument is neither a runtime schema nor an installation of remote methods.

| Field         | Default, accepted values and behavior                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| spawn         | Required and non-null; passed unchanged to the corresponding public Peer factory.                                                                   |
| size          | Required positive integer, measuring target members rather than provider concurrency.                                                               |
| maxQueue      | 256, a non-negative integer; 0 disallows waiting when every slot is occupied.                                                                       |
| idleTimeoutMs | undefined, disabling idle retirement; when supplied, a finite positive number no greater than 2147483647 milliseconds, including fractional values. |
| scheduler     | systemScheduler, controlling only the pool's idle timers.                                                                                           |
| probe         | undefined; the original Peer's single Probe or readonly Probe array, forwarded unchanged to each member.                                            |

Invalid options structure, a missing spawn source or wrong numeric types reject with TypeError / INVALID_OPTIONS. Out-of-range size, maxQueue or idleTimeoutMs reject with RangeError / INVALID_OPTIONS before native factories acquire resources. There is no additional safe-integer restriction or default size. Lifecycle captures and validates scheduler through its existing boundary before native creation; failures retain that owner's source, code and cause. This is not a deep, single-read snapshot guarantee for all options.

Thread spawn retains the original factory's true, entry path/URL and source forms. Process retains its own entry, runtime, permission and wire rules. Separate programs may use separate entries; a foreign-language Process JSON-RPC source still uses the original `{ command, args, wire: 'jsonrpc', contract }`. Those fields belong to the original factory rather than a pool-specific startup protocol.

`spawn: true` reruns the main entry. Branch with the original `await isThreadChild()` or `isProcessChild()` before constructing another pool. Relative strings are resolved from the main entry's directory; URLs identify the exact entry. Browser threads follow their original URL rules. Node type stripping does not rewrite .js imports in TypeScript source to .ts; use runnable compiled output or an appropriate loader. Launch through a native path allowed by the host's permissions, entry rules and lifetime capabilities.

### Requests, notifications, streams and routing

Both pools expose request / notify / stream with the parameter and return types of their Thread/Process Peer. There is no pool payload wrapper or Proxy. Method, original payload and dispatched options object are passed unchanged to the selected Peer. Thread retains its transfer-list types and authentication boundary; Process call options do not accept Thread transfer lists.

Each member has one client-operation slot. Free slots are preferred with rotating ties; when all are occupied, subsequent work waits in a bounded FIFO without bypass by new arrivals. “Least in-flight” therefore distinguishes free from occupied slots; it does not predict native load from calculation cost, CPU, provider concurrency or queue size. Later operations may use different members. The pool adds no global sticky sessions, business deduplication or cross-member ordering protocol.

| Operation                           | Slot lifetime                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| request(method, payload?, options?) | Reserves at admission and releases when the original Peer request Promise settles.                              |
| notify(method, payload?, options?)  | Reserves at admission and releases when the original send Promise settles, without acknowledging provider work. |
| stream(method, payload?, options?)  | Returns a lazy async iterator; first next admits and reserves, while done, return, throw or failure releases.   |

An untouched stream creates no native consumer, owns no slot and does not block close. An active long stream must be consumed, returned/thrown into, or cancelled through the original Peer signal with iterator completion before its slot is released. Calling stream alone is not a sent operation. Next calls are serialized, while return/throw can reach the original iterator without waiting behind a blocked next.

When all slots are occupied and maxQueue waiting entries already exist, new work rejects with QUEUE_FULL before business dispatch. After idle retirement, a new operation may reserve a refill slot whose Peer is still being acquired instead of necessarily consuming FIFO capacity. Accepted work waiting for that acquisition remains pool-owned and participates in draining.

### Queued cancellation and Peer deadlines

The pool owns a signal listener only while an operation waits in its FIFO. Cancellation removes that exact entry and its admission count. It rejects with a native DOMException / AbortError, this package's source, CALL_ABORTED, and the original signal.reason as cause. On dispatch the pool removes its listener and passes the original options/signal to the Peer. Cancellation, deadlines and errors after dispatch remain the Peer's responsibility without rebuilding its error.

The original Peer applies timeoutMs when it receives the operation. FIFO waiting neither creates a separate queue deadline nor consumes or shortens this relative timeout. Applications can cancel waiting with their own AbortSignal; queue capacity is not a time limit. Closing the pool does not automatically cancel accepted business work.

### Statistics and state

stats() takes no arguments and returns a new shallow-frozen snapshot on each call, including after close. It measures pool client operations rather than remote provider concurrency or native CPU utilization.

| Field       | Meaning                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| targetSize  | Target capacity; idle retirement preserves it and resize changes it.                                                           |
| memberCount | Members with an actual acquired Peer, potentially including retirees still cleaning up; excludes slots still acquiring a Peer. |
| inFlight    | Acquired Peers whose slot is occupied by a pool operation, not remote business concurrency.                                    |
| queued      | FIFO entries awaiting a slot, excluding already-reserved acquisition slots.                                                    |
| state       | RpcPoolState.open / closing / closed.                                                                                          |

RpcPoolState is a public value object: open accepts work, closing drains accepted operations, and closed means all member cleanup has been attempted. It describes pool admission rather than every native supervisor's health.

### Resizing and idle retirement

resize(size) takes one required positive integer and returns a Promise. Invalid values reject under the same INVALID_OPTIONS rules, and closing pools reject with POOL_CLOSED. Operations execute in call order; one rejection does not poison the following operation. A resize that has not started when close enters closing also rejects.

Growth acquires only missing target capacity. Failed growth rolls back the new batch and restores the previous target while the pool remains open, without unconditionally rebuilding existing members. Shrink prefers idle members; occupied retirees finish their current operation before the original Peer.close runs. Shrinking does not preempt active business work. Completion can therefore wait for original operations and cleanup.

With idleTimeoutMs configured, a task is armed only for an idle member while the pool is open and there is no waiting demand. Reservation, retirement and close cancel its previous task. Other members' activity does not reset this member's existing idle duration. Expiry retires through Peer.close without reducing the target; later work refills missing capacity through the original public factory. The owned task requests optional unref so housekeeping alone need not keep the host alive, without changing the timeout duration.

A manual scheduler can drive idle expiry without advancing a member's supervision, handshake or request deadline. The pool uses its admitted scheduler methods without replacing the original spawn source's supervision scheduler.

### Closing, startup failure and recovery

close() takes no arguments. Its first call synchronously enters closing and rejects new request/notify, first stream.next and resize admission; repeated calls return the same Promise. It waits for accepted active work, FIFO entries, acquisitions and resize completion before attempting every member close. State becomes closed after all cleanup attempts. Failures reject that same Promise with a CLOSE_FAILED AggregateError whose errors retain original failures and whose cause is the first.

There is no pool drainTimeoutMs or forced-stop timer. Unfinished accepted requests, sends, streams or acquisitions can extend draining indefinitely. Complete or cancel work under the original Peer/iterator contract rather than treating close as preemptive cancellation.

If an initial, expanding or refill batch partly fails, close is attempted for every acquired Peer. The original primary is chosen in factory input order rather than rejection-time order. Rollback cleanup failures are reported through the original default reporter without replacing that primary. A cold refill with no surviving usable slot also rejects associated waiting work with the same original failure; the pool does not retry native creation indefinitely.

Native crashes are recovered by the original supervisor under its source's restart policy and budget. Bare spawn retains the original on-failure policy and five-restart default; the pool never resets caller budgets. During recovery, the original Peer may reject with CLOSED; future calls use that original Peer after recovery. Failed business calls are not automatically replayed, and restart does not establish at-most-once execution or durable delivery.

The original probe is forwarded to members. Real handshake, ready and restart observations still originate with the Peer. Use endpointId to distinguish members sharing a Probe; seq remains endpoint-local rather than a global pool sequence. Read reusable views synchronously or extract values under the Probe owner's contract.

### Errors and supported hosts

| RpcPoolErrorCode property / value | Trigger                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| invalidOptions / INVALID_OPTIONS  | Invalid construction or resize arguments, using native TypeError / RangeError.                    |
| poolClosed / POOL_CLOSED          | New admission while closing or closed.                                                            |
| queueFull / QUEUE_FULL            | Bounded FIFO overflow before business dispatch.                                                   |
| callAborted / CALL_ABORTED        | Signal cancellation while still queued, retaining native AbortError and original reason as cause. |
| closeFailed / CLOSE_FAILED        | AggregateError after every member cleanup has been attempted.                                     |

RPC_POOL_ERROR_SOURCE is `rpc.pool`, and IRpcPoolErrorCode is the union of those public values. Failures already returned by the Peer retain their own source/code, instance and cause chain without pool reclassification. Startup and cleanup failures remain reachable through cause/errors. State values are not error codes.

A short Process source can report supervision's CAPABILITY_UNSUPPORTED notice for unsupported process termination under its best-effort capability policy. This does not prevent established business calls from succeeding or establish forced termination of an entire process tree. The pool preserves the original owner's diagnostic without suppressing it or adding another termination strategy.

Supported hosts follow the corresponding factory. Examples use real Node 24 Workers/child processes. Bun, Deno, browser threads, Electron and Windows remain subject to their original entry, permissions, carrier and native-lifetime constraints; Node results are not evidence of execution on those hosts. The package provides fmt, lint, typecheck, typecheck:test, build and a coverage-enabled test script; this list does not claim those commands ran on this page or in this turn.
