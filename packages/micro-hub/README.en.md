# `@migaia/micro-hub`

[中文](./README.md)

Communication and shared state between micro-frontends (Module Federation remotes and Web Components). A page has exactly one hub: the shell creates it, and the shell and every child app call the same `connect(name)` to get a handle of the same shape. Through **contracts**, apps read and write state, send and receive events, and make requests.

## Why use it

Most community solutions cover only one part of the problem. qiankun's `initGlobalState` is one big object, and every change calls back every app. An event bus has no current value, so a subscriber that arrives late misses the event. Sharing zustand or redux through Module Federation lets any app change any state. micro-hub puts these concerns into one model:

- **Every piece of state has an owner.** A contract has one owner at a time. Only the owner and the apps listed in the contract's `writers` can write; other apps can only read. When something goes wrong, you can tell which app changed it.
- **Contracts are typed and versioned.** When two independently deployed apps disagree on a contract's major version, `use()` throws `CONTRACT_VERSION_MISMATCH` instead of silently mixing data.
- **Unmounting leaves nothing behind.** `disconnect()` releases every subscription, handler and ownership the app registered, in one call. Remounting does not produce duplicate or stale callbacks.
- **Notifications only where needed.** Each field, each entity id and each `select()` result is its own subscription point. Several writes in one command notify once.
- **Commands commit synchronously.** A command is a synchronous pure function, so no update is lost across an `await`.
- **Zero copies within one realm.** Nothing is serialized and nothing goes through postMessage. Committed values are frozen at the top level so another app cannot modify them in place.
- **Plugins.** Install `events()` if you only need messaging, `state()` if you only need state, and add `persist()` when you need persistence.
- **Framework-neutral.** The public surface is `get()` plus `subscribe()`, so React, Vue, Svelte, Solid, Angular and plain Web Components connect in a few lines.

## When to use it

**Use it for** several apps on the same page (the same JS realm): remotes loaded through Module Federation, child apps mounted as Web Components, and the shell itself.

**Do not use it for:**

- iframes, Workers, or other browser tabs. These are separate realms; use [`@migaia/rpc-browser`](../rpc-browser/README.en.md).
- State that belongs to a single app on the page. Use [`@migaia/store-keyed`](../store-keyed/README.en.md) or [`@migaia/store-light`](../store-light/README.en.md) directly.

## Installation

```bash
pnpm add @migaia/micro-hub
```

Install the optional peer `@migaia/resource` only when you share asynchronous values. Persistence needs a storage backend, for example `@migaia/storage-web`.

### Module Federation configuration

The hub must be a single copy for the whole page. Declare it as a singleton in the shell and in every remote:

```ts
shared: {
  '@migaia/micro-hub': { singleton: true, requiredVersion: '^0.0.1' }
}
```

If a remote's `requiredVersion` falls outside the range the shell provides, Module Federation falls back to the remote's own copy, and events and state silently split in two. Check that every app uses the same version range before release. Use an async boundary for the entry (`import('./bootstrap')`) to avoid "Shared module is not available for eager consumption".

## Quick start

### 1. Define a contract (maintained by the owner team and shared through an MF expose)

```ts
import { defineContract, event, keyed, request } from '@migaia/micro-hub'

type ICartItem = { id: string; price: number }

export const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly ICartItem[], byId: keyed<ICartItem>() },
  computed: { total: (s) => s.items.reduce((sum, item) => sum + item.price, 0) },
  commands: {
    add: (s, item: ICartItem) => ({ items: [...s.items, item], byId: { [item.id]: item } })
  },
  writers: ['product'],
  events: { checkedOut: event<{ orderId: string }>() },
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() }
})
```

### 2. Create the hub in the shell

```ts
import { createMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'
import { persist } from '@migaia/micro-hub/persist'
import { localStorageHost } from '@migaia/storage-web/local-storage'

createMicroHub({
  plugins: [events(), state(), persist({ store: localStorageHost({ namespace: 'shop' }) })]
})
```

### 3. Connect each app (the shell and child apps use the same code)

```ts
import { getMicroHub } from '@migaia/micro-hub'
import { cart } from 'cart/contract'

// Owner: the cart app
const app = getMicroHub().connect('cart')
const owned = app.own(cart, { persist: ['items'] })
owned.handle('checkout', async ({ coupon }) => {
  const orderId = await submitOrder(owned.state.items.get(), coupon)
  owned.events.checkedOut.emit({ orderId })
  return { orderId }
})

// Consumer: the product app
const product = getMicroHub().connect('product')
const view = product.use(cart)
view.commands.add({ id: 'sku-1', price: 42 })          // product is in writers, so it may write
view.computed.total.subscribe(() => render(view.computed.total.get()))
view.events.checkedOut.on(({ orderId }) => toast(orderId))
const { orderId } = await view.requests.checkout({}, { waitForOwner: 3000 })

// On unmount
await product.disconnect()
```

## Framework integration

`IReadable` has only `get()` and `subscribe()`. `get()` returns the same reference until the next commit. Notifications carry no value; calling `get()` inside the callback already returns the new value.

```ts
// React
const total = useSyncExternalStore(view.computed.total.subscribe, view.computed.total.get)

// Vue
const total = shallowRef(view.computed.total.get())
onScopeDispose(view.computed.total.subscribe(() => (total.value = view.computed.total.get())))

// Svelte
const total = readable(view.computed.total.get(), (set) =>
  view.computed.total.subscribe(() => set(view.computed.total.get()))
)
```

## Web Components

When a child app is mounted as a custom element, it can get its app handle without a global variable. `@migaia/micro-hub/web-component` implements the `context-request` event of the community Context Protocol, so Lit's `@consume({ context: MICRO_APP_CONTEXT })` works as well:

```ts
import { consumeMicroApp, provideMicroApp } from '@migaia/micro-hub/web-component'

provideMicroApp(document.querySelector('#checkout-slot')!, app)   // shell

class CheckoutElement extends HTMLElement {
  connectedCallback() {
    consumeMicroApp(this, (app) => this.render(app.use(cart)))   // child app
  }
}
```

When `consumeMicroApp` is mounted before the provider, the request waits and is answered once the provider appears. If an external Lit consumer may mount first, connect a `ContextRoot` on a common ancestor and use `@consume({ context: MICRO_APP_CONTEXT, subscribe: true })`. `provideMicroApp` dispatches a `context-provider` event that crosses shadow DOM, which makes the ContextRoot replay early requests.

## Plugins

| Plugin | Subpath | Requires | Provides |
| --- | --- | --- | --- |
| `events(options?)` | `@migaia/micro-hub/events` | — | The contract's `events` and `requests` |
| `state()` | `@migaia/micro-hub/state` | — | `state`, `computed`, `commands`, `select`, `keyed()` |
| `persist({ store })` | `@migaia/micro-hub/persist` | `state` | `own(contract, { persist })` |
| `resources()` | `@migaia/micro-hub/resource` | Optional peer `@migaia/resource` | The contract's `resources` |

When a contract uses a plugin that is not installed, `use()` / `own()` throws `PLUGIN_MISSING`. When a plugin's own dependency is not installed, `createMicroHub()` throws `PLUGIN_MISSING` and no hub is created.

## Errors

Every error carries `source: 'micro-frontend.hub'` and a `code` (`MicroHubErrorCode`): `HUB_ALREADY_CREATED`, `HUB_NOT_CREATED`, `APP_ALREADY_CONNECTED`, `APP_DISCONNECTED`, `PLUGIN_MISSING`, `CONTRACT_VERSION_MISMATCH`, `CONTRACT_OWNED`, `WRITE_DENIED`, `EMIT_DENIED`, `COMMAND_ASYNC`, `HANDLER_DUPLICATED`, `OWNER_ABSENT`, `OWNER_TIMEOUT`, `OWNER_GONE`, `INVALID_OPTION`. See the [USEGUIDE](./USEGUIDE.en.md#error-codes) for when each code is thrown and what to do.

To branch on an error, compare `error.source === MICRO_HUB_SOURCE` and `error.code`; do not match the message text. `MicroHubErrorText` exports every message; refer to it when a test or a log needs to check the exact wording.

Errors thrown by listeners and subscription callbacks do not stop other listeners and do not reach the emitter. They go to `createMicroHub({ report })`, which defaults to `globalThis.reportError`.

## Related packages

| Package | Relationship |
| --- | --- |
| [`@migaia/store-keyed`](../store-keyed/README.en.md) | One atom per field and per entity id |
| [`@migaia/event-subscriber`](../event-subscriber/README.en.md) | Event channels and request handler selection |
| [`@migaia/plugin-host`](../plugin-host/README.en.md) | Installing and unloading capability plugins and each app |
| [`@migaia/store-persist`](../store-persist/README.en.md) | Persistence debouncing, versions and hydrate races |
| [`@migaia/rpc-browser`](../rpc-browser/README.en.md) | Cross-realm communication such as iframes and Workers |
