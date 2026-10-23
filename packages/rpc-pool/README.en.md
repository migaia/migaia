# `@migaia/rpc-pool`

Combine real thread or process connections into a bounded pool with explicit completion points for calls, queued work, resizing and draining.

## You may have run into this

- Several Workers exist but work still reaches an occupied member because handwritten rotation does not track availability.
- Waiting work grows without limit because an array has no admission bound and cancelled entries stay in it.
- Shrinking a pool cuts off an active stream because retirement terminates a member before its operation finishes.
- New work enters during shutdown because stopping admission and draining accepted work were never separated.
- A failed child-process operation runs twice because connection recovery was combined with replaying business work.

## Why choose it

- **Assign independent operations to real available threads.** Each member has one client slot with rotating ties, and [Distribute calls over independent native Workers](./USEGUIDE.en.md#distribute-calls-over-independent-native-workers) checks the native thread identifiers.
- **Bound waiting and cancel only the matching entry.** The FIFO rejects overflow before dispatch and retains the cancellation reason, as [Bound waiting work and cancel one queued call](./USEGUIDE.en.md#bound-waiting-work-and-cancel-one-queued-call) demonstrates with a real stream occupying the slot.
- **Shrink without preempting an accepted stream.** resize prefers idle members and waits for occupied ones, while [Shrink idle capacity without cutting an active stream](./USEGUIDE.en.md#shrink-idle-capacity-without-cutting-an-active-stream) checks continued iteration and final capacity.
- **Stop admission before draining accepted work.** close enters closing immediately and shares one Promise, and [Drain accepted work while rejecting new calls](./USEGUIDE.en.md#drain-accepted-work-while-rejecting-new-calls) checks rejection of new work and completion of accepted work.
- **Keep the original failure without automatic business replay.** The pool invokes the original connection and propagates its rejection unchanged, while [Keep the original Peer failure without replaying the call](./USEGUIDE.en.md#keep-the-original-peer-failure-without-replaying-the-call) checks native causes and actual attempt count.

## Start here

Save this as a separate ESM TypeScript file and run it with Node 24; the real Worker reloads that file. Install the package and its three required peer dependencies first:

```bash
pnpm add @migaia/rpc-pool @migaia/rpc-core @migaia/rpc-process @migaia/rpc-threads
```

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'
if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const pool = await createThreadPool<{ double(value: number): number }>({ spawn: true, size: 1 })
  try {
    console.log(await pool.request('double', 21))
  } finally {
    await pool.close()
  }
}
```

Output:

```text
42
```

For distribution, see [Distribute calls over independent native Workers](./USEGUIDE.en.md#distribute-calls-over-independent-native-workers); for bounded waiting and cancellation, see [Bound waiting work and cancel one queued call](./USEGUIDE.en.md#bound-waiting-work-and-cancel-one-queued-call).

## Pitfalls when writing it yourself

This native-Worker rotation sketch is for display and type checking only; do not run it:

```ts doc-test=check
import type { Worker } from 'node:worker_threads'

const makeDispatcher = (workers: readonly Worker[]) => {
  let cursor = 0
  return {
    send(value: number) {
      const worker = workers[cursor++ % workers.length]!
      worker.postMessage(value) // Pitfall: ignores occupied members and has no bounded queue.
      // Pitfall: no result matching or failure settlement; sending is not business completion.
    },
    close() {
      for (const worker of workers) void worker.terminate() // Pitfall: accepted work is not drained.
    }
  }
}
void makeDispatcher
```

The previous example awaits the original connection's result through request while the pool tracks slots and waiting entries; close stops admission, drains work and delegates cleanup to the original connection owner.

## A three-minute mental model

| Problem                                | Tool                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| Multiple members of one thread program | createThreadPool forwards spawn to the original Thread factory. |
| Business work needs separate processes | createProcessPool retains Process entry and wire rules.         |
| One result or one notification         | request awaits business results; notify only awaits sending.    |
| Continuous results or capacity changes | stream reserves on first next; resize waits for retirement.     |
| Application shutdown                   | close drains accepted work; stats reports pool state.           |

A Peer is a connection to remote methods; the original factory owns discovery and directory exchange. A member is one pool-owned Peer. A slot represents one client operation, FIFO means first-in-first-out waiting for a slot, and draining means waiting for accepted operations to settle. These do not measure remote CPU or provider concurrency.

## Typical scenarios

| Scenario                                     | How to combine                                                    | Details                                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Distribute calls among real threads          | createThreadPool → request × 2 → stats → close                    | [Distribute calls over independent native Workers](./USEGUIDE.en.md#distribute-calls-over-independent-native-workers)                   |
| Reject overflow and cancel waiting           | stream.next → request → AbortController → return                  | [Bound waiting work and cancel one queued call](./USEGUIDE.en.md#bound-waiting-work-and-cancel-one-queued-call)                         |
| Keep consuming during shrink                 | stream.next → resize → stream.return → stats                      | [Shrink idle capacity without cutting an active stream](./USEGUIDE.en.md#shrink-idle-capacity-without-cutting-an-active-stream)         |
| Calculate in a separate child process        | createProcessPool → request → close                               | [Use real child processes for pooled business calls](./USEGUIDE.en.md#use-real-child-processes-for-pooled-business-calls)               |
| Complete accepted work during shutdown       | request / stream → close → reject new work → finish accepted work | [Drain accepted work while rejecting new calls](./USEGUIDE.en.md#drain-accepted-work-while-rejecting-new-calls)                         |
| Diagnose failure without duplicate execution | request.catch → cause → request attempt count                     | [Keep the original Peer failure without replaying the call](./USEGUIDE.en.md#keep-the-original-peer-failure-without-replaying-the-call) |

## Installation

```bash
pnpm add @migaia/rpc-pool @migaia/rpc-core @migaia/rpc-process @migaia/rpc-threads
```

The three RPC packages are required peer dependencies. Install directly imported packages explicitly. The Node engine requires version 24 or later, and the only entry is `@migaia/rpc-pool`. Other hosts follow the corresponding Peer factory's support rather than being established by Node examples.

## Essential APIs

| API                   | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| createThreadPool      | Own a pool of real Thread Peers.                                   |
| createProcessPool     | Own a pool of real Process Peers.                                  |
| pool.request / notify | Await business results or original send completion.                |
| pool.stream           | Async results admitted on first next.                              |
| pool.resize           | Change target capacity in order and await occupied retirees.       |
| pool.close / stats    | Drain and clean up, or read a fresh shallow-frozen state snapshot. |

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
