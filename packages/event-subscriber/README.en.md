# `@migaia/event-subscriber`

[中文](./README.md)

`@migaia/event-subscriber` delivers local events to listeners, with explicit rules for awaiting results, cancelling subscriptions and selecting exactly one handler.

## Sound familiar?

- **The screen shows a newer value, then jumps back.** A listener publishes recursively before the remaining listeners finish the older round.
- **A recipient is skipped, or a new subscriber sees an old event.** Publication walks a callback array that listeners are mutating.
- **An old page keeps receiving updates.** Requests share a cancellation signal, but the subscription has a separate, forgotten lifetime.
- **One failed handler also loses successful replies.** Fire-and-forget notification is treated like an awaited call without per-listener settlement.
- **A save writes twice.** Double mounting registers the same command twice, with no uniqueness check before invocation.

## Why choose it

- **Nested updates can finish one round at a time.** Recursive broadcasts can deliver a newer value before an older round finishes; explicit queued dispatch completes the current snapshot first, as the [example](./USEGUIDE.en.md#deliver-nested-notifications-after-the-current-round) shows with values 1 and 2.
- **Subscription changes leave current recipients intact.** Walking a mutable array can skip or add recipients mid-delivery; an entry snapshot fixes the targets, and the [example](./USEGUIDE.en.md#change-subscriptions-without-changing-the-current-delivery) delays the new subscriber until the second round.
- **One cancellation signal also owns the subscription.** Manual cancellation often stops a request but forgets its listener; `subscribeUntil` removes both the subscription and abort observer. The [example](./USEGUIDE.en.md#stop-page-updates-with-its-cancellation-signal) ends with no registrations left.
- **A failure does not erase successful parallel results.** Handling only an aggregate rejection can lose successful replies; `invokeParallelSettled` returns each value or failure in registration order. The [example](./USEGUIDE.en.md#keep-successful-results-when-another-listener-fails) retains the successful value 6.
- **Ambiguous command targets are rejected before execution.** Broadcasting or picking the first match can duplicate a write or hide duplicate registration; `invokeTask` requires exactly one match. The [example](./USEGUIDE.en.md#reject-duplicate-command-targets-before-doing-any-work) performs no second save.

## Start here

Run this directly with Node 24. The first listener publishes value 2 while handling value 1; queued delivery lets the second listener see 1 before 2.

```ts doc-test=run
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'

const updates = createEventChannel<number>({ dispatchPolicy: EventDispatchPolicy.queued })
updates.subscribe(({ value }) => {
  console.log('record:', value)
  if (value === 1) updates.publish(2)
})
updates.subscribe(({ value }) => {
  console.log('render:', value)
})
updates.publish(1)
updates.clear()
```

Output:

```text
record: 1
render: 1
record: 2
render: 2
```

For page cleanup, read [cancellation signals](./USEGUIDE.en.md#stop-page-updates-with-its-cancellation-signal); for awaited results, read [parallel settlement](./USEGUIDE.en.md#keep-successful-results-when-another-listener-fails).

## What hand-written code gets wrong

For illustration only; do not run. This callback array handles the same nested updates as the example above.

```ts doc-test=check
const listeners: Array<(value: number) => void> = []
const publish = (value: number) => {
  // Pitfall 1: mutating this live array changes the current recipient list.
  for (const listener of listeners) listener(value)
}
listeners.push((value) => {
  console.log('record:', value)
  // Pitfall 2: recursion renders 2 first, then returns to render the older 1.
  if (value === 1) publish(2)
})
listeners.push((value) => console.log('render:', value))
publish(1)
```

The channel fixes recipients before delivery, and explicit queued dispatch completes the current round without coordination in every listener. Recursive dispatch remains the default; select queued when this order is required.

## The model in three minutes

| Your question                                    | Tool                             |
| ------------------------------------------------ | -------------------------------- |
| Notify without waiting for results?              | Channel `publish()`              |
| Several event names with different payloads?     | `createEventHub()`               |
| Remove subscriptions when a page cancels?        | `subscribeUntil()`               |
| Start everyone together and retain each outcome? | `invokeParallelSettled()`        |
| Wait in order, or invoke exactly one target?     | `invokeSerial()`, `invokeTask()` |

| Term                | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| channel             | A local notification path for one event type, with no current-value storage.  |
| registration        | One subscription, cancelled through its own handle.                           |
| snapshot            | The recipient list fixed when publication starts.                             |
| `taskId`            | A nonempty caller-assigned registration label for selecting a handler.        |
| subscription handle | A callable cancellation function that can also extend its subscription chain. |

## Typical scenarios

| Scenario                                                   | Building blocks         | Details                                                                                         |
| ---------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| Deliver nested notifications after the current round       | `createEventChannel`    | [Runnable example](./USEGUIDE.en.md#deliver-nested-notifications-after-the-current-round)       |
| Change subscriptions without changing the current delivery | `createEventChannel`    | [Runnable example](./USEGUIDE.en.md#change-subscriptions-without-changing-the-current-delivery) |
| Release a page subscription across several event names     | `createEventHub`        | [Runnable example](./USEGUIDE.en.md#release-a-page-subscription-across-several-event-names)     |
| Stop page updates with its cancellation signal             | `subscribeUntil`        | [Runnable example](./USEGUIDE.en.md#stop-page-updates-with-its-cancellation-signal)             |
| Keep successful results when another listener fails        | `invokeParallelSettled` | [Runnable example](./USEGUIDE.en.md#keep-successful-results-when-another-listener-fails)        |
| Wait for one handler before starting the next              | `invokeSerial`          | [Runnable example](./USEGUIDE.en.md#wait-for-one-handler-before-starting-the-next)              |
| Reject duplicate command targets before doing any work     | `invokeTask`            | [Runnable example](./USEGUIDE.en.md#reject-duplicate-command-targets-before-doing-any-work)     |

## Install

```bash
pnpm add @migaia/event-subscriber
```

The root entry provides channels, the Hub and invocation helpers. Import standalone subscription helpers from `@migaia/event-subscriber/subscriber`. Its only runtime dependency is `@migaia/utils`; it needs neither DOM nor Node and declares `sideEffects: false`.

## Essential API

| API                       | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `createEventChannel()`    | Creates a single-event channel with snapshot and reentry rules. |
| `createEventHub()`        | Routes local notifications by event name and payload type.      |
| `subscribeUntil()`        | Ties a subscription lifetime to a cancellation signal.          |
| `invokeParallelSettled()` | Awaits all listeners in parallel and retains every outcome.     |
| `invokeSerial()`          | Waits for each listener before starting the next.               |
| `invokeTask()`            | Requires exactly one `taskId` match before execution.           |

## Contract details

The basic subscription signature is `subscribe(listener, options?: { taskId?: string }): subscription`. The listener receives an event context; optional `taskId` names this registration. The returned subscription cancels its registrations and can extend the chain.

Dynamic event names support runtime fan-out. A finite literal event map rejects repeated event names on the same subscription chain through its TypeScript types; a separate chain can still subscribe to that name.

Defaults are recursive synchronous dispatch, multiple independent registrations, handle-scoped removal, `100_000` listener calls per top-level publish, and non-strict already-aborted admission. Subscription changes, clear and retagging do not change the current snapshot; later invocations select targets anew.

Synchronous `publish()` does not await Promises. Synchronous throws become `PUBLISH_FAILED`; late rejection goes to report. Async helpers await settlement and deliver results or rejection. Settled helpers collect listener failures, while invalid channels and task admission still throw synchronously.

Subscription handles chain and cancel once in reverse order; closed chains cannot extend. Once, signal and object helpers return ordinary cancellation functions without style aliases. Styles rename the same functions; static `valueConfig` adds one path value to the context without transforming events.

The Hub fixes its internal channels to the default policies and accepts no channel policy configuration. It does not aggregate listener results; use a channel with a result type when results matter.

Events are transient notifications, without current state, replay, process transport, resource hosting, drain or backpressure. See the [usage guide](./USEGUIDE.en.md#public-entries-and-boundaries) for every option, naming styles, static value paths, 19 error codes and build commands.
