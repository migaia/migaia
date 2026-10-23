# capability usage guide

[中文](./USEGUIDE.md) · [Back to README](./README.en.md)

Choose a scenario for the problem at hand, then consult the boundaries between Host, Graph and pure planning tools. All six examples use published entries without external services or another execution host.

## Find a scenario

| Scenario                                                                | Tools                     | Details                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Keep permission separate from activation                                | `createCapabilityHost`    | [Complete example](./USEGUIDE.en.md#keep-permission-separate-from-activation)                                |
| Share one activation while two callers wait                             | `createCapabilityHost`    | [Complete example](./USEGUIDE.en.md#share-one-activation-while-two-callers-wait)                             |
| Release a late handle after permission is withdrawn                     | `createCapabilityHost`    | [Complete example](./USEGUIDE.en.md#release-a-late-handle-after-permission-is-withdrawn)                     |
| Stop a running feature when its flag is turned off                      | `createCapabilityHost`    | [Complete example](./USEGUIDE.en.md#stop-a-running-feature-when-its-flag-is-turned-off)                      |
| Replace every flag with a new config and release features it leaves out | `createCapabilityHost`    | [Complete example](./USEGUIDE.en.md#replace-every-flag-with-a-new-config-and-release-features-it-leaves-out) |
| Start providers first and release consumers first                       | `createCapabilityGraph`   | [Complete example](./USEGUIDE.en.md#start-providers-first-and-release-consumers-first)                       |
| Roll back a provider when its consumer fails to start                   | `createCapabilityGraph`   | [Complete example](./USEGUIDE.en.md#roll-back-a-provider-when-its-consumer-fails-to-start)                   |
| Inspect startup order before acquiring resources                        | `buildCapabilityTopology` | [Complete example](./USEGUIDE.en.md#inspect-startup-order-before-acquiring-resources)                        |

## Keep permission separate from activation

A feature is downloaded or starts work even though the current tenant has not enabled it.

A boolean checked only at registration time does not own the later activation or its cleanup. Turning the boolean on can also accidentally start work before the application requests it.

Create one capability host, which owns activation state and disposable handles, and register an activation callback. Missing flags deny activation; call `setFlag(name, true)` to grant permission and then `enable(name)` to start. Finish with `dispose()`.

The context field tenant: demo is shared application data passed unchanged to activate. Omitted options deny all flags and supply no onError callback. Registration names the export capability and supplies activate returning a disposable handle. setFlag true only grants permission; enable starts the work.

```ts doc-test=run
import { createCapabilityHost } from '@migaia/capability'

const host = createCapabilityHost({ tenant: 'demo' })
host.register({
  name: 'export',
  activate: ({ tenant }) => {
    console.log('activated:', tenant)
    return {
      dispose: () => {
        console.log('released: export')
      }
    }
  }
})
console.log('first attempt:', (await host.enable('export')).status)
host.setFlag('export', true)
console.log('after permission:', host.state('export'))
console.log('activation:', (await host.enable('export')).status)
await host.dispose()
```

Output:

```text
first attempt: gated
after permission: off
activated: demo
activation: enabled
released: export
```

Prints `first attempt: gated`, `after permission: off`, `activated: demo`, `activation: enabled`, then `released: export`.

The denied attempt does not call the activation callback, and granting permission alone leaves the capability off. The host cannot undo a static import: place a dynamic import inside `activate` when code loading must also wait for permission.

## Share one activation while two callers wait

Two parts of a page enable the same feature together, creating duplicate connections or workers before either activation finishes.

Checking only whether a handle already exists misses the interval while the first activation is pending. Both callers see no handle and independently start the same work.

Call `enable(name)` on the same host. It publishes the in-flight Promise before invoking the activation callback, so another call while activation is pending joins that Promise and receives the same classified result.

Context is undefined, options.flags.search is true, and onError is omitted. The async activate returns a disposable handle. Registration and both enable calls use search. The shared-Promise guarantee applies to a pending activation on the same Host.

```ts doc-test=run
import { createCapabilityHost } from '@migaia/capability'

let activations = 0
const host = createCapabilityHost(undefined, { flags: { search: true } })
host.register({
  name: 'search',
  activate: async () => {
    activations += 1
    await Promise.resolve()
    return { dispose() {} }
  }
})
const first = host.enable('search')
const second = host.enable('search')
console.log('same Promise:', first === second)
const results = await Promise.all([first, second])
console.log('results:', results.map((result) => result.status).join(','))
console.log('activations:', activations)
await host.dispose()
```

Output:

```text
same Promise: true
results: enabled,enabled
activations: 1
```

Prints `same Promise: true`, `results: enabled,enabled`, then `activations: 1`.

Concurrent callers share one pending activation rather than merely receiving equal statuses. Calls made after the capability is already enabled need not return that same Promise; separate host instances do not share activation state.

## Release a late handle after permission is withdrawn

An administrator turns a feature off while its async activation is pending, but the feature becomes active again when the old request finishes.

A handwritten flag check before the first await only authorizes the beginning of the work. Assigning the returned handle unconditionally lets a stale completion restore a capability whose permission has already been revoked.

Withdraw permission with `setFlag(name, false)`. The host immediately invalidates that activation; if its handle arrives later, the host releases it instead of adopting it. Await `dispose()` when all activation and cleanup work must be drained.

flags.export starts true. activate returns the manually completed Promise in this example; setFlag false revokes permission and finish supplies a disposable handle. The final denial yields gated. Invalidation through disable while permission remains granted would yield cancelled instead.

```ts doc-test=run
import { createCapabilityHost, type ICapabilityHandle } from '@migaia/capability'

let finish!: (handle: ICapabilityHandle) => void
const pending = new Promise<ICapabilityHandle>((resolve) => {
  finish = resolve
})
const host = createCapabilityHost(undefined, { flags: { export: true } })
host.register({ name: 'export', activate: () => pending })
const enabling = host.enable('export')
host.setFlag('export', false)
finish({
  dispose: () => {
    console.log('released late handle')
  }
})
console.log('activation:', (await enabling).status)
console.log('state:', host.state('export'))
console.log('adopted handle:', host.handle('export') !== undefined)
await host.dispose()
```

Output:

```text
released late handle
activation: gated
state: gated
adopted handle: false
```

Prints `released late handle`, `activation: gated`, `state: gated`, then `adopted handle: false`.

With permission still withdrawn, the old result cannot become the active handle. The host does not forcibly interrupt user activation code; it owns the returned handle when that work finishes. Async release can continue after a flag update, so await `disable()` or `dispose()` to drain it.

## Stop a running feature when its flag is turned off

A live chat feature has opened a connection for the current tenant and sends a heartbeat every second. An operator turns it off in the config center.

The usual approach fetches a set of booleans from a config center or feature flag service and writes `if (flags.liveChat) startChat()` in code. The flag service tells you a value; it does not deal with what happens when the value changes. The check runs once, before startup, so after the flag goes off the connection and timer already created keep running, unless every feature listens for flag changes and finds and closes its own resources.

In a host, the handle a feature returns when it starts is owned by the host. `setFlag(name, false)` takes that handle down synchronously and calls its `dispose`, so the feature actually stops; `disable(name)` waits for the release to finish.

The context's tenant is acme and is passed to activate unchanged. options.flags.liveChat starts as true. activate opens the connection and starts a heartbeat timer, and the handle it returns stops the timer and disconnects.

```ts doc-test=run
import { createCapabilityHost } from '@migaia/capability'

const host = createCapabilityHost({ tenant: 'acme' }, { flags: { liveChat: true } })
host.register({
  name: 'liveChat',
  activate: ({ tenant }) => {
    console.log('chat connected:', tenant)
    const heartbeat = setInterval(() => console.log('heartbeat'), 1_000)
    return {
      dispose: () => {
        clearInterval(heartbeat)
        console.log('chat disconnected')
      }
    }
  }
})
console.log('activation:', (await host.enable('liveChat')).status)
host.setFlag('liveChat', false)
console.log('state:', host.state('liveChat'), 'handle:', host.handle('liveChat'))
await host.disable('liveChat')
console.log('release finished')
```

Output:

```text
chat connected: acme
activation: enabled
chat disconnected
state: gated handle: undefined
release finished
```

Prints `chat connected: acme`, `activation: enabled`, `chat disconnected`, `state: gated handle: undefined`, then `release finished`. Turning the flag off already ran the handle's `dispose`, so the timer stops and the process exits normally with no heartbeat left behind.

Turning a flag off only stops the feature; turning it back on does not start it again, so call `enable(name)` once more. When `dispose` is asynchronous the release continues in the background; wait for `disable(name)` or `dispose()` when you need to know the resources are gone.

## Replace every flag with a new config and release features it leaves out

After startup the app has enabled search, chat and export. The config center pushes a new config: search stays on, chat is turned off, and export is not in the new config at all.

The usual approach compares the new config with the old one entry by entry, works out which features were turned off or removed, and calls each one's stop function. Miss one and it keeps running. Features are usually stopped in the order the code lists them, so a feature that started later, and may depend on earlier ones, can be left running or closed after the features it relies on.

`setFlags(flags)` atomically replaces every flag with one new config. Any name missing from the new config counts as off, and the features that are turned off are released in the reverse order they finished starting.

options.flags initially allows all three features, which start in the order search, chat, export. The new config lists only search: true and chat: false; export is left out.

```ts doc-test=run
import { createCapabilityHost } from '@migaia/capability'

const host = createCapabilityHost(undefined, {
  flags: { search: true, export: true, chat: true }
})
for (const name of ['search', 'export', 'chat']) {
  host.register({
    name,
    activate: () => {
      console.log('start', name)
      return { dispose: () => console.log('stop', name) }
    }
  })
}
await host.enable('search')
await host.enable('chat')
await host.enable('export')
host.setFlags({ search: true, chat: false })
console.log(host.names.map((name) => `${name}=${host.state(name)}`).join(' '))
await host.dispose()
```

Output:

```text
start search
start chat
start export
stop export
stop chat
search=on export=gated chat=gated
stop search
```

Prints the three starts, then `stop export`, `stop chat`, `search=on export=gated chat=gated`, and finally `stop search` from `dispose()`. Export, absent from the new config, is released just like chat, which was turned off explicitly, and the release order is the reverse of the order in which they finished starting.

A new config replaces the old one; it is not merged, so every feature you want to keep must be in it. Replacing only turns features off and releases them; a newly allowed feature still starts only when you call `enable(name)`. Give each tenant its own host with its own flag snapshot.

## Start providers first and release consumers first

A screen starts before its configuration service is ready, or cleanup closes the configuration while the screen still uses it.

Running startup callbacks in registration order makes correctness depend on which module registers first. Reversing whichever async callbacks happened to finish first does not reliably reverse dependency order.

Register a static capability graph with explicit required provider edges, then await `ready()`. Each start callback can read its declared ready providers through `context.get()`. The graph owns the returned instances and releases them in reverse topology when disposed.

Both nodes supply id, kind, dependencies and start. Although the screen registers first, its required: true edge explicitly names config; config has no dependencies. Start returns value/release, and the screen reads theme from its direct provider through context.get. Omitted options supply no onError callback.

```ts doc-test=run
import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'

const config = 'config' as IGraphNodeId
const screen = 'screen' as IGraphNodeId
const graph = createCapabilityGraph()
graph.register({
  id: screen,
  kind: 'view',
  dependencies: [{ provider: config, required: true }],
  start: (context) => {
    console.log('start screen:', context.get<{ theme: string }>(config).theme)
    return {
      value: 'screen',
      release: () => {
        console.log('release screen')
      }
    }
  }
})
graph.register({
  id: config,
  kind: 'service',
  dependencies: [],
  start: () => {
    console.log('start config')
    return {
      value: { theme: 'dark' },
      release: () => {
        console.log('release config')
      }
    }
  }
})
await graph.ready()
console.log('state:', graph.state)
await graph.dispose()
```

Output:

```text
start config
start screen: dark
state: ready
release screen
release config
```

Prints `start config`, `start screen: dark`, `state: ready`, `release screen`, then `release config`.

Although the consumer was registered first, its provider starts first and is released last. This is a resource dependency graph, not a reactive data graph. Registration freezes at the first `ready()`; use the dynamic graph entry when definitions must change after startup.

## Roll back a provider when its consumer fails to start

A service starts successfully but its dependent screen fails, leaving the service running even though the feature never became ready.

A handwritten sequence that simply awaits each start stops at the thrown error. Previously created resources remain live unless every failure path manually releases them without losing the primary error.

Await `ready()` on the graph and catch its failure. The graph settles the active startup level, rolls back resources it already owns and retains the original startup failure for diagnostics.

The consumer’s required: true edge still targets config. Its start throws the pre-created primary error to demonstrate startup failure. Graph owns the provider’s returned value/release and rolls it back before ready rejects. No second resource owner is introduced for the failure path.

```ts doc-test=run
import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'

const provider = 'config' as IGraphNodeId
const consumer = 'screen' as IGraphNodeId
const primary = new Error('screen startup failed')
const graph = createCapabilityGraph()
graph.register({
  id: provider,
  kind: 'service',
  dependencies: [],
  start: () => ({
    value: { theme: 'dark' },
    release: () => {
      console.log('rolled back config')
    }
  })
})
graph.register({
  id: consumer,
  kind: 'view',
  dependencies: [{ provider, required: true }],
  start: () => {
    throw primary
  }
})
try {
  await graph.ready()
} catch (error) {
  console.log('original failure:', error === primary)
  console.log('code:', (error as Error & { code: string }).code)
}
console.log('provider:', graph.nodeState(provider).state)
console.log('graph:', graph.state)
await graph.dispose()
```

Output:

```text
rolled back config
original failure: true
code: GRAPH_START_FAILED
provider: rolled-back
graph: failed
```

Prints `rolled back config`, `original failure: true`, `code: GRAPH_START_FAILED`, `provider: rolled-back`, then `graph: failed`.

The provider is released before readiness rejects. This ordinary extensible Error retains its identity when tagged; foreign-source or non-extensible errors may instead be wrapped with the original on the cause chain. A failed static graph does not retry implicitly.

## Inspect startup order before acquiring resources

A configuration editor needs to preview provider order and dependency depth before it starts any service.

Sorting only by registration order can place a consumer first. Reusing a running graph just to inspect its order would also mix validation and planning with resource startup.

Pass node IDs, dependency edges and dense registration ordinals to `buildCapabilityTopology()`, together with the three caller-owned failure callbacks. It returns a frozen topology snapshot: the planned order and levels, without invoking resource startup or release.

Each node ID is nonempty and ordinals uniquely cover 0, 1 and 2. The screen edge names config with required true; other dependency arrays are empty. Three required callbacks receive a missing provider, a cycle path or structural failure respectively. This valid-input example shares one reject callback that throws a pre-created error; it is never called on the successful path.

```ts doc-test=run
import { buildCapabilityTopology } from '@migaia/capability/graph/topology'

const nodes = [
  { id: 'screen', ordinal: 0, dependencies: [{ provider: 'config', required: true }] },
  { id: 'config', ordinal: 1, dependencies: [] },
  { id: 'health', ordinal: 2, dependencies: [] }
]
const invalid = new Error('invalid topology configuration')
const reject = (): never => {
  throw invalid
}
const topology = buildCapabilityTopology(nodes, reject, reject, reject)
console.log('input:', nodes.map((node) => node.id).join(','))
console.log('order:', topology.ordered.map((node) => node.id).join(','))
console.log(
  'levels:',
  topology.level.get('config'),
  topology.level.get('health'),
  topology.level.get('screen')
)
console.log('frozen:', Object.isFrozen(topology.ordered))
```

Output:

```text
input: screen,config,health
order: config,health,screen
levels: 0 0 1
frozen: true
```

Prints `input: screen,config,health`, `order: config,health,screen`, `levels: 0 0 1`, then `frozen: true`.

The plan puts providers before consumers and uses registration ordinals within a level without changing the input array. Ordinals must uniquely cover 0 through nodeCount minus one. This API plans only; use `createCapabilityGraph()` to own resource startup and release.

## Contract details

### Entry points, dependencies and ownership

The root entry @migaia/capability provides Capability Host, state constants, error identities and readiness snapshots. Four separate subpaths serve different purposes: @migaia/capability/graph owns static lifecycle graphs; @migaia/capability/graph/topology owns pure topology and incremental indexes; @migaia/capability/graph/dependency produces pure dependency plans; @migaia/capability/graph/dynamic coordinates runtime changes and binding custody. Import from these published entries rather than internal files.

The package uses @migaia/lifecycle for generations, ownership, draining and mutation queues, and @migaia/utils for errors and thenables. It has no reverse dependency on Store, UI, DOM, Node or platform adapters. The default static Graph requires native AbortController/AbortSignal support from its host; ESM support alone is insufficient.

“Host” here always means the in-process container created by createCapabilityHost. It holds definitions, shared context, flags and activation state, without reading provider-to-consumer edges. PluginHost owns plugin installation, pipelines and rollback. Storage Host groups storage backends. Worker, thread and process supervision owns isolation and physical termination. Those are separate responsibilities.

A capability graph expresses startup dependencies between services and resources. It is not a graph of reactive data computations. The static entry supports required providers only; optional availability notifications and cross-realm adapters are outside that entry. Runtime topology changes use the dynamic entry. This package publishes no cross-realm adapter, and a Promise timeout cannot terminate a synchronous loop in the same realm.

### Creating a Host and capturing inputs

createCapabilityHost(context, options?) returns `ICapabilityHost<Context>`, with Context inferred from the argument. Every activate receives the same context reference. The Host does not freeze, inspect or modify it; include only the application objects capabilities actually need.

options defaults to an empty object and must be an object or function. Null and primitive values produce a TypeError carrying INVALID_OPTION. Creation captures options.flags and options.onError; later changes to the original options do not change the Host. Omitted flags deny every capability. Omitted onError supplies no user diagnostic callback; a supplied value must be callable. Failed option reads preserve their original cause under INVALID_OPTION. Method-style onError keeps the original options receiver.

Flags permit only own, enumerable data properties whose value is exactly true. Inherited properties grant nothing; getters are not evaluated. Names such as `__proto__` and constructor are ordinary internal Map keys. Editing the original flags has no effect: use setFlag or setFlags. Descriptor-read failures retain their exact cause.

### Host types and complete operations

ICapabilityHandle requires only dispose(): void or `PromiseLike<void>`. Each capability adds its own business methods; the Host does not wrap that object. `ICapabilityDefinition<Context, Handle>` requires name and activate(context), with Handle defaulting to ICapabilityHandle. A name must be a string that is nonblank after trimming. Duplicate names, invalid names and non-callable activate values produce ALREADY_REGISTERED, INVALID_NAME and INVALID_ACTIVATE respectively.

Registration captures and freezes name/activate. Mutating the original definition cannot rewrite the admitted identity; method-style activate can read this.name from its frozen receiver. On adoption the Host also captures handle.dispose, so later property changes cannot replace cleanup ownership. A missing/non-callable disposer or a failing disposer getter produces an INVALID_HANDLE TypeError and a failed activation.

| Member                 | Behavior and boundaries                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| register(definition)   | Registers synchronously without activating; rejects terminal or reentrant mutations.                                                                                                |
| names                  | Returns a fresh array of registered names on each read.                                                                                                                             |
| state(name)            | Returns lifecycle state; unknown names throw NOT_REGISTERED.                                                                                                                        |
| `handle<Handle>`(name) | Returns the exact business handle returned by activate, or undefined when inactive; unknown names throw NOT_REGISTERED.                                                             |
| error(name)            | Reads the current generation’s latest activation/cleanup failure; successful restart or reconfiguration clears it.                                                                  |
| setFlag(name, enabled) | Only strict true permits activation. False synchronously invalidates pending work, removes the handle and begins cleanup; true does not activate.                                   |
| setFlags(flags)        | Atomically replaces the entire allowlist; omitted names are denied. Unreadable input first denies everything, then throws INVALID_OPTION.                                           |
| enable(name)           | Returns a structured outcome. Concurrent calls share one activation and its pending Promise; an on capability is not activated again, and a denied capability never calls activate. |
| disable(name)          | Waits for this capability’s pending activation and cleanup to drain. Returns true only if it was on; cancelling an activating capability still waits for cleanup but returns false. |
| dispose()              | Closes permanently, releases in reverse actual activation-completion order and drains all pending work.                                                                             |
| disposed               | Becomes true when terminal cleanup begins. Read-only diagnostics remain available; mutations cannot revive this Host.                                                               |

There are no additional hidden options. state/handle/error require registered names. setFlag can configure a name before it is registered. Invalid enable/disable operations return rejected Promises. disable checks HOST_DISPOSED before looking up the name. Admission failures from register/setFlag/setFlags throw synchronously.

CapabilityState and ICapabilityState have five values: off (allowed but inactive), gated (denied), activating (activation in flight), on (valid handle adopted) and failed (activation failed). A cleanup failure is recorded and reported while state remains off/gated; it does not change those states to failed. Host gated and Graph blocked have different meanings.

CapabilityEnableStatus contains enabled, gated, cancelled and failed. Only the failed branch of ICapabilityEnableResult carries error. ICapabilityEnableStatusValue is the union of those status values. Enabled means the result was adopted. Initial denial, or a late result arriving while the flag is still denied, yields gated. Invalidation by disable, dispose or another generation yields cancelled. A current activation failure or invalid handle yields failed, with the same error available through error(name).

### Host races, cleanup and reentrancy

Invalidation advances a lifecycle generation. A late activate result is adopted only if its original generation is still current; otherwise the new handle is immediately released rather than reopening a disabled feature. Old-generation cleanup failures are reported without poisoning a healthy replacement. Applicable current-generation cleanup failures, including cleanup with no replacement, remain available through error(name).

Both bulk setFlags rollback and dispose release in reverse actual activation-completion order, rather than registration or enable-call order. One cleanup failure does not prevent the remaining handles from closing. The Host records and reports cleanup failures without introducing an aggregate rejection policy. disable drains one capability; dispose drains all of them, including cleanup created by late activations during the wait. Activation or cleanup that never settles keeps the relevant drain pending.

The first dispose returns the sole completion Promise. Further calls before it settles fail with HOST_TRANSITIONING. A synchronous disposer reentry throws synchronously; a later reentry returns a rejected Promise. Only after completion do repeated calls return that original canonical Promise. Retain and await the first result instead of calling dispose again to join work in progress.

Mutations cannot reenter the same Host during synchronous disposer/reporter transition windows. register/setFlag/setFlags throw HOST_TRANSITIONING; enable/disable return rejected Promises. onError(name, error) observes activation, cleanup and abnormal-thenable failures. Its own throw/rejection goes to the shared utils host-error queue without changing gate state or replacing the business failure.

The Host has no dependsOn declarations and does not serialize every activation. Explicitly await enable(A) before enable(B), or use static Graph, when B needs A. Place the dynamic import() call inside activate so loading follows permitted activation. The bundler decides code splitting; flags do not remove static imports. Create a separate Host and flag snapshot per tenant. Removed APIs enableResult, enableLegacyBoolean and disableNow are unavailable; compare the structured enable status for a boolean and await disable for physical cleanup.

### Static Graph: registration, startup and reads

createCapabilityGraph(options?) defaults options to an empty object with only optional onError; omission supplies no user diagnostic callback. It reads and validates the callback before creating a lifecycle root scope. Failing getters and non-callable values produce GRAPH_INVALID_OPTION.

IGraphNodeId is a branded string. `IGraphNodeDefinition<T>` requires id, kind, dependencies and start. IDs and kinds are nonempty strings. dependencies is an array of edges requiring provider and required: true. start(context) returns or resolves to { value, release }, where release is callable and undefined is a valid value. Static registration captures fields and frozen edge facts; duplicate nodes and edges are rejected. Register all nodes before the first ready. Later registration produces GRAPH_FROZEN; closed admission produces GRAPH_ADMISSION_CLOSED, and terminal mutation produces GRAPH_DISPOSED.

ready checks missing providers, self-loops and cycles, then starts nodes in level/ordinal layers. Calls within a layer begin in registration order and settle in parallel; the next layer starts only after the entire previous layer succeeds. On failure, the first failure in canonical layer order is primary, with others retained through errors. Successful peers and earlier layers are rolled back. A failed startup does not retry implicitly, but dispose remains available.

IGraphStartContext supplies nodeId, a native signal, get(provider) and own(resource, descriptor). get reads only a declared, ready direct provider and acquires no lease. Context calls stop being valid after startup ends, invalidation or closing. own places auxiliary resources in a provisional scope for rollback on failure, abort, stale completion or disposal. The descriptor must immediately supply a callable force; invalid ownership produces GRAPH_INVALID_OPTION with the lifecycle TypeError reachable through cause. Do not register the primary value a second time as auxiliary ownership.

Graph owns each primary value/release exactly once. Within a node, primary cleanup precedes auxiliary cleanup; across nodes, cleanup follows reverse topology. The primary release(context) receives a structural signal, nodeId and report callback. Cleanup failures follow Graph’s error and diagnostic policy.

| Static Graph member          | Behavior                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| register(node)               | Registers definitions only while open.                                                                                                                                   |
| ready()                      | Starts once and preserves Promise identity across repeated calls; failed startup does not automatically retry.                                                           |
| nodes                        | Frozen registration-ID array, still readable after termination.                                                                                                          |
| nodeState(id)                | Frozen point-in-time diagnostic containing id, kind, state, value and error. Unknown IDs produce GRAPH_UNKNOWN_NODE.                                                     |
| `readValue<T>`(id)           | Reads the same original payload without constructing a diagnostic projection. Visible only when the entire graph is ready; otherwise undefined. Unknown IDs still throw. |
| `get<T>`(consumer, provider) | Checks that consumer declared this direct dependency and provider is ready; it is not an arbitrary node lookup.                                                          |
| state / error                | Overall graph state and retained primary failure.                                                                                                                        |
| dispose()                    | Closes admission, cancels startup and releases in reverse topology; repeated calls share one Promise.                                                                    |

Overall states are open, starting, ready, failed, quiescing and terminal. Node states are registered, starting, ready, suspended, failed, blocked, rolled-back and released; the static entry offers no dynamic suspend method. readValue can return a legitimate undefined payload, so inspect graph.state for availability. Payloads retain their object identity and mutability; old diagnostics remain state snapshots. Custom ICapabilityGraph implementations must include readValue.

Synchronous lifecycle callbacks that reenter the same Graph operation produce GRAPH_REENTRANT_OPERATION. onError observes cleanup and late-result failures without replacing the primary error; callback failures also reach the shared host-error queue. Graph disposal can reject with GRAPH_DISPOSE_FAILED, unlike the Host’s report-and-complete cleanup policy.

### Pure topology and incremental indexes

Static construction reads each node and edge once, then uses iterative DFS and ordinal/level buckets in O(v + e + p), where p is the captured input size. Multiple cycles report the first closed path reached by root ordinal and declared provider order. Incremental edits retain their existing algorithm.

buildCapabilityTopology(nodes, onUnknownProvider, onCycle, onInvalid) computes a plan without calling start or release. All four arguments are required. Nodes contain id, dependencies and ordinal. Ordinals must be unique safe integers covering [0, nodeCount) without gaps. Invalid input is not silently sorted or rewritten. Edges require a nonempty provider and boolean required. Missing required providers go to onUnknownProvider(nodeId, provider); present optional edges also affect levels and cycle checks.

The deeply frozen ICapabilityTopology contains ordered plus read-only providers, consumers, indegree, level and ordinal maps. Scheduling is by (level, ordinal): dependency depth first, registration order within a level. providers maps providers to consumers, while consumers maps consumers to their dependencies. indegree captures admission-time dependency counts. ReadonlyMap/ReadonlySet facades expose no mutation, and forEach(callback, thisArg?) follows the standard receiver semantics.

onCycle(path) and onInvalid(reason, nodeId?, failure?) let callers choose their error shell. A getter failure supplies the exact cause, even when it is undefined. Pure topology retains that cause in the adapter-thrown error’s cause/errors chain, preserving native identity where it can be annotated. TopologyInvalidReason values are invalid-node, duplicate-node, duplicate-edge, duplicate-ordinal, unknown-node, transaction-open and transaction-closed.

createTopologyIndex(adapter) requires onCycle and onInvalid without creating services. Incremental node inputs contain only id/dependencies. The index owns a monotonic registrationOrdinal that removals never renumber; setDependencies retains it. snapshot().ordinal instead compresses current nodes into a dense static projection. Required and currently present optional edges affect levels/cycles; absent optional providers are recorded without blocking nodes.

| Index operation                                     | Meaning                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| size / has(id)                                      | Current node count and membership.                                                                       |
| registrationOrdinal(id)                             | Reads the original monotonic registration position; unknown nodes use onInvalid.                         |
| add(node) / remove(id) / setDependencies(id, edges) | Atomically update nodes/edges, retaining dangling incoming provider facts.                               |
| dependencies(id) / dependents(id)                   | Frozen direct edges, or direct consumers split into required/optional arrays.                            |
| missing(id)                                         | Edges whose providers are currently absent.                                                              |
| closure(roots)                                      | Roots and their transitive required consumers in canonical order.                                        |
| order(ids?)                                         | Canonical order for all nodes or a supplied deduplicated subset; omission selects all, unknown IDs fail. |
| snapshot()                                          | Deeply frozen static topology projection.                                                                |
| begin()                                             | Isolated transaction with the same reader/writer operations and commit/rollback.                         |

Base readers retain the original snapshot until commit; base writes and nested begin calls are rejected. Commit publishes the working view, while rollback discards it and preserves observable facts. Settled transactions reject reads as well as writes. Static topology and indexes share one private structural/edge admission owner; static construction does not replay incremental edits.

### Pure dependency plans

The dependency entry neither starts nor releases nodes and never mutates the index. IDependencyStateReader returns four independent booleans: activated, enabled, suspended and stale. They describe whether a node has activated, is permitted, is suspended and retains an outdated binding; there is no combined state string. Plans are deeply frozen and contain steps (id/action), order, edges (provider/consumer/optional/status?) and blockedBy.

DependencyPolicy contains reject, cascade and suspend. DependencyMutationKind contains remove and disable. DependencyAction contains release, disable, suspend, resume, rebind, restart, activate and invalidate. DependencyEdgeStatus.optionalAbsent is optional-absent, identifying an absent optional provider.

| Planner                                       | Inputs and result                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| planDependencyMutation(index, state, request) | Requires roots, kind and policy. Reject reports blockers; cascade produces consumer-first steps; suspend pauses only activated, not-yet-suspended consumers. Root actions are release for remove and disable for disable. |
| planRestart(index, state, roots)              | Consumer-first restart closure, skipping inactive nodes and invalidating suspended nodes.                                                                                                                                 |
| planReplacement(index, state, request)        | Requires target and canRebind. Plans direct rebinds, invalidates suspended consumers and restarts the remaining closures.                                                                                                 |
| planResume(index, state, request)             | Requires provider, generationChanged and canRebind. Traverses only the suspended frontier; stale nodes restart and nodes missing required providers remain blocked.                                                       |
| planActivation(index, state, roots)           | Plans only inactive required upstream providers; the requested roots themselves are absent from activate steps.                                                                                                           |
| resolveInstallSet(index, members, isLazy)     | Selects non-lazy batch members and their required providers, returning a canonically ordered read-only Set.                                                                                                               |
| planTeardown(index)                           | Plans every node in reverse canonical release order.                                                                                                                                                                      |
| collectPlanEdges(index, affected)             | Projects internal required edges and relevant optional relationships for the affected set.                                                                                                                                |

Invalidate marks a retained suspended instance’s provider binding as stale. The caller keeps it suspended and sets stale; planResume later selects restart. canRebind is a caller-owned capability decision, not an executed rebind. Execution, reporting, generations, leases and physical cleanup remain with the composition owner. Invalid mutation kinds/policies produce GRAPH_INVALID_OPTION.

### Dynamic Graph and exact-generation custody

createDynamicCapabilityGraph(options) requires both startBatch(entries) and releaseBatch(entries, fence); either missing callback produces GRAPH_INVALID_OPTION. There is no default node-level execution host. A composition owner decides how to invoke definition.start, establish values and release instances. Startup entries contain id, binding and the frozen definition. Release entries contain id, binding and instance for the exact outgoing instance, supplied in canonical provider-first order. The owner awaits the fence and performs physical releases in reverse order.

Optional report supplies no user callback by default. mutationAdmissionMs defaults to undefined, effectively disabling the queue budget; a provided budget must be finite and nonnegative. releaseBinding is not called when omitted. Ordinary mutations share a FIFO, and a rejected predecessor does not stop later work. A mutation that has not begun before its queue budget expires rejects with GRAPH_MUTATION_ADMISSION_TIMEOUT, retaining the lifecycle error. Final dispose waits behind admitted work in the same FIFO with its own admission timeout disabled, without forcibly interrupting predecessors.

register(node, binding?) and replace(node, binding?, options?) read id/kind/start/dependencies once when execution begins after queuing. They admit immutable definition/edge snapshots. Editing the caller’s object cannot change identity, diagnostics or edges; use replace explicitly. The captured start keeps its original definition receiver and return value. Getter failures produce GRAPH_INVALID_NODE while retaining the native error or cause. An omitted binding remains undefined and cannot be acquired.

| Dynamic operation                 | Behavior and defaults                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| register(node, binding?)          | Accepts required/optional edges and attempts startup of the affected frontier; absent optional providers do not block.                                                                                |
| remove(id, options?)              | Policy defaults to cascade. Removes the target definition, releases affected instances and leaves retained consumers blocked with removed. Reject atomically refuses targets with required consumers. |
| suspend(id, options?)             | Accepts only reject/cascade, defaulting to cascade. Retains instances without release and blocks dependent consumers.                                                                                 |
| resume(id)                        | Requires a suspended target or produces GRAPH_NODE_NOT_SUSPENDED. Recovers the frontier whose required providers are all available; existing instances are not started again.                         |
| replace(node, binding?, options?) | Restarts dependents by default. With restartDependents false, onReplaced notifies direct required consumers; missing or failing callbacks restart the relevant closures after reporting failure.      |
| dependentsOf(id)                  | Direct required/optional consumers; unknown IDs throw GRAPH_UNKNOWN_NODE.                                                                                                                             |
| ready()                           | Attempts the registered/blocked/failed frontier and marks the graph ready without freezing topology; blocked nodes can remain, and repeated calls do not promise the same Promise.                    |
| nodeState(id)                     | Returns a fresh, unfrozen diagnostic: id/kind/state/value/error/reason/binding/generation/ordinal/rank/level.                                                                                         |
| getBinding(id)                    | Non-owning read without availability checks; unknown IDs or absent bindings return undefined, granting no asynchronous use right.                                                                     |
| acquireBinding(id)                | Requires a ready node with a binding. Returns frozen { value, release }; release is idempotent.                                                                                                       |
| nodes / state / generation        | Registered IDs, overall state and mutation generation.                                                                                                                                                |
| dispose()                         | Closes admission, completes canonical cleanup and clears definitions; repeated calls share one Promise.                                                                                               |

Dynamic remove/suspend do not accept the pure planner’s suspend policy. Default cascade does not delete every consumer definition: it closes or blocks affected instances. Optional edges do not trigger required cascades, but dependentsOf still reports their direct relationships. Ordering always uses level/ordinal rather than the older minimum-ordinal ordering across different levels.

Mutation results contain only affected, topologyChanged and generation; public test counters and timing fields are gone. Same-edge replacement preserves ordinal/rank/level semantics, while edge changes rebuild diagnostics. Import GraphBlockedReason (missing/suspended/removed/failed) from graph, GraphBindingReleaseReason (remove/replace/dispose) from dynamic, and readiness values ready/blocked/failed from root GraphReadinessState.

Async users acquireBinding and release their lease in finally. Remove/replace/dispose first seal the old generation and pass one non-rejecting fence to releaseBatch. The fence resolves only when every exact old-generation lease reaches zero. The composition owner must not begin physical disposal before that fence. New generations use different lease keys, so a late old release cannot unlock a new binding. releaseBinding returns binding custody after its instance cleanup, with the remove/replace/dispose reason.

A single-node startBatch failure marks that node failed. A larger failed batch cannot identify one culprit, so all members become blocked with reason failed. nodeState.error retains the original error; GRAPH_START_FAILED detail.nodes lists the batch. If startBatch throws after partially starting resources, Graph has not received those partial instances, so the composition owner must roll them back. Static Graph’s layer-rollback guarantee does not apply here. report is a final observer: its own throws/rejections go to the shared host-error queue without changing the mutation result.

### Readiness snapshots

snapshotGraphReadiness(source) is a low-level admission tool for external readiness sources. It reads state before error, once each, accepts only GraphReadinessState.ready/blocked/failed and returns frozen { state, error }. Ordinary consumers can read Graph’s own state. These availability values are separate from the Host’s five lifecycle states.

Annotatable native getter Errors retain identity, type and stack while receiving INVALID_OPTION. Primitive throws, immutable errors and conflicting identities use a coded fallback whose cause retains the original value, including undefined. An invalid state fails before reading error.

### Error identity and handling

Host-owned errors use CAPABILITY_SOURCE, capability. Graph-owned errors use CAPABILITY_GRAPH_SOURCE, capability.graph. Branch on (source, code). Identity fields are attached without rewriting stack. Annotatable native errors preserve their type and object identity; wrappers retain originals through cause/errors. Private error factories are not public entry points.

| Host code          | Trigger                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| HOST_DISPOSED      | A terminal Host receives a mutation.                                                       |
| HOST_TRANSITIONING | Synchronous lifecycle reentry, or another dispose before the first completes.              |
| NOT_REGISTERED     | A lookup/operation targets an unregistered name.                                           |
| ALREADY_REGISTERED | Registration repeats a name.                                                               |
| INVALID_NAME       | A name is not a nonblank string; TypeError.                                                |
| INVALID_ACTIVATE   | activate is not callable; TypeError.                                                       |
| INVALID_HANDLE     | Activation provides no callable disposer; TypeError.                                       |
| GATED              | Reserved diagnostic code; current enable returns gated rather than throwing this code.     |
| INVALID_OPTION     | options/flags/definition/readiness admission or reads fail, preserving the original cause. |

CapabilityErrorCode and ICapabilityErrorCode are the constant table and its value union. Codes are public API without duplicate aliases.

| CapabilityGraphErrorCode member | Code and scenario                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| graphDisposed                   | GRAPH_DISPOSED: terminal mutations or disallowed reads.                                      |
| graphFrozen                     | GRAPH_FROZEN: static registration after ready.                                               |
| invalidNode                     | GRAPH_INVALID_NODE: malformed definitions, edges or start results.                           |
| duplicateNode                   | GRAPH_DUPLICATE_NODE: duplicate ID.                                                          |
| unknownProvider                 | GRAPH_UNKNOWN_PROVIDER: absent static required provider.                                     |
| duplicateEdge                   | GRAPH_DUPLICATE_EDGE: repeated provider edge.                                                |
| dependencyCycle                 | GRAPH_DEPENDENCY_CYCLE: cyclic topology.                                                     |
| providerUnavailable             | GRAPH_PROVIDER_UNAVAILABLE: undeclared/unready direct provider or unavailable binding lease. |
| startFailed                     | GRAPH_START_FAILED: startup failure, rollback or failed batch.                               |
| disposeFailed                   | GRAPH_DISPOSE_FAILED: Graph resource cleanup fails.                                          |
| admissionClosed                 | GRAPH_ADMISSION_CLOSED: closing admission or calls through an expired startup context.       |
| unknownNode                     | GRAPH_UNKNOWN_NODE: absent diagnostic/query ID.                                              |
| reentrantOperation              | GRAPH_REENTRANT_OPERATION: synchronous lifecycle reentry.                                    |
| invalidOption                   | GRAPH_INVALID_OPTION: invalid options or own descriptor.                                     |
| nodeHasDependents               | GRAPH_NODE_HAS_DEPENDENTS: reject policy finds required consumers.                           |
| mutationAdmissionTimeout        | GRAPH_MUTATION_ADMISSION_TIMEOUT: an unstarted ordinary mutation exceeds its queue budget.   |
| nodeNotSuspended                | GRAPH_NODE_NOT_SUSPENDED: resume targets a node that is not suspended.                       |

### Composition and troubleshooting

To compose persistence or another optional feature, create context containing the required application objects; register a capability that awaits import inside activate; await enable and read the business handle only after enabled; await disable on page exit; and await the first dispose on application shutdown. Reporting observes rather than controlling lifecycle. Give each tenant its own container and flags.

When enable yields gated, check whether only the original flags were edited, whether values are strict true and whether setFlag was missed. setFlags({}) revokes everything; use setFlag for one change. If a disabled feature returns, check for direct activate calls outside the Host or reentry from cleanup. Use Graph for service dependency order rather than asking Host to infer it.

Available package scripts are fmt, lint, typecheck, typecheck:test and test, with build for compilation. The existing bench:resume measures planner behavior, but this guide makes no unverified performance claim from it.
