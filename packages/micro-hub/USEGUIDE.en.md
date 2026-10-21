# `@migaia/micro-hub` user guide

[中文](./USEGUIDE.md)

## Contents

- [1. Hub](#1-hub)
- [2. Contracts](#2-contracts)
- [3. App handle](#3-app-handle)
- [4. State](#4-state)
- [5. Events and requests](#5-events-and-requests)
- [6. Persistence](#6-persistence)
- [7. Shared asynchronous values](#7-shared-asynchronous-values)
- [8. Web Components](#8-web-components)
- [9. Lifecycle and concurrency](#9-lifecycle-and-concurrency)
- [10. Public constants](#10-public-constants)
- [Error codes](#error-codes)

## 1. Hub

| API | Description |
| --- | --- |
| `createMicroHub({ plugins, report? })` | Creates the single hub of the page. It checks every plugin's dependencies first and installs the plugins only when all of them are met. Throws `HUB_ALREADY_CREATED` when a hub already exists. |
| `getMicroHub()` | Returns the hub; throws `HUB_NOT_CREATED` when none has been created. |
| `hub.connect(name)` | Connects an app. The name must be non-empty and must not contain `.`; throws `APP_ALREADY_CONNECTED` while an app with the same name is still connected. |
| `hub.apps` | Names of the connected apps, in connection order. |
| `hub.dispose()` | Disconnects every app and releases the hub; `createMicroHub` can be called again afterwards. Repeated calls return the same Promise. |

`report(error)` receives errors that must not interrupt the current operation: exceptions from listeners and subscription callbacks, and cleanup failures. When omitted, the hub uses `globalThis.reportError`, or `console.error` when that is missing. If `report` itself throws, both errors go to the default reporter.

## 2. Contracts

`defineContract(name, spec)` only validates and freezes; it has no side effects. The hub registers a contract the first time an app calls `use()` or `own()` with it.

| Field | Description |
| --- | --- |
| `version` | Positive integer major version. The first registration of a name decides the version; a different version later throws `CONTRACT_VERSION_MISMATCH`. |
| `state` | Initial field values, or `keyed<T>()`. Initial values are copied with `structuredClone` and frozen at the top level, so they must be structured-cloneable. |
| `computed` | `(state) => value`. Depends only on the fields it actually reads. |
| `commands` | `(state, ...args) => patch`. Must be synchronous; the patch contains only the fields to change. |
| `writers` | Apps other than the owner that may call commands. By default only the owner can write. |
| `events` | `event<T>()`. Only the owner can emit. |
| `requests` | `request<In, Out>()`. The owner registers exactly one handler. |
| `resources` | `resource<T>()`. The owner provides a fetcher. |

Invalid names, versions that are not positive integers, and section members of the wrong kind throw `INVALID_OPTION` (`TypeError`).

## 3. App handle

The shell and child apps receive exactly the same `IMicroApp`:

| Member | Description |
| --- | --- |
| `name` / `connected` | The app name; `connected` becomes false after `disconnect()`. |
| `use(contract)` | Returns the contract view. Repeated calls by the same app for the same contract return the same object. |
| `own(contract, options?)` | Claims ownership and returns the view plus the owner-only members. Throws `CONTRACT_OWNED` when the contract already has an owner. |
| `disconnect()` | Synchronously releases every subscription, handler and ownership, then unloads the app from plugin-host. Repeated calls return the same Promise. |

After disconnecting, calling any member of the handle or a view throws `APP_DISCONNECTED`. Owner-only members:

| Member | Description |
| --- | --- |
| `events.<name>.emit(payload)` | Delivers synchronously to every listener. |
| `handle(name, handler)` | Registers a request handler; registering twice throws `HANDLER_DUPLICATED`. Returns an unregister function. |
| `provide(name, fetcher)` | Registers the fetcher of a shared asynchronous value. Returns an unregister function. |
| `persistence` | The store-persist `IPersistHandle` when persistence was requested, otherwise `undefined`. |
| `release()` | Gives up ownership so another app can claim it. The state is kept. |

## 4. State

On a view, `state.<field>` is an `IReadable<T>`; a `keyed` field is `{ at(id): IReadable<T | undefined>; ids: IReadable<readonly string[]> }`.

- `get()` returns the same reference until the next commit.
- `subscribe(listener)` calls `listener()` after every later commit, without a value; `get()` inside the callback already returns the new value. The returned cancel function can be called more than once, and cancellation happens automatically when the app disconnects.
- When one command writes several fields, every subscriber is notified once, after the whole batch.
- Writing one id of a keyed field notifies only that id's subscribers; `ids` notifies only when ids are added or removed.

`commands.<name>(...args)` returns `{ revision }`. Throws `WRITE_DENIED` when the caller is neither the owner nor listed in `writers`. Throws `COMMAND_ASYNC` (`TypeError`) when the command returns a thenable, and the state stays unchanged. A patch field that the contract does not declare throws `INVALID_OPTION`, and no field is written.

`select(selector, equals?)` returns an `IReadable<R>`. It notifies only when `equals` (default `Object.is`) reports a changed result. While nobody subscribes, `get()` caches by revision and keeps the old reference when the result is equal. The internal node is released when the last subscriber leaves.

`revision` counts the commits of the contract.

## 5. Events and requests

- `events.<name>.on(listener)` returns a cancel function; cancellation happens automatically on disconnect.
- The owner's `emit` delivers synchronously, calling listeners in registration order. An emit made inside a listener is queued and runs after the current delivery finishes. One top-level emit can cause at most `publishBudget` (default 10 000) listener calls; beyond that, delivery stops and the overflow is reported. This prevents two apps that emit in reaction to each other from looping forever.
- Errors thrown by a listener go to `report`. They do not affect other listeners and are not thrown to the emitter.

`requests.<name>(input, { waitForOwner? })`:

- When the owner has registered a handler, it is called and its result is returned; an error thrown by the handler rejects the call unchanged.
- When there is no handler and `waitForOwner` is not set, the call rejects with `OWNER_ABSENT`.
- When `waitForOwner` is set, the call waits for a handler to be registered. It rejects with `OWNER_TIMEOUT` on timeout, and with `APP_DISCONNECTED` if the caller disconnects while waiting.
- When the owner disconnects or calls `release()` while a call is in progress, the call rejects with `OWNER_GONE`. The handler's side effects may already have happened; reconcile before retrying.

## 6. Persistence

`persist({ store, debounceMs?, keyPrefix? })` requires `state()`. `store` is any `IKeyValueStore`, for example `localStorageHost({ namespace })` from `@migaia/storage-web/local-storage` or `indexedDbHost({ dbName })` from `@migaia/storage-web/indexed-db`. Despite the `Host` in their names, these two factories return only a store and do not create a storage-web host. micro-hub does not use storage-web's `./plugins/*`, which can only be installed into a storage host. The hub borrows the store and never releases it.

`own(contract, { persist: ['items'], persistKey? })` writes the selected plain fields to `<keyPrefix><persistKey ?? contract name>` and reads them back when the owner starts. Writes made while reading back are not overwritten by the saved data (the store-persist hydrate merge rule). When the owner changes within the same hub, fields that were already restored or written keep their in-memory values and are not overwritten by the old saved data; a new hub still restores the saved data. The saved version is the contract `version`; after a major version upgrade the old data is discarded and the fields start from the contract's initial values. `owned.persistence.ready` resolves after the first successful read-back. Persistence stops when the owner disconnects or calls `release()`. Keyed fields cannot be persisted.

Asynchronous writes to the same storage key within one hub keep their order across an owner handover: the new attachment's reads, writes and deletes wait until the previous owner's accepted writes and final write have finished, so `persistence.ready` may wait for the previous owner to release. `hub.dispose()` also waits for these writes. Failures go to the hub's `report` and do not prevent the next owner from restoring and writing.

## 7. Shared asynchronous values

`resources()` requires the optional peer `@migaia/resource`. After the owner calls `provide(name, (signal) => fetch(...))`:

- `resources.<name>.read()` resolves immediately when a value exists, returns the same Promise while a request is in progress, and starts a request otherwise. Concurrent reads share one request.
- `resources.<name>.state` is an `IReadable<{ status, data, error }>`. Subscribing starts observing the resource.
- `resources.<name>.refetch()` discards the cached value and requests again; failures go to `report`.
- Before the owner provides a fetcher, `read()` rejects with `OWNER_ABSENT` and `state.get()` has status `idle`.

## 8. Web Components

| API | Description |
| --- | --- |
| `MICRO_APP_CONTEXT` | The Context Protocol context key (a string). |
| `provideMicroApp(element, app)` | Makes `element` answer `context-request` events from its descendants, including inside shadow DOM. It also answers helper requests that were waiting, and dispatches `context-provider` so an external ContextRoot replays its subscription requests. Returns a stop function. |
| `consumeMicroApp(element, callback)` | Dispatches a `context-request` (`bubbles`, `composed`); waits when there is no provider yet. Returns a cancel function. |

When a Lit consumer may connect before the provider, connect a `ContextRoot` on a common ancestor first and set `@consume({ context: MICRO_APP_CONTEXT, subscribe: true })`. ContextRoot records unanswered subscription requests and, when it receives the provider's `context-provider`, re-dispatches them from the original consumers. This package reuses that protocol and does not create a ContextRoot of its own.

## 9. Lifecycle and concurrency

- Each app is a plugin of the hub's internal plugin-host. `disconnect()` first releases resources synchronously and then unloads the plugin asynchronously, so no callback reaches an app that is being unloaded. Reconnecting immediately with the same name is allowed.
- Commands run synchronously, so they are naturally serial within one realm. A command called inside a subscription callback commits after the current batch finishes.
- State is kept after the owner disconnects; a new owner can claim the contract and keep writing.

## 10. Public constants

The three constant objects exported from the root entry are frozen literals; their values are part of the public contract.

| Constant | Values | Use |
| --- | --- | --- |
| `MicroResourceStatus` | `idle`, `pending`, `success`, `error`, `cancelled` | The `status` of `resources.<name>.state.get()`. `idle` means the owner has not called `provide` yet; `cancelled` means the request was replaced by a newer one or the owner released it. Compare with `status === MicroResourceStatus.success`. |
| `MicroCapability` | `events`, `state`, `persist`, `resource` | The capability kind names. Each plugin declares one kind, and `PLUGIN_MISSING` messages name them. Use them when writing a custom plugin or when explaining which capability is missing. |
| `MicroHubErrorText` | The message, or message factory, of every error code | Every message this package throws comes from here, for example `MicroHubErrorText.appDisconnected('cart')`. Branch on `code`; refer to this object only when a test or a log needs the exact wording. |

```ts
import { MicroResourceStatus } from '@migaia/micro-hub'

const { status, data } = view.resources.profile.state.get()
if (status === MicroResourceStatus.success) render(data)
```

## Error codes

| Code | Type | Thrown when | What the caller should do |
| --- | --- | --- | --- |
| `HUB_ALREADY_CREATED` | Error | `createMicroHub` is called while a hub exists | Child apps use `getMicroHub()` |
| `HUB_NOT_CREATED` | Error | No hub exists, or it has been disposed | Create the hub in the shell first |
| `APP_ALREADY_CONNECTED` | Error | An app with the same name is still connected | Disconnect the old instance first |
| `APP_DISCONNECTED` | Error | A handle is used after disconnecting | Connect again |
| `PLUGIN_MISSING` | Error | A capability needed by a contract or a plugin is not installed | Add it to `plugins` |
| `CONTRACT_VERSION_MISMATCH` | Error | A contract name is used with a different major version | Align the deployed versions |
| `CONTRACT_OWNED` | Error | The contract already has an owner | Wait for the owner to disconnect or call `release()` |
| `WRITE_DENIED` | Error | The caller is neither the owner nor in `writers` | Add it to `writers`, or use a request instead |
| `EMIT_DENIED` | Error | An owner-only member (emit, handle, provide) is called after `release()` | Claim ownership again |
| `COMMAND_ASYNC` | TypeError | A command returns a thenable | Finish the async work before calling the command |
| `HANDLER_DUPLICATED` | Error | `handle` / `provide` is registered twice | Remove the duplicate registration |
| `OWNER_ABSENT` | Error | No handler exists when the request is made | Pass `waitForOwner`, or retry later |
| `OWNER_TIMEOUT` | Error | Waiting for a handler timed out | Report the failure, or retry later |
| `OWNER_GONE` | Error | The owner left while a request was in progress | Reconcile, then retry |
| `INVALID_OPTION` | TypeError | A name, version, member or patch field is invalid | Fix the call |
