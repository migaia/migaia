# `@migaia/capability`

[中文](./README.md)

Make feature flags govern the feature itself: when a flag turns off, the connections, timers and subscriptions the feature started are released, and features that depend on each other start, roll back and shut down in dependency order.

## You may have run into this

- **The config center turned a feature off, but its connection and timers keep running.** The flag was checked once, before startup, and nothing is responsible for closing what the feature created. [Run the example](./USEGUIDE.en.md#stop-a-running-feature-when-its-flag-is-turned-off)
- **A new config arrives and you diff it against the old one by hand.** Miss one entry and a feature that should be off stays running. [Run the example](./USEGUIDE.en.md#replace-every-flag-with-a-new-config-and-release-features-it-leaves-out)
- **Two parts of a page turn on the same feature and open two connections.** The first start had not finished, so the second caller could not see it and started again. [Run the example](./USEGUIDE.en.md#share-one-activation-while-two-callers-wait)
- **An admin turned a feature off, and a slow load switched it back on.** When the asynchronous start returned, nothing checked whether the flag had changed. [Run the example](./USEGUIDE.en.md#release-a-late-handle-after-permission-is-withdrawn)
- **Features depend on each other, but start and stop order is written by hand.** A screen starts before the service it needs, or one step fails and the services started before it stay running. [Run the example](./USEGUIDE.en.md#roll-back-a-provider-when-its-consumer-fails-to-start)

## Why choose it

The usual approach fetches a set of booleans from a config center or feature flag service and writes `if (flags.chat) startChat()` in code. The flag service tells you a value; it does not deal with the connections, timers and subscriptions a feature has already started once that value changes. This package turns each feature into a lifecycle owned by a host: the flag decides whether it may run, and the host starts it, stops it and cleans up after it.

- **Turning a flag off actually stops the feature.** In the usual approach a flag going false only affects later checks, and a running feature keeps working. Here `setFlag(name, false)` takes the feature down immediately and calls its `dispose`, so the connection closes and the timer stops. [Run the example](./USEGUIDE.en.md#stop-a-running-feature-when-its-flag-is-turned-off)
- **One new config replaces them all, and features left out are released.** No diffing old and new configs yourself. `setFlags` atomically replaces every flag, treats any feature missing from the new config as off, and releases features in the reverse order they finished starting. [Run the example](./USEGUIDE.en.md#replace-every-flag-with-a-new-config-and-release-features-it-leaves-out)
- **Turning a feature on twice starts it once.** Checking "is there an instance already" misses the time while the first start is still running. Here concurrent `enable` calls share one start and one Promise. [Run the example](./USEGUIDE.en.md#share-one-activation-while-two-callers-wait)
- **A late start cannot bring a disabled feature back.** If the flag is already off when an asynchronous start completes, the host discards the result and releases the resources it just created. [Run the example](./USEGUIDE.en.md#release-a-late-handle-after-permission-is-withdrawn)
- **Dependencies decide the order of start, rollback and shutdown.** Once dependencies between features are registered in a graph, a provider starts first and stops last; if one step fails to start, the parts already started roll back in reverse order. [Start order](./USEGUIDE.en.md#start-providers-first-and-release-consumers-first), [rollback on failure](./USEGUIDE.en.md#roll-back-a-provider-when-its-consumer-fails-to-start)

When you do not need it: if a flag only decides which button the UI shows, and the feature holds no connections, timers or subscriptions that need cleaning up, a plain boolean is enough.

## Start here

Try a denied feature, grant permission, then explicitly activate it:

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

For completions after revocation, see [late-handle cleanup](./USEGUIDE.en.md#release-a-late-handle-after-permission-is-withdrawn); for services that must start by dependency order, see [static Graph](./USEGUIDE.en.md#start-providers-first-and-release-consumers-first).

## Pitfalls when writing it yourself

A handwritten boolean gate can separate permission checks from resource ownership. This example is displayed and type-checked only; it is not executed:

```ts doc-test=check
let allowed = false
const activate = () => {
  console.log('activated: demo')
  return {
    dispose: () => {
      console.log('released: export')
    }
  }
}
const handle = activate() // Pitfall: activation already ran before checking permission.
if (!allowed) console.log('currently denied') // Pitfall: reporting denial does not release the created handle.
allowed = true
console.log(allowed, handle)
```

Host checks permission before calling activate and owns the returned handle for cleanup. Granting permission does not start work; callers use one registration, pending-activation and cleanup contract.

## A three-minute mental model

| Problem                                                  | Tool                                   |
| -------------------------------------------------------- | -------------------------------------- |
| Gate and stop an independent optional feature            | Root Capability Host                   |
| Own fixed service dependencies and startup rollback      | Static graph entry                     |
| Validate configuration, preview order or maintain edges  | graph/topology                         |
| Decide dependency actions from current state             | graph/dependency                       |
| Replace definitions and manage exact binding generations | graph/dynamic with a composition owner |

A “handle” is the activated business object whose dispose performs cleanup. A “generation” distinguishes current async work from invalidated work. A “provider” supplies a service and a “consumer” uses it. A “required” dependency must exist before startup. A “DAG” is a directed dependency graph without cycles. “Topological order” puts providers before consumers. These graphs own service resources rather than reactive computations.

## Typical scenarios

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

## Installation

```bash
pnpm add @migaia/capability
```

Runtime dependencies are @migaia/lifecycle and @migaia/utils, without a Store, DOM or Node-specific backend dependency.

## Essential APIs

| API                                             | When to use it                                                 |
| ----------------------------------------------- | -------------------------------------------------------------- |
| createCapabilityHost                            | Create an independent feature’s permission/lifecycle container |
| host.register                                   | Register activation and cleanup using shared context           |
| host.enable / host.handle                       | Await a structured outcome, then obtain the business handle    |
| host.setFlag / host.setFlags                    | Change one permission or replace the entire snapshot           |
| host.disable / host.dispose                     | Wait for one feature or all resources to finish cleanup        |
| createCapabilityGraph / graph.ready / graph.get | Start explicit service dependencies and read direct providers  |

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
