# `@migaia/event-subscriber` usage guide

[中文](./USEGUIDE.md)

Find your scenario first, then consult the full contract. After installation, save any runnable example as its own `.ts` file and execute it with Node 24. The code is shared with the corresponding website scenario. See the [README](./README.en.md) for package selection.

## Find your scenario

| Your problem                                               | API                     | Read                                                                            |
| ---------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| Deliver nested notifications after the current round       | `createEventChannel`    | [Runnable example](#deliver-nested-notifications-after-the-current-round)       |
| Change subscriptions without changing the current delivery | `createEventChannel`    | [Runnable example](#change-subscriptions-without-changing-the-current-delivery) |
| Release a page subscription across several event names     | `createEventHub`        | [Runnable example](#release-a-page-subscription-across-several-event-names)     |
| Stop page updates with its cancellation signal             | `subscribeUntil`        | [Runnable example](#stop-page-updates-with-its-cancellation-signal)             |
| Keep successful results when another listener fails        | `invokeParallelSettled` | [Runnable example](#keep-successful-results-when-another-listener-fails)        |
| Wait for one handler before starting the next              | `invokeSerial`          | [Runnable example](#wait-for-one-handler-before-starting-the-next)              |
| Reject duplicate command targets before doing any work     | `invokeTask`            | [Runnable example](#reject-duplicate-command-targets-before-doing-any-work)     |

## Deliver nested notifications after the current round

An update listener publishes another update before the other listeners see the first. Hand-written `recursive` callbacks can make a screen show the newer event and then overwrite it with the older one. The `queued` policy finishes the current registration snapshot before delivering the nested value, within the same synchronous `publish` call.

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

Prints `record: 1`, `render: 1`, `record: 2`, `render: 2`, in that order. The nested event does not interrupt the current round. The default policy is `recursive`; `queued` delivery is explicit.

## Change subscriptions without changing the current delivery

A listener removes another listener or installs a new one while an event is being delivered. Walking a mutable callback array can skip a recipient or deliver the current event to a new registration unexpectedly. `publish` takes one registration snapshot: changes affect later publishes, while the current snapshot still completes in registration order.

```ts doc-test=run
import { createEventChannel } from '@migaia/event-subscriber'

const updates = createEventChannel<number>()
const calls: string[] = []
let stopSecond = () => {}
updates.subscribe(({ value }) => {
  calls.push(`first ${value}`)
  if (value === 1) {
    stopSecond()
    updates.subscribe(({ value }) => {
      calls.push(`added ${value}`)
    })
  }
})
stopSecond = updates.subscribe(({ value }) => {
  calls.push(`second ${value}`)
})
updates.publish(1)
updates.publish(2)
console.log(calls.join(' | '))
updates.clear()
```

Output:

```text
first 1 | second 1 | first 2 | added 2
```

Prints `first 1 | second 1 | first 2 | added 2`. Removing the second registration does not remove it from the first snapshot; the new registration first runs on the second `publish`.

## Release a page subscription across several event names

A page listens for save and close events, but its cleanup forgets one event name and the old page keeps receiving updates. A typed hub routes each event to its own payload type. Chaining the page registrations returns one handle that releases the entire chain in reverse order.

```ts doc-test=run
import { createEventHub } from '@migaia/event-subscriber'

type IAppEvents = { saved: { id: string }; closed: string }
const events = createEventHub<IAppEvents>()
const page = events
  .subscribe('saved', ({ value }) => {
    console.log('saved:', value.id)
  })
  .subscribe('closed', ({ value }) => {
    console.log('closed:', value)
  })
events.publish('saved', { id: 'order-1' })
events.publish('closed', 'details')
page()
events.publish('saved', { id: 'order-2' })
console.log('subscriptions left:', events.size())
```

Output:

```text
saved: order-1
closed: details
subscriptions left: 0
```

Prints `saved: order-1`, `closed: details`, then `subscriptions left: 0`. The `publish` after page cleanup prints nothing. One handle removes both registrations in this chain.

## Stop page updates with its cancellation signal

A component starts several operations under one `AbortController` but its event subscription survives navigation. Hand-written abort listeners need both event unsubscription and abort-listener cleanup. `subscribeUntil` ties the registration to the signal and returns an idempotent manual unsubscribe for earlier cleanup.

```ts doc-test=run
import { createEventChannel } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'

const updates = createEventChannel<string>()
const page = new AbortController()
const stop = subscribeUntil(updates, page.signal, ({ value }) => {
  console.log('render:', value)
})
updates.publish('saved')
page.abort()
updates.publish('not shown')
stop()
console.log('subscriptions left:', updates.size)
```

Output:

```text
render: saved
subscriptions left: 0
```

Prints `render: saved`, then `subscriptions left: 0`. Aborting removes future deliveries; calling `stop` afterwards is harmless. An already-running listener is not interrupted, and an already-aborted signal registers nothing by default.

## Keep successful results when another listener fails

An export asks several handlers for results. A rejected `Promise` can hide successful replies if the caller handles only one aggregate failure. `invokeParallelSettled` starts the captured listeners immediately and returns each success or failure in registration order, including the original failure reason. Invalid `channel` admission still throws synchronously.

```ts doc-test=run
import {
  createEventChannel,
  invokeParallelSettled,
  EventSubscriberState
} from '@migaia/event-subscriber'

const checks = createEventChannel<number, number>()
checks.subscribe(async ({ value }) => {
  await Promise.resolve()
  return value * 2
})
checks.subscribe(() => {
  throw new Error('remote unavailable')
})
const results = await invokeParallelSettled(checks, 3)
for (const result of results) {
  if (result.status === EventSubscriberState.fulfilled) console.log('success:', result.value)
  else console.log('failure:', (result.reason as Error).message)
}
checks.clear()
```

Output:

```text
success: 6
failure: remote unavailable
```

Prints `success: 6`, then `failure: remote unavailable`. The second listener fails before the first resumes after its microtask, but the result array follows registration order and retains the successful value.

## Wait for one handler before starting the next

A notification starts before a preceding asynchronous write has finished because `publish` does not wait for listener Promises. `invokeSerial` awaits one captured listener before starting the next. Each receives the same input rather than the previous result. The example logs stand in for a write and a notification.

```ts doc-test=run
import { createEventChannel, invokeSerial } from '@migaia/event-subscriber'

const steps = createEventChannel<string, string>()
steps.subscribe(async ({ value }) => {
  console.log('write:', value)
  await Promise.resolve()
  console.log('write complete')
  return 'written'
})
steps.subscribe(({ value }) => {
  console.log('notify:', value)
  return 'notified'
})
console.log('results:', (await invokeSerial(steps, 'order-1')).join(','))
steps.clear()
```

Output:

```text
write: order-1
write complete
notify: order-1
results: written,notified
```

Prints `write: order-1`, `write complete`, `notify: order-1`, then `results: written,notified`. This controls order, not a transaction: a failed listener does not skip later listeners; failures are aggregated after all have run.

## Reject duplicate command targets before doing any work

A command should run one save handler, but double mounting registers it twice and writes twice. `invokeTask` selects one `taskId` before invoking any listener. A missing name throws `TASK_NOT_FOUND`; duplicate matches throw `TASK_NOT_UNIQUE` with no handler called for that attempt. Other task names are not invoked.

```ts doc-test=run
import { createEventChannel, invokeTask, type IEventContext } from '@migaia/event-subscriber'

const tasks = createEventChannel<number, number>()
let calls = 0
const save = ({ value }: IEventContext<number>) => {
  calls += 1
  return value + 1
}
tasks.subscribe(save, { taskId: 'save' })
tasks.subscribe(({ value }) => value * 10, { taskId: 'preview' })
console.log('save result:', await invokeTask(tasks, 'save', 2))
tasks.subscribe(save, { taskId: 'save' })
try {
  await invokeTask(tasks, 'save', 2)
} catch (error) {
  console.log('duplicate target:', (error as Error & { code?: string }).code)
}
console.log('save calls:', calls)
tasks.clear()
```

Output:

```text
save result: 3
duplicate target: TASK_NOT_UNIQUE
save calls: 1
```

Prints `save result: 3`, `duplicate target: TASK_NOT_UNIQUE`, then `save calls: 1`. The ambiguous second attempt performs no extra save. A selected listener failure rejects with `PUBLISH_FAILED` while retaining its original error.

## Public entries and boundaries

The root entry, `@migaia/event-subscriber`, exports channels, the Hub, invocation helpers, constants and public types. The `@migaia/event-subscriber/subscriber` subpath exports `subscribeOnce`, `subscribeUntil`, `subscribeSubscriber` and their subscription types. The only runtime dependency is `@migaia/utils`. The package needs neither DOM nor Node APIs and declares `sideEffects: false`.

A channel delivers events as they are published. It stores no current value and replays no history. A registration is one subscription and its cancellation ownership. A snapshot fixes the target list when an invocation starts. Use `@migaia/reactive` for current state or derived dependencies, `@migaia/middleware-pipeline` for a sequence that passes each result to the next step, `@migaia/lifecycle` or `@migaia/resource` for resource ownership, queues and backpressure, and `@migaia/rpc-host` + transport plugin for messages crossing Workers, windows or networks.

## Channel creation and every option

`createEventChannel<T, R, S, V>(options?)` creates a channel. `T` is the published payload, `R` is a listener's result and defaults to `void`, `S` is the naming style, and `V` is a static value-path configuration. Both `S` and `V` default to `undefined`. The public options type is `IEventChannelOptions<T, S, V>`. For projection types used only by inference, consult the published declarations and editor hints.

| Option            | Default                                          | Meaning and accepted values                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report`          | `undefined`                                      | Receives `{ event, error }`. Handles listener rejection after synchronous `publish()` returns, plus value-path diagnostics. May return synchronously or return a Promise. Without it, failure goes to terminal diagnostics. Synchronous listener throws are aggregated by `publish()` instead. |
| `terminalReport`  | `undefined`                                      | Receives the diagnostic error when `report` is absent, throws or rejects. May return synchronously or return a Promise. Its own failure continues to host diagnostics.                                                                                                                         |
| `dispatchPolicy`  | `'recursive'`                                    | `'recursive'` immediately delivers a publish made inside a listener; `'queued'` finishes the current snapshot before delivering nested values. Constants: `EventDispatchPolicy.recursive` and `queued`.                                                                                        |
| `admissionPolicy` | `'multiple'`                                     | `'multiple'` creates an independent registration on every subscribe; `'unique'` keeps one registration per listener function identity. Constants: `EventAdmissionPolicy.multiple` and `unique`.                                                                                                |
| `removalPolicy`   | `'handle'`                                       | `'handle'` removes the registration owned by this handle; `'listener-all'` removes every registration of that listener function on this channel. Constants: `EventRemovalPolicy.handle` and `listenerAll`.                                                                                     |
| `publishBudget`   | `100_000`                                        | Maximum listener calls within one top-level synchronous publish, including nested publishes. Must be a positive safe integer. Exhaustion stops expansion and throws `PUBLISH_FAILED`; `error.detail` records processed calls and the remaining budget.                                         |
| `throwOnAborted`  | `false`                                          | `false` makes `subscribeUntil` return a no-op without registering against an already-aborted signal; `true` throws an `ABORTED` TypeError synchronously.                                                                                                                                       |
| `style`           | `undefined`, equivalent to `'subscribe-publish'` | Adds method aliases to the existing operations. See the four presets and custom fields below; dispatch and cancellation semantics stay the same.                                                                                                                                               |
| `valueConfig`     | `undefined`                                      | No alias is added by default. A configured static `readPath` and `alias` expose one payload value on the context; see Static value paths.                                                                                                                                                      |

`options` must be an object, never `null` or an array. Malformed options produce `INVALID_OPTIONS`. Supplied `report` and `terminalReport` values must be callable or produce `INVALID_REPORTER`. An option getter's original failure remains reachable through the error chain.

### Channel methods and event context

| Member                          | What the call does                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe(listener, options?)` | Adds a listener in registration order and returns a callable chain handle. By default `listener(event)` receives the context below; explicit `delivery: EventDelivery.value` calls `listener(value)` with the original payload. Both return `R` or a PromiseLike. The listener must be a function. |
| `subscribe.options.delivery`    | Defaults to `EventDelivery.context` (`'context'`), retaining the payload and context controls. `EventDelivery.value` (`'value'`) passes the original payload without copying or wrapping. Other values throw `INVALID_OPTIONS`.                                                                    |
| `subscribe.options.taskId`      | Defaults to `undefined`, leaving the registration unlabelled. A supplied label must be a nonempty string named by the subscribing caller, for later task selection.                                                                                                                                |
| `publish(value)`                | Calls the entry snapshot synchronously, without waiting for Promises or returning listener results. Removal or `clear()` during dispatch does not remove targets from this snapshot; additions belong to later snapshots.                                                                          |
| `filterTaskId(taskId)`          | Takes a nonempty subscription label and returns an opaque read-only `IFilteredEventChannel` for parallel, serial or visitor helpers. The view has no subscribe or publish method; each invocation selects current matching registrations anew.                                                     |
| `clear()`                       | Removes active registrations without running user cleanup inside listeners. With the default `removalPolicy: 'handle'`, old cancellation handles cannot remove later registrations.                                                                                                                |
| `size`                          | Read-only active registration count. Publishing an empty channel does nothing; asynchronous multi-target invocation returns an empty array.                                                                                                                                                        |

In `unique` mode, subscribing the same function again returns a handle controlling the existing registration generation. Only the first removal changes state. A duplicate subscription must use the same `taskId` and delivery or throws `INVALID_OPTIONS` before state changes. Omitted delivery equals explicit `EventDelivery.context`; an omitted `taskId` matches only an unset label. Resubscribing after removal or `clear()` creates a new generation. A `unique` handle stays bound to its original generation, so it cannot cancel the new registration. The Hub and helpers that register wrappers do not deduplicate the original listener identity. The default combination of `multiple` admission and `removalPolicy: 'handle'` gives each registration independent cancellation.

That isolation does not apply to `admissionPolicy: 'multiple'` combined with `removalPolicy: 'listener-all'`. An old handle that has not yet been called removes all current registrations of its listener function, including new registrations created with that function after `clear()`. Keep the default `handle` removal policy when old handles must not affect later registrations; `unique` separately provides the generation binding described above.

The public subscription options type is `IEventSubscribeOptions`. Default or explicit context overloads use `IEventListener<T, R, V>`. Explicit value overloads pass the original `T` to the listener, accept an `R` or `PromiseLike<R>` result, and require `{ delivery: EventDelivery.value }`. Both modes can coexist on one channel; invocation helpers retain each registration's mode and result semantics.

```ts
import { createEventChannel, EventDelivery, invokeTask } from '@migaia/event-subscriber'

const tasks = createEventChannel<{ id: number }, number>()
const stop = tasks.subscribe((value) => value.id, {
  delivery: EventDelivery.value,
  taskId: 'read-id'
})
console.log(await invokeTask(tasks, 'read-id', { id: 7 })) // 7
stop()
```

Value delivery adds no `abort()`, `aborted`, `abortReason`, `setTaskId()`, `taskId` or `valueConfig` alias; the payload itself is not modified. The registration label still supports `filterTaskId()` and `invokeTask()`. Keep default context delivery for cancellation, retagging or projected aliases inside a listener.

| `IEventContext<T>` member | Meaning                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `value`                   | The original published value, preserving object identity.                                                                                                    |
| `aborted`, `abortReason`  | Live cancellation state and reason for this registration; a running callback can observe updates.                                                            |
| `taskId`                  | The task label captured in this invocation's snapshot, unaffected by retagging during the current invocation.                                                |
| `abort(reason?)`          | Cancels this registration. The reason defaults to `undefined`. Idempotent and a no-op after deactivation; it does not interrupt an already-running callback. |
| `setTaskId(taskId)`       | Accepts a nonempty string or `undefined` to remove the label. Affects later snapshots only; inactive registrations ignore it.                                |

### Naming styles and subscription chains

`EventApiStyle` exports `subscribePublish`, `onEmit`, `onTrigger` and `listenFire`. Use these constants when comparing or retaining configuration across modules.

| Preset value        | Subscribe   | Publish   | Cancel        |
| ------------------- | ----------- | --------- | ------------- |
| `subscribe-publish` | `subscribe` | `publish` | `unsubscribe` |
| `on-emit`           | `on`        | `emit`    | `off`         |
| `on-trigger`        | `on`        | `trigger` | `off`         |
| `listen-fire`       | `listen`    | `fire`    | `unlisten`    |

A custom `style` maps semantic operations to names, for example `{ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' }`. `style.subscribe` and `style.publish` are required; `style.unsubscribe` defaults to `'unsubscribe'`. Names must be nonempty, distinct strings. They cannot take another operation's canonical name, `subscribeOnce`, `subscribeUntil`, `filterTaskId`, `clear`, `size`, `__proto__`, `prototype` or `constructor`. Invalid configuration throws `INVALID_OPTIONS` during construction.

Preserve literal names with `as const satisfies IEventApiStyleNames`. When explicitly supplying a payload type, supply custom channel style `S` as the third generic parameter; for the Hub, use the second. An object widened to ordinary `string` does not grant an arbitrary method-name index signature. Literal presets have their own inference overloads.

Canonical methods always remain available. Each alias is the same function as its canonical method, rather than a second dispatcher. The default style adds no alias properties; additional aliases are non-enumerable, non-writable, non-configurable own data properties. Styles add no flush, queue, drain, backpressure or process transport.

`channel.subscribe()` returns `IEventChannelSubscription`; `hub.subscribe()` returns `IEventHubSubscription`. A handle is callable, and `handle.unsubscribe === handle`. Chained `handle.subscribe(...)` returns the same chain. Styled subscription and cancellation aliases preserve function identity too. Channel and handle subscribe methods or aliases accept both `taskId` and delivery options. Hub and Hub-handle `subscribe(key, listener, options?)` methods or aliases accept only delivery, without `taskId`. Cancellation runs every disposer in reverse append order and executes only once. A single disposal failure is rethrown unchanged; several produce `SUBSCRIPTION_DISPOSE_FAILED` with original failures in execution order on `AggregateError.errors`. Extending a closed chain throws `SUBSCRIPTION_CLOSED`.

Chain extension is not transactional: if a later subscription fails, earlier registrations still belong to the original handle and must be cleaned up through it. Failure while projecting the first handle's aliases rolls back that registration and preserves the original failure under `SUBSCRIPTION_HANDLE_PROJECTION_FAILED`. A finite literal event map excludes keys already used on the same Hub chain; a separate chain may still subscribe to that key. Wide keys, index signatures and runtime union keys preserve dynamic fan-out.

## Standalone subscription helpers

Import these functions from `@migaia/event-subscriber/subscriber`. They require only a structurally compatible `channel.subscribe(listener, options?)`, not factory identity. The method must return a cancellation function and must not deliver an event synchronously before installation finishes; an invalid source produces `INVALID_CHANNEL`. Object method receivers are preserved. `subscribeOnce`, `subscribeUntil` and object subscribers remain context-only; they accept no value delivery option.

| API                                                   | Inputs and behavior                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribeOnce(channel, listener, options?)`          | Requires a channel and function. `options.taskId` defaults to `undefined`. Removes the subscription before its first callback, so synchronous reentry, a throw or a rejected Promise cannot run it twice.                                 |
| `subscribeUntil(channel, signal, listener, options?)` | Requires a channel, signal and function. `options.taskId` defaults to `undefined`. Signal cancellation removes the subscription; manual unsubscribe also removes the signal listener. Cancellation does not interrupt a running callback. |
| `subscribeSubscriber(channel, subscriber)`            | Requires an object with callable `handle(event)`. It receives the event context, may return a result or PromiseLike, and retains `this`. A missing method produces `INVALID_SUBSCRIBER`.                                                  |

All return a synchronous, idempotent `IUnsubscribe`, without styled `off`, `dispose`, `unlisten` aliases or chain extension. Use the channel's own subscription method for styled chains.

`subscribeUntil` accepts native `AbortSignal` or a compatible object with boolean `aborted`, optional `reason`, and callable `addEventListener` and `removeEventListener` methods. The event type is `'abort'`. Invalid signals produce `INVALID_SIGNAL`. Already-aborted signals create no registration by default; a canonical channel explicitly configured with `throwOnAborted: true` throws `ABORTED`.

Object subscribers need only `IEventSubscriber.handle(event)`. The old draft's abstract `EventSubscriber`, static `EVENT_NAME` (nor `EVENTNAME`) and `onCall()` are outside the current API. The supplied channel determines the source. Hub subscription keys determine event names; subscriber classes do not repeat that information.

## Waiting for asynchronous listeners

Every `invoke*` helper fixes its target snapshot synchronously before waiting. These helpers accept a canonical channel created by the same physical package instance, or an allowed `filterTaskId()` view. A fabricated object, Hub or channel from another package copy produces `INVALID_CHANNEL`. `value` is the value delivered to each listener; there is no extra options argument.

| API                                         | Scheduling and result                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invokeParallelSettled(channel, value)`     | Starts all targets immediately, waits for every settlement, and returns `IListenerResult<R>[]` in registration order, independent of completion order. Listener throws and rejections become result items. |
| `invokeParallel(channel, value)`            | Same scheduling. Returns values when all succeed; on any listener failure, waits for every target before rejecting with a `PUBLISH_FAILED` AggregateError.                                                 |
| `invokeSerialSettled(channel, value)`       | Starts each target after the previous one settles, continuing after failure. Returns settlements in registration order.                                                                                    |
| `invokeSerial(channel, value)`              | Same scheduling, including continuing after failure. Throws aggregated failures at the end, or returns values when all succeed.                                                                            |
| `invokeTaskSettled(channel, taskId, value)` | Accepts only a canonical channel, selects exactly one task, and returns its successful or failed settlement.                                                                                               |
| `invokeTask(channel, taskId, value)`        | Same exact selection. Returns the successful value, or rejects with `PUBLISH_FAILED` containing the one original listener failure.                                                                         |

A settlement is `{ status: 'fulfilled', value: Awaited<R> }` or `{ status: 'rejected', reason: unknown }`. Compare `EventSubscriberState.fulfilled` and `rejected` for result status; `EventSubscriberState.abort` is the signal event name. Settled helpers turn listener failures into values, but invalid channels and task selection still throw synchronously.

Serial invocation is not a waterfall. Every listener gets the same original payload, not the previous result. These helpers deliver listener failures through return values or rejection rather than also sending them to `report`. Value-path diagnostics retain their separate reporting behavior.

`taskId` comes from subscription `options.taskId` or a later `event.setTaskId()` and must be a nonempty string. Zero matches throw `TASK_NOT_FOUND` synchronously; multiple matches throw `TASK_NOT_UNIQUE`, both before any target executes. The error has enumerable `taskId` and `matchCount` fields. Tasks are labels within the supplied channel, not a global task registry.

### Advanced visitors

`withSnapshotEntries(channel, value, visitor)` gives the visitor an immutable `IEventInvocation[]` for this call. The integration chooses invocation order. `entry.taskId` is the captured label; `entry.invoke()` returns the listener's raw result or PromiseLike and may be called only once. The visitor may finish synchronously or return a Promise. When it returns or settles, every entry closes; later calls throw `INVOCATION_CLOSED`. A visitor throw or rejection receives `VISITOR_FAILED`. Attachable native errors retain identity and stack; other original values remain on `cause`. Entries close on failure too.

`invokeEachLive(channel, value, visitor)` gives a synchronous visitor one invocation at a time. New subscriptions appended during visitation may join this traversal; each registration is visited at most once. The visitor must finish synchronously. A throw still releases internal traversal state and receives `VISITOR_FAILED`. Use this only for framework integrations that require append visibility. Ordinary application code should use snapshot helpers.

## Routing multiple events with a Hub

`createEventHub<C, S, V>(options?)` links keys to payloads through event map `C`. Its options are only `report`, `terminalReport`, `style` and `valueConfig`, with the same defaults and meanings as channels. The report argument also includes the published `key`. Hub listeners return `void` or `PromiseLike<void>`; results are not aggregated. Create a separate `createEventChannel<T, R>()` when an event needs results.

| Member                               | Behavior                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe(key, listener, options?)` | The event-map key is a string, number or symbol, and the listener must be a function. The third argument accepts only delivery: default or explicit `EventDelivery.context` receives the context; `EventDelivery.value` receives that key’s original payload. It accepts no `taskId`. Creates an internal channel only for the first subscription to a key. Returns a callable chain. |
| `publish(key, value)`                | Delivers the correctly typed value only to this key. An unregistered key does nothing and creates no channel.                                                                                                                                                                                                                                                                         |
| `clear(key?)`                        | A supplied key removes all its registrations and its empty channel. Omitting the key clears all events.                                                                                                                                                                                                                                                                               |
| `size(key?)`                         | A supplied key returns its active count, or zero if absent. Omission returns the total, maintained by a counter without traversing every key.                                                                                                                                                                                                                                         |

Invalid keys produce `INVALID_EVENT_KEY`; invalid listeners produce `INVALID_LISTENER`. Old handles cannot cancel newly recreated registrations after `clear()`. Internal Hub channels fix recursive dispatch, multiple admission, handle removal, a `100_000` invocation budget and non-strict aborted admission. The Hub exposes neither its channels nor channel policy options. Use a channel to select those policies. `EventRemovalPolicy.listenerAll` supports whole-function removal where a caller reuses the same listener identity, including logger hook unregistration.

## Static value paths

`valueConfig` fixes a path at construction and adds that payload value to context delivery while preserving the original `event.value` and all controls. Value delivery still receives the original payload without an alias. It stores, transforms and replays no events.

| Field                  | Meaning                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `valueConfig.readPath` | A static `IObjectPath<T>` or empty string. Empty or whitespace-only paths disable the entire projection before reading alias, parsing, probing or reporting.                                   |
| `valueConfig.alias`    | An active path requires a nonempty name with no leading or trailing whitespace. It cannot collide with context members, `__proto__`, `prototype` or `constructor`. `resource` is not reserved. |

Preserve path and alias literals with `as const` or explicit `V`: the channel's fourth generic parameter and the Hub's third. Each publish or invocation probes the path once, sharing the projected value's identity across all targets. The alias is an enumerable, non-writable, non-configurable own data property.

Missing or blocked paths and getter failures report `VALUE_PROJECTION_FAILED`; listeners still run with an `undefined` alias. A present leaf whose value is `undefined` is successful and does not report. Original getter failures remain on the cause chain. No targets means no path probe. Function selectors, transforms, operators, fallbacks and lazy per-listener projection are unsupported.

## Errors and diagnostics

`publish()` attempts the synchronous listener snapshot, collects its throws, then throws a `PUBLISH_FAILED` AggregateError. A returned Promise rejecting after the call returns goes to `report`. Late failure does not make synchronous publishing awaitable.

If `report` is absent or fails, diagnostics try `terminalReport`, then host `reportError`, `console.error`, and a queued microtask throw. Without microtask support, the final throw is synchronous. Failures of reporters remain in the diagnostic error chain; they are not silently dropped.

Package errors use `EVENT_SUBSCRIBER_SOURCE`, whose value is `'event.subscriber'`, as their `source`. Admission preserves native `TypeError`; publication aggregation preserves `AggregateError`. Original failures remain reachable through `errors` and `cause`. With listener failures, `cause` is the first failure. Budget-only failure may have an empty `errors` array. Compare `EventSubscriberErrorCode` members instead of scattering code strings. `EventSubscriberErrorText` is an internal message table, not a public export; application code must not import it. To lock down user-facing text, assert the actual error's `message`.

| Error member                         | Code                                    | Trigger                                                                                                 |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `invalidListener`                    | `INVALID_LISTENER`                      | Listener is not a function.                                                                             |
| `invalidReporter`                    | `INVALID_REPORTER`                      | report or terminalReport is not callable.                                                               |
| `invalidChannel`                     | `INVALID_CHANNEL`                       | Invalid structural source, or invocation receives a non-canonical channel from this package instance.   |
| `invalidSignal`                      | `INVALID_SIGNAL`                        | Invalid signal shape, signal callback failure or signal cleanup failure.                                |
| `aborted`                            | `ABORTED`                               | Strict channel admission receives an already-aborted signal.                                            |
| `invalidSubscriber`                  | `INVALID_SUBSCRIBER`                    | Object subscriber has no callable handle method.                                                        |
| `invalidEventKey`                    | `INVALID_EVENT_KEY`                     | Hub key is not a string, number or symbol.                                                              |
| `taskNotFound`                       | `TASK_NOT_FOUND`                        | A task label matches no registration.                                                                   |
| `taskNotUnique`                      | `TASK_NOT_UNIQUE`                       | A task label matches multiple registrations; error includes the match count.                            |
| `invalidTaskId`                      | `INVALID_TASK_ID`                       | Task label is not a nonempty string.                                                                    |
| `invalidOptions`                     | `INVALID_OPTIONS`                       | Invalid options, policy, naming style or path configuration.                                            |
| `publishFailed`                      | `PUBLISH_FAILED`                        | Listener failure, or exhausted synchronous budget with targets left undelivered.                        |
| `visitorFailed`                      | `VISITOR_FAILED`                        | Snapshot/live visitor throws, or snapshot visitor rejects.                                              |
| `valueProjectionFailed`              | `VALUE_PROJECTION_FAILED`               | Active value path is missing, blocked or its getter fails.                                              |
| `unhandledListenerFailure`           | `UNHANDLED_LISTENER_FAILURE`            | Late listener failure reaches terminal diagnostics.                                                     |
| `subscriptionClosed`                 | `SUBSCRIPTION_CLOSED`                   | An already-closed subscription chain is extended.                                                       |
| `subscriptionHandleProjectionFailed` | `SUBSCRIPTION_HANDLE_PROJECTION_FAILED` | Handle alias projection fails after registration; registration rolls back and original failure remains. |
| `invocationClosed`                   | `INVOCATION_CLOSED`                     | Captured invocation already ran or its visitor scope closed.                                            |
| `subscriptionDisposeFailed`          | `SUBSCRIPTION_DISPOSE_FAILED`           | Several disposers fail while closing a chain; every disposer is still attempted.                        |

## Troubleshooting and build commands

For `PUBLISH_FAILED`, inspect `error.errors` for original listener failures. A synchronous budget failure can occur without listener errors. For task selection failure, check labels and registration lifetimes instead of choosing an arbitrary duplicate. Closed chains need a new subscription. If a Promise failure appears only in report, check whether rejection happened after synchronous `publish()` returned.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
