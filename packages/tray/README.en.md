# `@migaia/tray`

Start and release resources by dependency while giving plugin installation, loaded artifacts and active callbacks one observable lifecycle.

## You may have run into this

- A service starts before its configuration, then loses that configuration during shutdown because ordering exists only in arrays and scattered finally blocks.
- A temporarily unavailable provider never recovers because code keeps reading an old snapshot without distinguishing blocked from final failure.
- A plugin arrives before its provider and exposes half-ready behavior because registration and installation were combined.
- Conversion leaks a resource or successful installation frees it too soon because loading, conversion and installation own separate cleanup paths.
- Cancellation is reported as completion while the callback still uses resources because stopping the wait was mistaken for stopping code.

## Why choose it

- **Let dependencies determine both startup and release.** Static composition uses Capability Graph, and [Start dependencies before consumers and release them last](./USEGUIDE.en.md#start-dependencies-before-consumers-and-release-them-last) registers resources in reverse order while still starting configuration first and releasing the service first.
- **Recover explicitly from temporary blocks while keeping final failure stable.** Readiness getters are resampled only after blocked, and [Retry a blocked readiness gate without retrying a failed gate](./USEGUIDE.en.md#retry-a-blocked-readiness-gate-without-retrying-a-failed-gate) checks both no premature startup and cached failed-Promise identity.
- **Keep plugin definitions while they wait for missing providers.** Managed Host uses Feature references to retain blocked definitions, and [Keep a dependent plugin blocked until its provider is installed](./USEGUIDE.en.md#keep-a-dependent-plugin-blocked-until-its-provider-is-installed) starts the consumer when its provider arrives and blocks it when that provider leaves.
- **Transfer loaded-resource cleanup according to commitment.** loadIntoHost provisionally owns the artifact until committed, and [Transfer loaded artifact cleanup only when admission commits](./USEGUIDE.en.md#transfer-loaded-artifact-cleanup-only-when-admission-commits) checks delayed release after success and rollback after conversion failure.
- **Keep resources leased until cancelled callbacks actually settle.** Runtime retains the current installation's usage lease, and [Keep a cancelled callback alive until it really settles](./USEGUIDE.en.md#keep-a-cancelled-callback-alive-until-it-really-settles) observes one active run after cancellation and zero only after callback settlement.

## Start here

Install the package and run this in an ESM TypeScript file with Node 24. It composes one same-realm static value and prints 42:

```bash
pnpm add @migaia/tray
```

```ts doc-test=run
import { createTrayGraph, type ITrayKey } from '@migaia/tray'
const key = 'answer' as ITrayKey
const tray = createTrayGraph([
  { key, kind: 'value', start: () => ({ value: 42, release: () => undefined }) }
])
try {
  await tray.ready()
  console.log(tray.get<number>(key))
} finally {
  await tray.dispose()
}
```

Output:

```text
42
```

For dependency ordering see [Start dependencies before consumers and release them last](./USEGUIDE.en.md#start-dependencies-before-consumers-and-release-them-last), for missing plugin providers see [Keep a dependent plugin blocked until its provider is installed](./USEGUIDE.en.md#keep-a-dependent-plugin-blocked-until-its-provider-is-installed), and for self-removal after a callback see [Remove the current plugin after its callback releases the lease](./USEGUIDE.en.md#remove-the-current-plugin-after-its-callback-releases-the-lease).

## Pitfalls when writing it yourself

This resource-registration sketch uses ordinary functions for display and type checking only; do not run it:

```ts doc-test=check
const releases: Array<() => void> = []
const register = (start: () => number, release: () => void) => {
  const value = start() // Pitfall: registration starts immediately; dependencies rely on call order.
  releases.push(release)
  return value
}
const stop = () => {
  for (const release of releases) release() // Pitfall: forward release can close a provider first.
  // Pitfall: one thrown release skips later resources without a shared cleanup result.
}
void register
void stop
```

The previous example awaits ready before reading and disposes through the Graph's resource owner. Declared requires then determines startup and release instead of call position.

## A three-minute mental model

| Problem                                                   | Tool                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| A known set of configuration, services and resources      | createTrayGraph with complete dependencies, then ready/get/dispose. |
| Plugin arrival, provider recovery, replacement or removal | createHost from /host manages definitions and ready plugins.        |
| Convert an external artifact into an owned plugin         | loadIntoHost from /loader with defineLoader/defineAdapter.          |
| Run callbacks with cooperative cancellation               | createRuntime from /runtime leases the current installation.        |
| Independent instances, routing and business topics        | Root defineTrayHost/createTray/serveTrayHost.                       |

A definition is a registered plugin description; ready means its capabilities are available. A generation is one installation of that plugin or instance. A lease keeps that installation usable until a run finishes. An artifact is the loaded resource value, committed transfers it to a definition, and cleanupComplete says whether physical release has finished. These states are distinct.

## Typical scenarios

| Scenario                                              | How to combine                                              | Details                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration-dependent service with ordered shutdown | createTrayGraph → ready → get → dispose                     | [Start dependencies before consumers and release them last](./USEGUIDE.en.md#start-dependencies-before-consumers-and-release-them-last)             |
| Temporarily unavailable external provider             | readiness getter → blocked → explicit ready                 | [Retry a blocked readiness gate without retrying a failed gate](./USEGUIDE.en.md#retry-a-blocked-readiness-gate-without-retrying-a-failed-gate)     |
| Plugin arrival differs from dependency order          | createHost → use(provider) → unUse(provider)                | [Keep a dependent plugin blocked until its provider is installed](./USEGUIDE.en.md#keep-a-dependent-plugin-blocked-until-its-provider-is-installed) |
| Commit or roll back a loaded artifact                 | defineLoader → defineAdapter → loadIntoHost → unUse         | [Transfer loaded artifact cleanup only when admission commits](./USEGUIDE.en.md#transfer-loaded-artifact-cleanup-only-when-admission-commits)       |
| Preserve resources during cancellation                | createRuntime → run(signal) → callback settlement → dispose | [Keep a cancelled callback alive until it really settles](./USEGUIDE.en.md#keep-a-cancelled-callback-alive-until-it-really-settles)                 |
| Remove the executing plugin after its callback        | run → self.unUse ticket → callback settlement → completion  | [Remove the current plugin after its callback releases the lease](./USEGUIDE.en.md#remove-the-current-plugin-after-its-callback-releases-the-lease) |

## Installation

```bash
pnpm add @migaia/tray
```

Managed-plugin examples directly import plugin-host, which should also be installed directly:

```bash
pnpm add @migaia/plugin-host
```

Import static Graph and the instance registry from the root. Managed Host, Loader, Adapter and Runtime use exact subentries. These six runnable scenarios compose resources in one realm; native Worker/process wiring belongs to the Hosts layer through the original RPC factories.

## Essential APIs

| API                         | Purpose                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| createTrayGraph             | Start static dependencies, read values and release in reverse order.               |
| createHost                  | Manage PluginHost definitions, dependencies, generations and cleanup results.      |
| loadIntoHost                | Load, convert, install/replace and transfer artifact cleanup.                      |
| createRuntime               | Borrow plugin capabilities for callbacks with cooperative cancellation and leases. |
| defineTrayHost / createTray | Define and manage independent Host instances.                                      |
| serveTrayHost               | Serve the parent registry from a native child entry.                               |

## Contract details

### Responsibilities and five entries

Tray composes existing capabilities and lifecycle owners rather than adding another protocol. A static Graph manages a complete, known collection of resources in one realm. A managed Host composes PluginHost definitions, while the root Hosts registry manages independent instances. Capability owns dependency graphs, plugin-host owns plugin installation, and RPC/supervision own connections and native execution. Capability dependencies are distinct from reactive data dependencies.

| Entry                  | Purpose                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@migaia/tray`         | createTrayGraph; defineTrayHost, createTray, serveTrayHost; routing policies, instance states and public errors. |
| `@migaia/tray/host`    | createHost and public managed-Host types.                                                                        |
| `@migaia/tray/loader`  | defineLoader, loadIntoHost and loading contracts.                                                                |
| `@migaia/tray/adapter` | defineAdapter and conversion contracts.                                                                          |
| `@migaia/tray/runtime` | createRuntime and callback execution, cooperative cancellation and self-mutation tickets.                        |

Loader, Adapter and Runtime are not aggregated by the root. Directly imported dependencies such as plugin-host or lifecycle should be installed directly. Runtime dependencies are capability, event-subscriber, lifecycle, plugin-host, rpc-contract, rpc-core, rpc-process, rpc-threads, supervision and utils. Cross-machine discovery, browser Worker integration, UI, durable messages and automatic failover retry are outside these composition guarantees.

### Static Graph definitions and startup

`createTrayGraph(entries)` requires one complete readonly array. Construction validates synchronously without starting entries. ITrayKey is a branded string, requiring non-whitespace content at runtime; declare and reuse application keys centrally rather than expecting the library to infer or generate them.

| Entry field | Requirement                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| key         | Required and unique in the array; duplicate keys reject with TRAY_DUPLICATE_ENTRY.                                                                   |
| kind        | Required: value / computed / resource / service; a category label, without changing value's static type or automatically creating reactive behavior. |
| requires    | Defaults to an empty array; refers only to other keys in this collection, excluding self and unknown keys.                                           |
| readiness   | undefined; an external snapshot whose state is ready / blocked / failed.                                                                             |
| start       | Required function, called after dependencies are ready; returns or resolves to complete `{ value, release }`.                                        |

Admission reads key, kind, requires, readiness and start and validates dependencies before the first start. Invalid structure or read failure rejects with TRAY_INVALID_ENTRY. Normalized keys/requires arrays are frozen, so later mutation of the original arrays cannot change topology. Admission captures the readiness property value and the initial gate uses that object; this does not deep-clone arbitrary application values or snapshot objects.

context.signal aborts when the Graph closes. context.get(key) reads declared, ready direct dependencies, and context.own(resource, descriptor) transfers auxiliary-resource ownership to the current node with the complete lifecycle release descriptor. The primary value's release(context) receives Graph release context and may be synchronous or thenable. An entry must roll back resources acquired before handing over a complete result if construction fails.

The first ready() checks state/error on admitted snapshots in entry order. Only omitted or ready facts allow Graph startup. Blocked/failed reject their error, using TRAY_UNAVAILABLE for null/undefined while preserving other falsey failures. Invalid state rejects with TRAY_INVALID_ENTRY without reading that snapshot's error. Getter failures preserve native type/identity where possible and receive TRAY_GATE_READ_FAILED.

Only blocked permits a later explicit ready() to reacquire each entry.readiness and its current snapshot. Use a getter to obtain newly published objects. Failed, malformed snapshots, getter failures and the Graph startup result keep the same Promise. Success stops further external sampling, and disposal prevents retry. There is no automatic polling or retry timer.

| ITrayGraph member | Behavior                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| keys              | Frozen admitted keys in declaration order.                                                                                  |
| state / error     | open before ready; failed gate projection, then the Graph's state and original error.                                       |
| ready()           | No arguments; gates and starts dependencies, retaining final Promise identity.                                              |
| `get<T>(key)`     | Reads the Graph's own visible value; TRAY_UNKNOWN_ENTRY for unknown keys and TRAY_UNAVAILABLE for other unavailable states. |
| entryState(key)   | Reads one node's state, rejecting unknown keys.                                                                             |
| dispose()         | No arguments; revokes visibility and releases consumers before providers under Graph idempotency and Promise identity.      |

There is no second Tray value table. Startup, a later node's failure and shutdown do not expose partially started values. Both the primary and context.own resources belong to the node, so callers should not release them again. Graph retains primary and cleanup failures through cause/errors. Tray adds no timeout, scheduler or forced termination; same-realm start/release callbacks that never settle can keep waiting.

### Managed Host construction, mutation and types

Import `await createHost(options)` from /host. create() constructs the sole concrete PluginHost class instance or defineHost() handle. Its facade retains the original Host identity, domain core, pipeline and constructor baseline. Plugin install(core) receives domain core and lifecycle core rather than the Host handle.

| ICreateHostOptions field | Default and requirement                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| create                   | Required without a default; returns an original Host not already claimed by another Tray session.           |
| plugins                  | Required initial definition tuple without a default; admitted together and started by Feature dependencies. |
| mutationAdmissionMs      | Required finite non-negative millisecond budget for serialized graph-mutation admission.                    |
| quiescenceMs             | Required finite non-negative budget for bounded physical-cleanup waiting.                                   |
| shutdown.mode            | Required without a default: bounded or strict-drain.                                                        |
| report                   | undefined; receives contained lifecycle and cleanup diagnostics.                                            |

Tray uses Features, config and disposer from the same PluginHost admission snapshot. Its public dependency reader builds the dynamic graph before publishing ready definitions. Missing required providers leave definitions blocked. Missing optional providers do not block; present optional providers still install first. Dependencies come from Feature references rather than legacy plugin-dependency fields. Invalid descriptors reject before graph mutation with the PluginHost cause preserved; failures after graph mutation are observed through mutation results.

| Member                 | Contract                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| plugins / readyPlugins | All admitted definition names versus ready names only.                                                                                  |
| pluginState(name)      | Unknown names return blocked without providing extensions.                                                                              |
| extensions / config    | Retain the original Host baseline and ready-plugin surface.                                                                             |
| use(plugin)            | Adds a definition, which can be committed but blocked.                                                                                  |
| replace(plugin)        | Replaces the exact same-name generation while retaining its ordering slot.                                                              |
| unUse(name)            | Deletes a definition and blocks its consumer closure; unknown names return ok true / committed false / removed false.                   |
| dispose()              | Ends the graph, removes its internal anchor and cleans the concrete Host; concurrent and synchronous reentrant calls share one Promise. |

Committed indicates whether the exact candidate became the current binding. Neither ok nor the continued existence of a name determines that fact. Uncommitted duplicate, cycle or replacement candidates roll back without becoming a later restart source. True unUse permanently retires the ordering slot; later same-name use receives a new monotonic slot. Provider recovery and same-name replace retain the definition's existing slot.

Successful results carry result.view. Check ok and pass that view into createRuntime to retain newly installed extension types. The previous Host variable's static type does not change automatically. ITrayResolvedHost computes an exact ready closure for finite literal tuples of at most 128 definitions without widened names/providers. Larger or widened cases use ITrayHostDynamic, retaining the constructor baseline and unknown for unrecognized dynamic keys.

Host.state can be active / closing / terminal / failed. Cleanup failure can leave facade.state failed while its returned disposal result still says state terminal. Creation failures carry detail with cleanup information and a phase type of factory / admission / graph / setup / commit; current observed creation paths use factory/setup, without promising every typed phase will be emitted. A duplicate claim rolls back only the new claim rather than destroying an existing session. Frozen factory errors remain reachable through cause instead of being hidden by detail annotation. Mutating an escaped concrete Host bypasses the facade and fails subsequent trusted access with HOST_MUTATION_BYPASS.

### Logical completion and physical cleanup

Managed mutations/disposal use lifecycle's ICleanupResult. cleanupErrors is the current snapshot. cleanupComplete false requires observing the same physicalCompletion, whose result contains only later incremental errors. Use `mergeCleanupResults([result])` to combine current and later errors, including cross-realm Promises.

Before releasing an exact generation, Graph seals new binding leases and waits for existing users. PluginHost waits for that fence before consumer/provider and plugin/resource cleanup. Managed bounded shutdown can return logically after quiescenceMs; strict-drain awaits physical settlement. The original required execution.pipelineDrainTimeoutMs is a shared numeric batch budget after which later cleanup proceeds; false waits for actual completion item by item. A budget does not cancel pending Promises. physicalCompletion continues observing unfinished work and late errors.

Managed Host supports asynchronous explicit resource management. Where await using is unavailable, await host.dispose() in finally. cleanupComplete false does not mean all resources are released, and physical results must remain observed.

### Loaders, adapters and artifact custody

defineLoader({ load }) captures load once and returns a frozen contract. Each load(source, context) invokes that captured function once, accepting synchronous values, Promises and foreign thenables. defineAdapter({ adapt }) similarly captures its method and invokes it on each conversion. Neither creates a Host/Graph nor independently owns artifact cleanup. Standalone wrappers retain execution results; loadIntoHost owns transaction-phase error classification.

A loaded result requires value and a lifecycle release descriptor with callable force. This differs from a static entry's release function. The adapter converts value into a plugin descriptor compatible with the original Host core. Invalid contracts/results receive LOADER_CONTRACT_INVALID / ADAPTER_CONTRACT_INVALID as appropriate.

| loadIntoHost option              | Requirement                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| host / source / loader / adapter | Required managed Host, input source, loader and converter.                                           |
| mutation                         | Required use or replace, without a default.                                                          |
| timeoutMs                        | Required false or finite non-negative number, including zero/fractions; false disables the deadline. |
| signal                           | undefined; bridged only during this transaction's admission.                                         |
| report                           | undefined; diagnostics cannot replace its primary result.                                            |

Loader context provides native signal, deadlineAt (undefined for false), and report. Adapter context provides signal/deadlineAt. A provisional scope owns the artifact during load → adapt → use/replace. An uncommitted mutation rolls it back; a committed definition generation assumes custody. Even ok false or blocked/failed plugins keep their artifacts when committed is true, until later unUse/replace/dispose releases that generation.

Cancellation and deadlines notify cooperative signals rather than independently preventing an uncooperative loader/adapter from continuing or committing. timeoutMs is required; only false disables deadlineAt.

Successful loadIntoHost return cancels its timer and removes the caller-signal bridge. Later caller abort cannot affect the committed generation's loader context. Its scope remains generation-owned and aborts context.signal when it ends. Secondary rollback failures are reported without replacing the mutation primary. Existing lifecycle identities remain unchanged rather than all becoming Tray cleanup codes.

### Runtime leases, cancellation and self-mutation

createRuntime(host, options?) accepts the actual managed-Host capability and borrows its Host/Graph. options.shutdown.mode defaults to strict-drain, with bounded as the other value. options.report defaults to undefined. Runtime has no quiescenceMs; physical-cleanup waiting budgets belong to managed Host options.

run(name, options, execute) acquires a ready plugin's exact-generation lease and publishes only that registration's extension snapshot. Literal ready names retain exact inference; widened names yield a readonly unknown record rather than the entire Host extension surface.

| Run parameter or context    | Requirement and meaning                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| name / execute              | Required target name and function.                                                                               |
| options.timeoutMs           | Required false or finite non-negative number, including zero/fractions; deadlineAt uses systemScheduler's clock. |
| options.signal              | undefined, the caller cancellation source.                                                                       |
| context.runId / plugin      | Incrementing run identifier and target plugin name.                                                              |
| context.extensions          | This plugin generation's extension snapshot.                                                                     |
| context.signal / deadlineAt | Cooperative cancellation and monotonic deadline; deadlineAt is undefined for false.                              |
| context.self                | Self-mutation capability bound to this run, name and generation.                                                 |

Synchronous values, Promises, foreign thenables and thrown/rejected callbacks release their lease only at actual callback settlement. Callback failures preserve native type, stack, identity or cause. Signals, deadlines and Runtime.dispose abort cooperative signals without preempting code or releasing early; a callback may ignore cancellation and return successfully. Failed lease admission releases the deadline task and caller bridge. Complete capability/graph error identities remain unchanged, so not every admission failure becomes RUNTIME_ABORTED.

dispose() stops new runs, aborts active signals and shares one Promise. Strict-drain awaits real settlement and reports callback failures. Bounded returns a terminal result immediately with the current cleanupComplete value while outstanding callbacks retain their existing ownership. activeRuns counts unsettled callbacks. Runtime.dispose does not dispose its borrowed Host. Host disposing also retires Runtime admission and aborts active signals. Symbol.asyncDispose awaits Runtime.dispose and discards its result snapshot.

self.unUse() / self.replace(plugin) return a non-thenable ticket synchronously. The mutation waits for callback settlement and lease release before entering the canonical Host queue. Read ticket.completion outside the callback: an internal read returns a rejected Promise with RUNTIME_CONTRACT_INVALID. Awaiting the ticket itself does not await mutation. Replacement still checks the original Host core, and an old-generation ticket does not authorize a new generation. Avoid capturing concrete Host to remove the executing plugin.

### Host definitions and runtime families

The root defineTrayHost(definition) creates a frozen, branded definition. name, plugins and exposes are required; definition does not invoke the plugin factory or config validator. Structural copies lack its identity. exposes uses plugin.feature paths, and calls use plugin.feature.method. Reserved internal plugin names cannot be exposed as business plugins.

| Definition field          | Default and constraint                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| runtime                   | coroutine; alternatives are thread / process.                                                   |
| entry                     | Absent by default; required string/URL for thread/process and prohibited for coroutine.         |
| config(input)             | No validator by default; validates and converts input for every initialization.                 |
| plugins(info, trayPlugin) | Called per generation init with id, host, generation and validated config.                      |
| exposes                   | Required readonly Feature-path array.                                                           |
| supervisor                | Original runtime policy by default; restart and startupTimeoutMs can override it.               |
| limits.heapBytes          | Unspecified, thread only.                                                                       |
| sandbox                   | Unspecified, process only, with name and synchronous wrap(command).                             |
| routing                   | Unspecified trusted readonly policy tuple declaring custom policies available to child plugins. |

supervisor.restart.mode accepts never / on-failure / always; maxRestarts, windowMs and initialDelayMs are also configurable. sandbox.wrap receives and returns the complete launch command `{ command, args, cwd?, env }`, where env contains inherit/set. Applications supply an external sandbox; Tray provides no sandbox implementation.

Coroutine shares the event loop and stops cooperatively. Thread uses a separate Worker isolate; process uses a child process. A Node native entry imports a shared Host definition and calls serveTrayHost(host, { probe?, report? }). It connects to the parent registry rather than spawning again, and waits for shutdown and plugin cleanup before ending that runtime. Local Node or runtime-neutral examples do not establish Bun/Deno/browser Worker permissions or native-exit capabilities.

Plugins declare a Feature dependency on trayPlugin.getFeature('tray'). deps.tray.self() returns identity, await deps.tray.to(host, id) returns an admission-bound remote, and deps.tray.exit(error?) ends the instance. First exit determines clean versus crash, after PluginHost cleanup and before task/realm termination. The root exports ITrayClientPlugin only as a type without a runtime client singleton.

### Instance registry and remote calls

createTray({ hosts, routing?, probe?, report? }) returns ITray. Hosts is a required trusted-definition array; routing combines shared policies with every Host declaration. Probe defaults to unspecified and accepts one IRpcProbe or a readonly array. createTray.report defaults to Core's defaultRpcReporter. serveTrayHost accepts the same probe/report types and defaults report to console.error.

| Registry API                              | Behavior                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| spawn(name, { id, config? })              | Initializes and returns the typed remote; config is required when its inferred configuration type excludes undefined.  |
| instance(host, id)                        | Synchronously obtains a remote bound to one admission.                                                                 |
| list({ host?, runtime?, state? }?)        | Frozen snapshots; omitted filters impose no restriction.                                                               |
| get(id)                                   | Asynchronously merges RPC unit detail while retaining Tray's numeric generation.                                       |
| stop / remove(id, { graceMs? }?)          | graceMs defaults to 5000; attempts child PluginHost cleanup before stopping, reporting failure/timeout and continuing. |
| restart(id) / replace(id, { config? }?)   | Per-instance serialized management; replacement config commits only after new-generation init succeeds.                |
| on(event, listener) / watch({ signal? }?) | Lifecycle observation only; watch retains the latest 100 unread records rather than a durable log.                     |
| dispose({ graceMs? }?)                    | Closes the registry and owned instances, with asynchronous explicit resource management.                               |

TrayInstanceState is starting / ready / restarting / failed / stopped. TrayInstanceEvent is spawned / ready / restarting / failed / stopped / removed. Lifecycle records are frozen and there is no emit. Their safe error projection contains source/code rather than promising the original crash object.

Remote request/notify/stream use path, payload and third-position options. Empty methods may omit payload; use undefined in the second position when passing options. ITrayCallOptions contains only signal and timeoutMs, both unspecified by default. Undefined application-object fields reject; only absent payload/config in the wire envelope is omitted. Uint8Array works across all three families, and non-portable config rejects before connection creation.

Parent list/get config retains the portable spawn/replace input. Validation runs during child init; plugins(info) and deps.tray.self() receive that validator output locally, without another automatic wire conversion.

Non-ready targets reject with TRAY_INSTANCE_NOT_READY. Removed admissions permanently reject old remotes with TRAY_INSTANCE_UNKNOWN; spawning the same id cannot revive them. Already-sent calls finish through their original RPC receipt rather than moving to a new generation. Business errors retain source/code/cause, and Tray validation/start wrappers retain original causes. inFlight counts pending business request/notify/stream for this admission, excluding initialization and topic delivery.

### Routing and business topics

tray.routing.roundRobin(host) and tray.routing('roundRobin', host) share one sequence and choose a currently ready instance per operation. leastInFlight selects the fewest pending business calls with spawn-order ties. A routed remote has host without a fixed id. Remaining deadlines and cancellation reach the selected target, without automatic failover or retry.

defineRoutingPolicy(name, pick) creates a trusted frozen identity without invoking pick. Names match `^[a-z][A-Za-z0-9]*$` and cannot use built-ins or reserved function/object properties. pick(candidates, { host, sequence }) runs synchronously in the parent against a fresh frozen ready snapshot in spawn order with current inFlight, returning one candidate id. Keep it short. Parent registration combines createTray({ routing }) and Host DSL routing declarations; child plugins declare custom names in their own tuple. Only names cross RPC, and built-ins need no declaration.

Unknown or undeclared policies reject with TRAY_ROUTING_UNKNOWN. Invalid definitions, equal names from different policy identities, non-candidate results and thrown pickers reject with TRAY_ROUTING_INVALID, preserving the thrown cause. No ready candidates rejects with TRAY_HOST_UNAVAILABLE.

Parent tray.publish(topic, payload?) returns synchronously; child deps.tray.publish returns a Promise. Parent subscribe returns a synchronous unsubscribe function. Awaited child subscribe returns an asynchronous idempotent receipt: the first local listener registers parent membership and the last release removes it. Reinstalled plugins subscribe in the new generation after restart, without old-generation operations changing that membership.

Topics require non-empty strings and portable payloads. A topic named spawned remains a business topic without triggering lifecycle listeners. Listener(payload, meta) receives parent-authenticated frozen meta.from: `{ id, host, generation }` for an instance and `{ parent: true }` for parent publication. It is separate from arbitrary payload fields, which cannot impersonate the sender.

Each current subscription receives at most one delivery. Non-ready subscribers miss publications, with no replay, persistence or business-completion acknowledgement. Synchronous listener throws and async rejections are reported on their own side while later listeners continue. Delivery-send rejection is reported by the parent and handler failure by the child, without those delivery failures rejecting the publisher.

### Errors and migration

Tray-owned boundary codes use TRAY_SOURCE, `tray`. Branch on source/code rather than message. Annotatable native errors preserve type, stack and identity. Frozen or unsafe-to-annotate values remain reachable through a coded wrapper's cause, and complete foreign identities remain with their owner. Graph startup, node and release failures continue to belong to capability.

| TrayErrorCode property / value                    | Trigger                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| hostUnavailable / TRAY_HOST_UNAVAILABLE           | No ready routing candidate.                                                                                                    |
| routingUnknown / TRAY_ROUTING_UNKNOWN             | Policy not registered or not declared by the child.                                                                            |
| topicInvalid / TRAY_TOPIC_INVALID                 | Topic is not a non-empty string.                                                                                               |
| routingInvalid / TRAY_ROUTING_INVALID             | Invalid policy name/callback/result or thrown picker.                                                                          |
| hostInvalid / TRAY_HOST_INVALID                   | Invalid Host DSL or registry construction.                                                                                     |
| hostUnknown / TRAY_HOST_UNKNOWN                   | Spawn names an unregistered Host.                                                                                              |
| hostMismatch / TRAY_HOST_MISMATCH                 | Remote Host differs from its admission.                                                                                        |
| reservedName / TRAY_RESERVED_NAME                 | Exposure uses a reserved internal plugin name.                                                                                 |
| valueNotPortable / TRAY_VALUE_NOT_PORTABLE        | Unsupported portable config or payload.                                                                                        |
| instanceDuplicate / TRAY_INSTANCE_DUPLICATE       | Spawn reuses an admitted instance id.                                                                                          |
| instanceUnknown / TRAY_INSTANCE_UNKNOWN           | Lookup/remote uses an ended admission.                                                                                         |
| instanceNotReady / TRAY_INSTANCE_NOT_READY        | Target is not ready.                                                                                                           |
| instanceStartFailed / TRAY_INSTANCE_START_FAILED  | Plugin install or generation initialization failure, retaining cause.                                                          |
| pathNotExposed / TRAY_PATH_NOT_EXPOSED            | Call path is outside declared exposure.                                                                                        |
| childStateInvalid / TRAY_CHILD_STATE_INVALID      | Repeated child init or mismatched Host.                                                                                        |
| disposed / TRAY_DISPOSED                          | Registry operation after closure.                                                                                              |
| loaderContractInvalid / LOADER_CONTRACT_INVALID   | Invalid loader, result or release contract.                                                                                    |
| loaderExecutionFailed / LOADER_EXECUTION_FAILED   | Unclassified loader execution failure inside the load transaction.                                                             |
| adapterContractInvalid / ADAPTER_CONTRACT_INVALID | Invalid adapter or produced plugin shape.                                                                                      |
| adapterExecutionFailed / ADAPTER_EXECUTION_FAILED | Unclassified adapter execution failure inside the load transaction.                                                            |
| runtimeContractInvalid / RUNTIME_CONTRACT_INVALID | Invalid Runtime Host, arguments, callback or self-ticket use.                                                                  |
| runtimeDisposed / RUNTIME_DISPOSED                | Runtime run admission after closing.                                                                                           |
| runtimeExecutionFailed / RUNTIME_EXECUTION_FAILED | Unclassified callback throw/rejection, with lease release after settlement.                                                    |
| runtimeAborted / RUNTIME_ABORTED                  | Fallback for failed run-lease admission; complete foreign identities remain, and signal cancellation does not force rejection. |
| artifactCleanupFailed / ARTIFACT_CLEANUP_FAILED   | Unclassified secondary artifact cleanup failure without replacing the mutation primary.                                        |
| invalidEntry / TRAY_INVALID_ENTRY                 | Invalid static entry, managed factory result or Host claim.                                                                    |
| duplicateEntry / TRAY_DUPLICATE_ENTRY             | Duplicate static Graph key.                                                                                                    |
| unknownEntry / TRAY_UNKNOWN_ENTRY                 | Unknown key passed to get/entryState.                                                                                          |
| unavailable / TRAY_UNAVAILABLE                    | Graph/entry unavailable before readiness, after gate failure or termination.                                                   |
| gateReadFailed / TRAY_GATE_READ_FAILED            | Readiness property or state/error getter failure.                                                                              |
| hostMutationBypass / HOST_MUTATION_BYPASS         | Concrete Host mutation outside the managed facade.                                                                             |

Four former public managed-type helpers are no longer exported: IHostBaselinePlugins, IPluginWithSynchronousShared, ICanResolveReadyDefinitions and IResolveReadyTrayPlugins. Use ITrayResolvedHost / ITrayHostDynamic or inferred Runtime types externally. Runtime shutdown accepts only mode; its unused quiescenceMs field was removed, with that budget configured on managed Host instead. Loader/Adapter method getters are read once, and validation/execution use that same function.

The package provides fmt, lint, typecheck, typecheck:test, test and build. Preserve cause/errors and physicalCompletion when recording cleanup failures. This command list does not claim execution here, nor establish other hosts, native isolation or performance from local examples.
