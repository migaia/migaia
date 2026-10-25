# `@migaia/plugin-host`

[简体中文](./README.md)

Give a runtime-neutral Host ownership of plugin installation, dependencies, configuration, and cleanup, so an extensible library or application keeps clear commit and shutdown boundaries.

## You may have run into this

- A failed installation leaves callable extensions because each plugin publishes without a batch commit and rollback boundary.
- An external nested-setting edit changes plugin behavior because the Host still references caller-owned configuration.
- Closing repeats cleanup or releases resources in the wrong order because plugins and resources maintain separate teardown lists.
- Changing discovery order breaks startup because input order replaces declared provider dependencies.
- A missing service is discovered after connections open because dependency checks happen inside installers.

## Why choose it

- **A failed batch releases only its new resources.** Publishing extensions one at a time can expose a partial bundle, so defineHost commits or rolls back the batch while earlier plugins keep serving. [Runnable proof](./USEGUIDE.en.md#roll-back-a-failed-batch-without-removing-existing-plugins).
- **The Host owns its captured configuration.** A shallow copy still aliases nested objects; definePlugin copies and recursively freezes admitted config, with later committed changes through config.update. [Runnable proof](./USEGUIDE.en.md#keep-configuration-separate-from-later-source-mutations).
- **Release resources in reverse order and share one closing promise.** Separate cleanup lists invite ordering mistakes or duplicate release; onDispose registers resources during installation for one cleanup path owned by the host. [Runnable proof](./USEGUIDE.en.md#release-plugin-resources-once-in-reverse-acquisition-order).
- **Declared capability dependencies determine installation order.** Discovery order can place a consumer first; Feature references start its provider first and inject the exact output object. [Runnable proof](./USEGUIDE.en.md#start-providers-before-consumers-regardless-of-argument-order).
- **Missing requirements fail before installers start.** Looking up services during installation can fail after resource acquisition; Feature preflight rejects missing providers before entering installers. [Runnable proof](./USEGUIDE.en.md#reject-a-missing-provider-before-installers-run).

## Start here

Install a greeting plugin and call its successful handle. host.execution.mutationTimeoutMs and host.execution.pipelineDrainTimeoutMs are required without defaults; both are 5000 here. Explicit false removes the corresponding deadline.

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const greeting = definePlugin({
  name: 'greeting',
  install: () => ({ greet: () => 'hello' })
})
const [registration] = await host.use(greeting)
console.log(registration.extensions.greet())
await host.unUse('greeting')
await host.dispose()
```

Output:

```text
hello
```

For failed batches, see [rollback without removing existing plugins](./USEGUIDE.en.md#roll-back-a-failed-batch-without-removing-existing-plugins). For ordering, see [declared Feature dependencies](./USEGUIDE.en.md#start-providers-before-consumers-regardless-of-argument-order).

## Pitfalls when writing it yourself

Registering a function is easy; failed installation and shutdown still need consistent ownership. This illustration is type-checked only and is not run:

```ts doc-test=check
const extensions = new Map<string, { greet(): string }>()
extensions.set('greeting', { greet: () => 'hello' }) // Pitfall: immediate publication has no successful-batch commit point.
const cached = extensions.get('greeting') // Pitfall: deleting the entry does not revoke cached methods.
const resources: Array<() => void> = []
const dispose = () => resources.forEach((release) => release()) // Pitfall: cleanup runs forward and repeats on every call.
void cached
void dispose
```

The Host returns capability handles after installation and routes owned resources through one release path. Simple composition can remain sufficient for a few fixed extension points; a Host becomes useful for dynamic removal, dependencies, and rollback.

## A three-minute mental model

| Problem                                            | Tool                                              |
| -------------------------------------------------- | ------------------------------------------------- |
| Own installation and cleanup                       | defineHost; PluginHost when inheritance is needed |
| Define an installable capability and its resources | definePlugin, with onDispose during install       |
| Reuse the same capability between plugins          | defineFeature + provider.getFeature               |
| Call successfully installed methods                | handle.extensions returned by use                 |
| Commit config changes without editing a snapshot   | host.config / handle.config.update                |
| Pause reachability or reclaim resources            | plugin.disable / enable; unUse / dispose          |

A Host owns installation and release. A definition describes a plugin without installing it. A registration is one installation. A handle resolves the current registration by name. A Feature is a capability output with declared dependencies. A stage contributes to data processing. A lease represents a run still using one generation. Logical closure and actual resource release can finish at different times.

## Typical scenarios

| Scenario                                                      | Compose with    | Details                                                                                            |
| ------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| Install a plugin and read its extension                       | `defineHost`    | [Complete example](./USEGUIDE.en.md#install-a-plugin-and-read-its-extension)                       |
| Roll back a failed batch without removing existing plugins    | `defineHost`    | [Complete example](./USEGUIDE.en.md#roll-back-a-failed-batch-without-removing-existing-plugins)    |
| Keep configuration separate from later source mutations       | `definePlugin`  | [Complete example](./USEGUIDE.en.md#keep-configuration-separate-from-later-source-mutations)       |
| Release plugin resources once in reverse acquisition order    | `definePlugin`  | [Complete example](./USEGUIDE.en.md#release-plugin-resources-once-in-reverse-acquisition-order)    |
| Start providers before consumers regardless of argument order | `defineFeature` | [Complete example](./USEGUIDE.en.md#start-providers-before-consumers-regardless-of-argument-order) |
| Reject a missing provider before installers run               | `defineFeature` | [Complete example](./USEGUIDE.en.md#reject-a-missing-provider-before-installers-run)               |

## Installation

```bash
pnpm add @migaia/plugin-host
```

The complete scenarios import only the root entry and need no framework or external I/O. Runtime dependencies are capability, lifecycle, middleware-pipeline, and utils. Install one directly in the consuming project when importing its own entry.

## Essential APIs

| API                                         | When to use it                                      |
| ------------------------------------------- | --------------------------------------------------- |
| defineHost / PluginHost                     | Create a functional or class-based Host             |
| definePlugin / defineFeature                | Declare plugins and capability dependencies         |
| host.use / host.activate                    | Install a batch or explicitly activate lazy plugins |
| handle.extensions / host.config             | Use installed capabilities and read/update config   |
| host.plugin.disable / enable / host.replace | Pause, restore, or replace implementations          |
| host.unUse / host.dispose                   | Remove a plugin or close the Host                   |

## Typed named pipelines

Declare each payload with `pipelineSpec<TPayload>()({ mode?, next?, order? })`, then pass the map as top-level `pipelines` to defineHost. Owners receive use/run; installing plugin cores receive use only. Defaults are sync, single, and install order. Declarations share the existing Host revision, snapshots, ordering, and lease drain; omitting them preserves the default pipeline and existing generic calls.

See the [complete typed example](./USEGUIDE.en.md#declare-separate-pipelines-for-different-payloads), including explicit generic calls and removal across both pipelines.

## Contract details

### Ownership, entries, and type parameters

This package owns plugin installation, Feature dependencies, configuration, stage ownership, and cleanup. Applications supply domain behavior. It depends on `@migaia/capability`, `@migaia/lifecycle`, `@migaia/middleware-pipeline`, and `@migaia/utils`. Pipeline execution and stage lifting use middleware-pipeline; lifecycle scopes, mutation queues, and cleanup use lifecycle.

The public entries are `@migaia/plugin-host` and `@migaia/plugin-host/composition`. Do not import internal files. Applications normally use the root Host, plugin, Feature, handle, and error APIs. Composition is a narrow protocol for one composition owner rather than an alternative application Host.

The class `PluginHost<TDomainCore, TValue, TInstalled, TPipelines>` requires its first type parameter, TDomainCore. Its runtime createPluginDomainCore implementation returns an empty object by default. The final TPipelines axis defaults to `Record<never, never>`. The pipeline value type defaults to `never` and the declared installed tuple to `readonly []`; defineHost separately provides a default domain type. TInstalled informs installation constraints and configuration types. Runtime use() returns an exact input-order handle tuple; it does not change the static type of the Host variable. Published declarations cover the type-only extraction and merging helpers. `IPluginHostCoreFor<THost>` extracts a Host's domain and pipeline axes; type metadata adds no runtime capability.

Simple options or composed functions can suffice for a few static extension points. Use middleware-pipeline directly when only middleware execution is needed. This Host is useful when a library or application needs consistent plugin resources, dependencies, configuration, and reachability. Logger is an existing repository consumer.

### Creating a Host and all options

The class entry can override `createPluginDomainCore()` to create a domain core for each installation. The default is an empty object. Domain cores must be ordinary objects with enumerable data properties. They cannot override config, onDispose, or the four use*Pipeline core members. Invalid surfaces retain native TypeError with INVALID_OPTION.

`defineHost(options)` returns one frozen canonical handle. It supports the class behavior and exposes the class-protected useSync and runPipeline methods to the owner holding that handle. Its required `host` field has the same shape as the class constructor options.

| defineHost field                | Default and meaning                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domainCore(request)`           | Optional; omission returns an empty object. The Host supplies pluginName, zero-based batchIndex, and batch identity                                    |
| `translateDisposalError(error)` | Optional; omission preserves the original PluginHostError. Default structured disposal does not invoke this hook or translate individual cleanupErrors |
| `dispose(next)`                 | Optional disposal middleware; it must call next itself to include core cleanup. Repeated core disposal shares the original promise                     |
| `surface`                       | Optional; no domain public members by default, and the fourth type parameter defaults to an empty surface                                              |
| `pipelines`                     | Optional fixed map of authentic `pipelineSpec<TPayload>()(config)` values; use this top-level option for defineHost.                                   |

Own surface descriptors are captured once before Runtime acquisition; accessors remain live. Domain members, Host identity, shared outlets, and fluent pipeline methods belong to the same frozen handle. Canonical Host keys, including identity, take precedence. Composing packages should supply their methods here rather than copy a frozen handle. A surface option or descriptor-read failure retains the original through CALLBACK_FAILED. Existing calls with three type parameters remain valid.

The class constructor requires options; defineHost requires the same data under host.

| Field                                               | Default                               | Behavior                                                                                                     |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `identity?: { name?: string }`                      | name is `'DEFAULT'`                   | Optional readable name; the Host issues a unique id separately                                               |
| `execution.mutationTimeoutMs: number \| false`      | Required; none                        | Active mutation hook budget; false removes the deadline                                                      |
| `execution.pipelineDrainTimeoutMs: number \| false` | Required; none                        | Pipeline lease drain budget; false waits for actual draining                                                 |
| `pipeline?.mode`                                    | `'sync'`                              | sync / async / generator / async-generator; fixed after construction                                         |
| `diagnostic(message, code?, error?)`                | No-op                                 | Diagnostics and exact contained failure objects                                                              |
| `onDiagnosticFailure(error)`                        | globalThis.reportError when available | Terminal outlet for a diagnostic callback that throws or rejects                                             |
| `scheduler?: IScheduler`                            | Internal systemScheduler              | Shared now()/schedule() clock and timer owner                                                                |
| `queueAdmissionTimeoutMs?: number \| false`         | undefined                             | Report-only by default; a number rejects queued work at its limit; false disables related timers and reports |
| `queueAdmissionDiagnosticMs?: number \| false`      | 1000                                  | Report threshold only without an admission rejection limit; false disables its timer                         |
| `disposeStepTimeoutMs?: number \| false`            | 5000                                  | Wait limit for one ordinary cleanup step; false waits without a deadline                                     |

Time values must be finite and non-negative. Invalid options, nonfunction callbacks, or a scheduler without now()/schedule() retain TypeError with INVALID_OPTION. Directly install utils if importing its scheduler entry.

### Plugin definitions and published handles

`definePlugin(name, descriptorFactory, features?)` captures a definition without installing it. Each installation synchronously creates one descriptor, then uses its install(), expose(), and featureExpose() hooks. The two expose hooks return synchronous surfaces. Use `definePlugin(definition)` for configuration, setup, update, and disposal hooks. Both forms and valid raw descriptors share admission. Defining them does not execute an installer or Feature factory. Names are required, nonempty, unique within a Host, and cannot contain a dot. Object definitions capture own data fields and are frozen. The retired shared field has no compatibility fallback: migrate cross-plugin capabilities to Features; adapter-owned shared outlets still use their canonical owner protocol.

| Object definition field                               | Requirement, default, and role                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| name and install(core, setupOutput?)                  | Required; install returns a plain extension record or PromiseLike                       |
| config                                                | Optional; omitted configuration becomes an empty record owned as a frozen snapshot      |
| features and featureExpose                            | Optional Feature roots and explicitly exposed capabilities                              |
| setup(context)                                        | Optional, object form only; prepares resources and retains its output identity          |
| activation                                            | eager by default; lazy is the other value                                               |
| update(next, core)                                    | Optional; successful completion commits config, its return value does not supply config |
| onEnable(context), onDisable(context)                 | Optional post-commit notifications without cleanup ownership                            |
| onDependencyReplaced(name, outputs)                   | Optional in-place provider rebinding                                                    |
| beforeRelease(context)                                | Optional, at most once before releasing an installed generation                         |
| dispose(context?)                                     | Optional plugin cleanup, with PromiseLike support                                       |
| Symbol.dispose, asyncDisposeKey / Symbol.asyncDispose | Cleanup fallback when dispose is absent                                                 |

use(...plugins) accepts a plugin batch. Installation follows dependency order; returned handles follow input order. useSync cannot perform immediate asynchronous installation: a Promise/thenable result causes PLUGIN_INSTALL_FAILED with INSTALL_RESULT_THENABLE on cause, while its eventual rejection stays observed. Immediate installation with setup throws top-level SETUP_REQUIRES_ASYNC_INSTALL before any hook. Constructor options have no plugins field. A class owner calls protected useSync(plugins); the functional handle takes useSync(...plugins). Lazy definitions can be registered synchronously and activated later.

A handle has name, readonly extensions, getFeature(name), and config.get()/update(recipe). Member reads resolve the current registration by name, so an old handle can read a replacement implementation. After removal it throws PLUGIN_NOT_INSTALLED. An extracted extension function remains bound to its original registration and throws REGISTRATION_REVOKED after revocation. `isPluginHandleCurrent(handle)` instead checks the generation present when that handle was created: disabled and suspended remain current, while replacement, removal, disposal, and unknown objects return false. This probe does not change name-addressed member reads.

Extension results must be ordinary objects. Only enumerable, configurable data properties are published. Accessors and nonconfigurable properties fail with INVALID_OPTION; non-enumerable keys are intentionally skipped with EXTENSION_NON_ENUMERABLE_IGNORED. Do not return a frozen extension object. Host keys, then, and disposal symbols are reserved; catch and finally are allowed. Occupied ordinary keys produce EXTENSION_DUPLICATE; canonical keys take EXTENSION_RESERVED precedence; Object.prototype conflicts produce EXTENSION_OBJECT_PROTOTYPE. Installation retains these failures under PLUGIN_INSTALL_FAILED. An own then key has its specific INSTALL_RESULT_THENABLE classification.

### Plugin core, setup, and resources

Install/update cores include the domain core plus config.get(), operation, lifecycle, features, featureExpose, onDispose(resource), and four use*Pipeline(stage) methods. Config reads the committed recursively readonly snapshot. Operation supplies its signal and absolute deadlineAt; lifecycle supplies the registration-generation signal. Stage methods return the same core, are install-window-only, and enforce mode compatibility.

core.onDispose takes ownership only during installation. Outside that window it throws RESOURCE_OUTSIDE_INSTALL without acquiring or releasing the supplied resource; the caller still owns it. Resources may be cleanup functions, synchronous disposables, or asynchronous disposables. Their PromiseLike results are assimilated by the lifecycle owner. Synchronous installation may register asynchronous disposers.

Object-form setup runs in this order: domain core → setup → featureExpose → synchronous Feature factories → install. A batch proceeds serially in dependency order. Setup receives only config.get(), operation.{signal,deadlineAt,now()}, lifecycle.signal, and onDispose(resource). It has no Feature outputs, pipeline registration, or Host mutation capability. Its output is passed by identity as the second argument to featureExpose and install. Without setup, those hooks retain their one-core-argument calls.

Setup and subsequent install share the registration's absolute mutation deadline. With no deadline, deadlineAt is undefined; now uses the injected scheduler clock. Success closes the setup registration window without aborting operation.signal. Timeout or Host closure aborts the attempt and rolls back resources. An unsettled setup cannot prevent Host closure. A late result cannot install; a late rejection is reported. Cooperative cancellation echoing the same abort reason is not reported again.

A late setup context.onDispose first attempts to release a valid resource, then throws RESOURCE_OUTSIDE_INSTALL. A resource without a disposer yields INVALID_OPTION. This differs from late core.onDispose ownership. Setup failures in async use, replacement candidates, and prepared composition admissions preserve the original on PLUGIN_INSTALL_FAILED.cause. Lazy activate preserves its original failure identity. Restart diagnostics unwrap only one PLUGIN_INSTALL_FAILED layer, without stripping other original cause chains.

### Features and dependencies

`defineFeature(factory, dependencies?)` or `defineFeature({ install, dependencies? })` creates an opaque synchronous definition. Dependencies default to an empty map. The factory's core.featureExpose contains explicitly provided capabilities; its second argument contains declared direct dependency aliases. A factory cannot return PromiseLike, though methods of its returned object may be asynchronous. Runtime authority comes from package-owned identity stores, not the type-only __feature field.

definition.getFeature(name) requires a declared name and creates a required reference by default. getFeature(name, { optional: true }) permits undefined when its provider is absent or not activated. A disabled provider still throws PREREQUISITE_DISABLED. handle.getFeature(name) reads the instantiated output. References retain provider name literals; IPluginFeatureName and IPluginFeatureOutput extract names and outputs.

The Host validates required providers and cycles before any installer, then uses dependency order regardless of use argument order. Consumers receive the provider's exact output object, frozen per registration. Cached ordinary output objects and pure functions do not automatically gain revocation guards. Liveness checks belong to handle reads, extension callables, and protected featureExpose entries. Local Feature dependency closures also contribute cross-plugin edges. Missing, disabled, removed, and cyclic prerequisites use top-level PREREQUISITE_MISSING, PREREQUISITE_DISABLED, PREREQUISITE_REMOVED, and DEPENDENCY_CYCLE rather than an installation wrapper.

readPluginDependencies(input) returns a readonly { provider, required } list. It traverses the local closure, preserves first-provider-reference order, and lets required references win over optional duplicates. Inputs may be definitions, valid raw descriptors, or composition admissions. An admission reuses its captured snapshot without rereading getters; other inputs use standard admission once. No setup, installer, or factory runs. Native admission errors keep their exact object, runtime type, and stack.

### Configuration and commits

host.config is a stable facade. Its required get path can be a plugin name, plugin.key, or plugin.[index].key, with further nesting. Unknown plugins or paths return undefined. config.update(name, recipe) requires both arguments and a synchronous partial plain-record result. Missing plugins reject with PLUGIN_NOT_INSTALLED. handle.config offers the same operations scoped to one plugin.

Initial configuration is copied and recursively frozen. Ordinary records, arrays, and supported primitives are accepted; function leaves retain identity, so this is not a JSON serialization domain. Date, RegExp, Map, Set, class instances, accessors, nested non-enumerable properties, symbols, dangerous **proto**/constructor/prototype keys, callable then, and cycles are rejected. Repeated acyclic references are not cycles. Invalid values produce INVALID_CONFIG_VALUE; cycles produce CONFIG_CYCLE_REJECTED, with path/reason detail. Writes to frozen snapshots follow native JavaScript behavior without a promised PluginHost code.

Updates copy and freeze patched branches while sharing untouched frozen branches. update(next, core) sees the complete candidate, while core.config.get() still reads committed configuration. Success commits it. Recipe, patch admission, update-hook, and deadline failures preserve config identity, revision, and existing extensions. Unclassified callbacks receive CALLBACK_FAILED while retaining the original object or cause. Valid PromiseLike lifecycle results are assimilated once.

Both get and update require an active Host. Ordinary get entry failures throw synchronously; failures inside update's queue reject its promise. The setup/beforeRelease synchronous guards below still apply.

### Disablement, dependency policies, replacement, and lazy activation

await host.plugin.disable(name) returns { token }. await token.enable() restores that exact registration; host.plugin.enable(name) enables by name; disabled() returns a readonly name snapshot. Disablement keeps resources and scopes without disposal. Extensions, Feature outputs, and stages become unreachable, while Host configuration remains readable and updatable. A successful installation first fires onEnable; each later real transition fires its corresponding notification. Notification failures are reported without rolling back state. A dependent cannot enable while its provider remains disabled. A token preflights the full restoration group before enabling any member.

disable and unUse accept { policy?: 'reject' | 'cascade' | 'suspend'; dryRun?: boolean }, defaulting to reject and false. Reject preserves state and exposes all transitive blockers in detail.blockedBy. Cascade includes required dependents. Suspend handles the target while retaining activated dependent instances and resources. Their handles and extracted functions throw PLUGIN_SUSPENDED, and their stages stop participating. Re-enabling the same provider can restore them directly; a new provider with that name follows capability resume planning to rebind, restart, or resume. Whole-Host release remains dependent-first, including suspended registrations.

dryRun: true returns a frozen { policy, order, steps, edges } plan without ok or mutation. Real unUse success and failure both include frozen affected containing only applied steps; failure additionally includes errors. Migration: replace strict equality against the old { ok: true } shape with an ok check and affected inspection. Literal dryRun true selects the plan overload; omission/false selects execution. Branch on a broad boolean first. Retired { cascade: true } is rejected with INVALID_OPTION.

replace(name, next) requires matching names. It installs the candidate first and leaves the old implementation serving if that fails. Publication switches new runs to the new stage generation; existing runs keep old leases. Captured old functions revoke immediately, while name handles resolve the new registration. Disabled state is retained. Activated required dependents can rebind through onDependencyReplaced. Missing or failed hooks cause their required closure to drain and dispose dependent-first, then reinstall topologically, retaining runtime config and prior activation/disablement state. Old generations dispose after draining. Restart failure does not undo the new provider: failed dependents stay removed, and DEPENDENT_RESTART_FAILED retains an AggregateError ordered as restart failure, rebinding errors, then cleanup errors; detail.dependents lists the affected plugins. Secondary cleanup failures stay reported.

Lazy use registers without activation; extensions throw PLUGIN_NOT_ACTIVATED. activate(name) activates required lazy providers before its own installer. Concurrent same-name calls share a promise. Eager installation activates required registered lazy providers; lazy entries used only by lazy members remain cold. Failed preflight activates nothing. Disabled activation yields PLUGIN_DISABLED. Failed activation withdraws attempted stages, extensions, and shared receipts, releases resources, and retains the cold registration/handle. Explicit retry uses a new scope and batch-bound core. Cleanup errors preserve the primary, and late physical work remains observed.

### Mutation queue and reentry

Mutations such as use, unUse, and config.update share lifecycle's FIFO queue. Defaults report waits beyond 1000 ms without a code or rejection. Only a numeric queueAdmissionTimeoutMs removes expired queued work with MUTATION_QUEUE_TIMEOUT. It does not interrupt started work or permanently disable the Host. False disables those timers and reports. Terminal dispose enters the queue without admission-timeout eviction.

Lifecycle hooks, including setup, install, Feature/expose, update, beforeRelease, disposal, enablement, and rebinding, cannot reenter Host mutation. LIFECYCLE_MUTATION is thrown by entry guards on use/unUse/replace/config.update, while asynchronous enablement entries reject their promises. Throughout an awaited setup or beforeRelease window, new mutations are rejected through the same entry-specific form. Work queued before the window remains FIFO and may reach a configured admission deadline.

Synchronous activate reentry is rejected before consulting a shared request. The runtime has no async-context tracking: after an await, same-name activate can share the active promise just like an external caller. Awaiting one's own activation self-deadlocks. A finite mutationTimeoutMs eventually rejects and rolls back with MUTATION_EXECUTION_TIMEOUT; false can leave it pending indefinitely. Start activation outside hooks.

### Named pipelines: types, authority, and lifecycle

Declare a fixed name-to-spec map in the functional entry's top-level `pipelines`, or in class constructor options. Each value is created by `pipelineSpec<TPayload>()(config)` and independently infers its payload and mode. Names are nonempty enumerable own string keys. A structurally similar plain object is not an authentic spec. Descriptions are frozen, and the pipeline set cannot change after construction.

| config field | Default     | Accepted values and behavior                                                                                           |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mode`       | `'sync'`    | `'sync'`, `'async'`, `'generator'`, or `'async-generator'`; determines stages and run results.                         |
| `next`       | `'single'`  | `'single'` or `'multiple'`; uses middleware-pipeline's four-mode continuation and failure rules directly.              |
| `order`      | `'install'` | Allocation order, or its reverse with `'reverse'`. One plugin shares its original ordering slot across every pipeline. |

The functional handle owner can use `host.pipeline(name).use(stage)` and `.run(value, done)`. Class owners use protected `pipeline(name)`. An installing plugin receives only `core.pipeline(name).use(stage)`, with no run authority. Derive its type with `IPluginHostCoreFor<typeof host>` rather than repeating the payload map. Unknown names are rejected by the type checker; bypassing it produces a synchronous `PIPELINE_UNKNOWN`.

Named sync/generator runs return `TResult | undefined`; async/async-generator runs return `Promise<Awaited<TResult> | undefined>`. Short-circuiting returns undefined, and each traversal that reaches the end invokes done once. Multiple mode does not return a result array: collect per-traversal results explicitly in done. Async next errors observed through then/await belong to the stage; unobserved failures still reject the runner, with several originals retained in start order under `MULTIPLE_DOWNSTREAM_FAILED`. Generators receive suffix failures through throw at yield; sync processes all registered values before aggregating failures.

Pipeline publication belongs to the same Host commit. Each pipeline reuses its compiled snapshot within a visible stage revision; reverse ordering is also compiled once. Empty lanes call the terminal directly without a snapshot or lease. Nonempty lanes reuse the same registration, ordering, and quiescence/lease owners. Rollback, unUse, replace, disablement, and suspension affect all of a plugin's pipelines in one commit. Existing runs retain their original snapshots and generation leases distinguished by pipeline; drain joins that actual work under the existing lifecycle budgets. Owner registration on any pipeline while another is executing throws `PIPELINE_EXECUTING`.

Without pipelines, the final named axis defaults to `Record<never, never>` and allocates no extra named runner, lane, or lease key. Existing TValue, pipeline.mode, use*Pipeline, runPipeline/runPipelineSync/runPipelineAsync, and pipelineMode still address only the default pipeline; old explicit generic calls remain valid. Its private symbol occupies no string name. When explicitly supplying defineHost generics together with named declarations, pass `typeof pipelines` as the fifth parameter. Omitting that axis keeps it empty, so pipeline(name) accepts only never.

Invalid maps, names, specs, and order fail synchronously during construction as a native TypeError / `INVALID_PIPELINE_OPTION`, without returning a handle. Invalid mode retains `INVALID_PIPELINE_MODE`. Invalid next uses outer `INVALID_PIPELINE_OPTION` with middleware-pipeline's TypeError / `INVALID_OPTION` on cause. A spec configuration getter failure also keeps its original cause under `INVALID_PIPELINE_OPTION`.

### Pipelines, captured stages, and cancellation

Host stage registration returns this; plugin core registration returns the core. Unsupported lifts synchronously throw PIPELINE_MODE_MISMATCH with the upstream middleware-pipeline TypeError / INVALID_OPTION on cause.

| Registration                     | Allowed Host modes                         |
| -------------------------------- | ------------------------------------------ |
| usePipeline(stage)               | sync / async / generator / async-generator |
| useAsyncPipeline(stage)          | async                                      |
| useGeneratorPipeline(stage)      | generator / async-generator                |
| useAsyncGeneratorPipeline(stage) | async-generator                            |

For the default pipeline, class owners invoke protected runPipeline(value, done) from a domain entry; functional handles expose it directly. Both value and done are required. Sync next records a value and starts downstream after the current stage returns. Async next starts downstream immediately; awaiting it supports after-downstream logic. Omitting next is normal short-circuiting: done is skipped while the run can complete successfully. Duplicate next under the default single policy produces PIPELINE_NEXT_DUPLICATE; late next is ignored and reported as PIPELINE_NEXT_LATE.

With the default single policy, generator modes drain the current stage before passing its ordinary return value onward. Implicit undefined or GENERATOR_HALT stops the chain. GENERATOR_CONTINUE selects the last yield, or the input if nothing yielded. GENERATOR_UNDEFINED forwards an actual undefined payload only when its type permits it. Async-generator awaits serially; it provides neither streaming fan-out nor onion execution. Import modes, stage types, and these unique symbols directly from middleware-pipeline, and install that dependency directly when importing it.

When returned from a stage, these three symbols control traversal rather than represent business data.

This example uppercases the input `migaia`, then adds square brackets. The first stage returns `GENERATOR_CONTINUE` to pass its last yielded value to the second stage; the second returns the final string directly.

```ts doc-test=run
import { defineHost } from '@migaia/plugin-host'
import { GENERATOR_CONTINUE, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

/** This host owns the two string transformations and their cleanup. */
const textHost = defineHost<Record<never, never>, string>({
  host: {
    execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 },
    pipeline: { mode: MiddlewarePipelineMode.generator }
  }
})
textHost.useGeneratorPipeline(function* (value) {
  yield value.toUpperCase()
  return GENERATOR_CONTINUE
})
textHost.useGeneratorPipeline(function* (value) {
  return `[${value}]`
})
textHost.runPipeline('migaia', (value) => console.log(value))
await textHost.dispose()
```

It prints `[MIGAIA]`: the second stage receives `MIGAIA`, and the completion callback receives the bracketed result. Intermediate yields do not invoke downstream stages individually.

Registering stages while any nested run remains active throws PIPELINE_EXECUTING. A run captures its admitted stages. Host stages and plugin slots follow first-allocation order; disabling, restoring, and replacing retain positions. New runs do not acquire revoked generations; old runs retain their leases until completion or cooperative exit.

All stage modes receive context last; generators receive it second. context.signal is the Host lifecycle signal and aborts when disposal starts. A stage must use it to cancel its own I/O. At stage entry, return, or next dispatch, the runner can stop with HOST_DISPOSING or HOST_DISPOSED; it cannot preempt arbitrary promises. A signal reason and later admission error may have matching semantic identity without being the same object. Ordinary failure wins over simultaneous cancellation; one ordinary failure preserves its object. Async stage/downstream dual failures use AggregateError / PIPELINE_FAILED with [stageError, downstreamError]. Serial async-generator failures from factory, body, or done have no equivalent dual-frame aggregation.

### beforeRelease, removal, and physical completion

Before an installed registration is released, beforeRelease(context) runs at most once. During ordinary removal its publication still serves existing calls. The context signal belongs to that registration; deadlineAt and remainingMs() use the Host clock and disposeStepTimeoutMs. Disablement, suspension, and cold lazy registration alone do not trigger it. Failure or timeout is collected without rolling removal back. Migration: a nonfunction beforeRelease formerly used as metadata now fails as TypeError / INVALID_OPTION.

Removal withdraws new registration/stage admission, drains the relevant leases, runs the plugin disposer, then releases registered resources in reverse order. Ordinary unUse/dispose uses per-step disposeStepTimeoutMs. Reaching it records DISPOSE_STEP_TIMEOUT and continues without cancelling an active promise. A disposer awaiting the host.dispose that invoked it creates self-waiting; a finite step budget allows logical closure to proceed, while false waits indefinitely.

unUse returns { ok: true, affected } or { ok: false, errors, affected }. Drain timeout records PIPELINE_DRAIN_TIMEOUT and continues bounded cleanup. Default core dispose shares one promise across repeated calls and synchronous reentry. It returns logicalTerminal, cleanupErrors, cleanupComplete, and possibly physicalCompletion without reopening the Host on cleanup failure. Custom defineHost options.dispose middleware can throw or reject: that failure is classified and rejects the same memoized promise. Core structured cleanup does not guarantee that arbitrary middleware cannot reject.

cleanupComplete false does not mean resources have been released. cleanupErrors is a current snapshot; physicalCompletion carries later errors and may itself have a continuation. To obtain the complete final result, use lifecycle mergeCleanupResults([result]) and install lifecycle directly when importing it. Finite waits do not terminate running leases/disposers; late failures remain observed.

Cleanup functions run directly. Resource objects prefer asynchronous disposal, then synchronous disposal. A plugin's dispose hook takes precedence over symbol cleanup. asyncDisposeKey uses native Symbol.asyncDispose when available, otherwise the package fallback. Synchronous resources can use native Symbol.dispose or ordinary functions, without mandatory polyfills.

### Composition and managed adapters

isManagedHost(value) recognizes Hosts created by this physical package instance. openComposition(host) accepts those identities, including class and functional Hosts; a lookalike or another installed package copy is not sufficient. The identity writer is private, and defineHost accepts no receiver alias.

revision is the Host's committed modification version, not a count of attempted operations. A composition owner reads revision/getCurrentSnapshot(), captures definitions with createPluginAdmission, reserves opaque positions with createDataOrderSlot(name), then calls prepareAdmissions([{ admission, slot }]). Setup may execute, but candidate extensions, config, Features, and stages remain unpublished. commitPreparedAdmissions is synchronous without user code and rejects stale revisions. discardPreparedAdmissions rolls temporary resources back once. Returned registration tokens identify exact installations rather than whichever plugin currently has a name.

Calling createDataOrderSlot reserves its order immediately. Disablement, recovery, and replacement reuse it. Retire it only when a definition is permanently removed or the session ends. prepareUnUseBatch accepts exact tokens in the owner's cleanup order. commitPreparedUnUseBatch(prepared, { beforeCleanup? }) first commits logical revocation, then waits for the fence and generation-specific pipeline leases. beforeCleanup is optional without a default promise; when supplied it completes before cleanup.

Managed cleanup requires execution.pipelineDrainTimeoutMs. A number is shared across the batch's leases and cleanup steps; exhaustion continues later steps even if ordinary disposeStepTimeoutMs is false. Explicit pipelineDrainTimeoutMs false instead waits for actual completion step by step, bypassing ordinary limits. The budget does not revoke running work. Wait for every physicalCompletion continuation to finish before treating physical release as complete, or let the outer realm owner terminate its actual execution environment.

createView(token) exposes only that exact registration's extensions, without Host, config, shared, or mutation capability. Repeated views keep function references and concrete Host receivers. Token views remain valid during disablement; complete Host views reject then and recover their original function references on enablement. Removal revokes both. Foreign or revoked tokens fail closed. Migration: the old root createRegistrationView and IPluginRegistrationReceipt were removed; use composition createView/IRegistrationToken.

inspectFeatures(roots) from composition reads trusted Feature topology without executing factories. Adapter-only getPluginRuntimeIntegration(core) accepts a canonical package core and connects declared shared outlets, Features, and registration lifetimes. It is not an admission bypass for ordinary plugins. Only canonical same-family contributions share a slot; ordinary extensions and other families cannot occupy it. A new shared getter publication on a nonextensible Host preserves native TypeError with PLUGIN_INSTALL_FAILED and leaves no failed family behind. Ordinary handle extensions retain their existing nonextensible-Host contract.

### Errors, diagnostics, and states

PluginHostError extends Error with readonly source, code, and optional detail. Its source is plugin.host; cause/errors retain original failures. Mutable native callback errors receive identity in place; immutable or non-Error values remain on cause. Complete foreign identities retain their owner. INVALID_OPTION keeps TypeError; configuration-domain and cycle failures are PluginHostError. Do not classify all failures by one class or parse diagnostic text.

Rollback failures do not replace installation failures. PLUGIN_INSTALL_FAILED.detail includes failedName and rollbackErrors in release order. Async use publishes a completed frozen detail; sync useSync publishes a frozen snapshot with detail.completion for final frozen identities. Await completion before translating errors that need all secondary failures. PLUGIN_INSTALL_ROLLBACK_FAILED is an additional diagnostic.

diagnostic's third argument retains the original contained failure. Reporter failures cannot alter Host control flow: onDiagnosticFailure receives them, then globalThis.reportError is used if available when that outlet is missing or also fails. Provide onDiagnosticFailure explicitly when Node observation is needed. PluginHostStatus is active/closing/disposed; PluginHostRegistrationLifecycle is idle/install/dispose. ERROR_TEXT is the named root export of stable English texts. MiddlewarePipelineMode and Violation belong to middleware-pipeline.

PluginHostDisposalNodeKind distinguishes Host errors, aggregates, and disposer wrappers. readPluginHostDisposalProvenance(error) reads only provenance registered by this physical package instance. Unknown errors and another package copy return undefined rather than structural guesses. This supports diagnostics, not a replacement for source/code/cause handling.

| code                               | Meaning and response                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_DISPOSED`                    | The Host is terminal; create another Host.                                                                                      |
| `HOST_DISPOSING`                   | The Host is closing and rejects new mutations.                                                                                  |
| `PLUGIN_DUPLICATE`                 | A name is occupied or duplicated in the batch.                                                                                  |
| `PLUGIN_NOT_INSTALLED`             | The named registration is absent.                                                                                               |
| `PLUGIN_DISABLED`                  | The registration is disabled; enable it before use.                                                                             |
| `PLUGIN_SUSPENDED`                 | A required provider is unavailable; restore the dependency.                                                                     |
| `PLUGIN_NOT_ACTIVATED`             | A lazy registration needs activation.                                                                                           |
| `FEATURE_NOT_DECLARED`             | The requested Feature name was not declared.                                                                                    |
| `PREREQUISITE_MISSING`             | A required provider was never installed; preflight rejects.                                                                     |
| `PREREQUISITE_DISABLED`            | A required provider is disabled; enable it first.                                                                               |
| `PREREQUISITE_REMOVED`             | A required provider was removed; reinstall it.                                                                                  |
| `DEPENDENCY_CYCLE`                 | Feature references form a cycle; no installer runs.                                                                             |
| `DEPENDENCY_BLOCKED`               | The mutation would strand required dependents; inspect detail.blockedBy.                                                        |
| `REPLACE_NAME_MISMATCH`            | The replacement name differs; the candidate is not installed.                                                                   |
| `DEPENDENT_RESTART_FAILED`         | The replacement committed but dependents failed to restart; cause.errors starts with that failure.                              |
| `PLUGIN_DEFINITION_INVALID`        | A retired definition field, invalid dependency, or noncanonical core is rejected as TypeError.                                  |
| `PLUGIN_INSTALL_FAILED`            | Installation/publication failed; cause preserves the primary and detail retains rollback failures.                              |
| `SETUP_REQUIRES_ASYNC_INSTALL`     | Immediate useSync installation cannot run setup; use the async path.                                                            |
| `PLUGIN_INSTALL_ROLLBACK_FAILED`   | Diagnostic only: rollback also failed without replacing the installation primary.                                               |
| `INSTALL_RESULT_THENABLE`          | An own then key or async result on the sync path prevents extension publication.                                                |
| `PLUGIN_DISPOSE_FAILED`            | A beforeRelease or plugin cleanup step failed; cause retains it and cleanup continues.                                          |
| `EXTENSION_DUPLICATE`              | An extension key is occupied; canonical Host keys take EXTENSION_RESERVED precedence.                                           |
| `EXTENSION_OBJECT_PROTOTYPE`       | An extension key conflicts with Object.prototype.                                                                               |
| `EXTENSION_RESERVED`               | An extension uses a Host key, then, or disposal symbol.                                                                         |
| `EXTENSION_NON_ENUMERABLE_IGNORED` | Diagnostic only: a non-enumerable extension key was skipped.                                                                    |
| `RESOURCE_OUTSIDE_INSTALL`         | Core rejects late registration without ownership; a late setup resource is released before rejection.                           |
| `LIFECYCLE_MUTATION`               | A lifecycle reentry or mutation during setup / beforeRelease is forbidden.                                                      |
| `INVALID_PIPELINE_MODE`            | The constructor received an unsupported pipeline mode.                                                                          |
| `INVALID_PIPELINE_OPTION`          | Invalid named map, name, spec, next, or order; construction throws native TypeError, preserving an upstream cause when present. |
| `PIPELINE_UNKNOWN`                 | The requested name was not declared; correct the lookup or construction map.                                                    |
| `ASYNC_STAGE_IN_SYNC_ENTRY`        | A visible async stage prevents the default synchronous entry before any stage or terminal executes.                             |
| `PIPELINE_MODE_MISMATCH`           | A stage cannot be lifted to the Host mode; cause retains the upstream TypeError.                                                |
| `PIPELINE_NEXT_DUPLICATE`          | A stage calls next twice; downstream does not run twice.                                                                        |
| `PIPELINE_NEXT_LATE`               | Diagnostic only: next is ignored after stage completion.                                                                        |
| `PIPELINE_EXECUTING`               | A stage is registered during pipeline execution.                                                                                |
| `PIPELINE_FAILED`                  | Async stage and downstream both fail; AggregateError.errors is [stage, downstream].                                             |
| `MUTATION_QUEUE_TIMEOUT`           | A configured admission deadline removes queued work before it executes.                                                         |
| `DISPOSE_STEP_TIMEOUT`             | A beforeRelease or cleanup step exceeds its wait budget; cleanup continues without preemption.                                  |
| `INVALID_OPTION`                   | An invalid input shape remains a native TypeError; correct the input.                                                           |
| `INVALID_CONFIG_VALUE`             | A configuration value violates its data grammar; detail includes path/reason.                                                   |
| `CONFIG_CYCLE_REJECTED`            | Configuration contains a reference cycle.                                                                                       |
| `CALLBACK_FAILED`                  | An unclassified config, surface-read, or defineHost disposal callback failed; identity/cause survives.                          |
| `MUTATION_EXECUTION_TIMEOUT`       | A hook exceeded its execution budget and lost commit authority.                                                                 |
| `REGISTRATION_REVOKED`             | A captured extension belongs to a removed or replaced registration.                                                             |
| `PIPELINE_DRAIN_TIMEOUT`           | Ordinary removal exceeded its drain budget; it returns ok false and continues bounded cleanup.                                  |
| `CLEANUP_INCOMPLETE`               | Logical closure committed while cleanup failed or remains pending; inspect its continuation.                                    |
| `COMPOSITION_TARGET_UNMANAGED`     | The composition target is not a Host registered by this physical package instance.                                              |

### Host requirements and maintenance

The emitted syntax target is ES2020. The host must supply Promise, Map, Symbol, AggregateError, and the native capabilities used. Node, Bun, Deno, Workers, mini-programs, and Electron processes can host it without a framework binding. Browser use, including Chrome/Edge 85+, Firefox 79+, Opera 71+, and Safari 14+, also requires the native APIs used. Disposal symbols remain optional as described above.

The existing scripts below are package gates. test checks dist freshness, builds the package when needed, then runs Vitest. No command is considered passed without actual execution.

```bash
pnpm --filter @migaia/plugin-host run fmt
pnpm --filter @migaia/plugin-host run lint
pnpm --filter @migaia/plugin-host run typecheck
pnpm --filter @migaia/plugin-host run typecheck:test
pnpm --filter @migaia/plugin-host run test
```

For a stalled installation, distinguish queue admission, hook execution, and self-awaiting activation. A failed config update preserves the committed snapshot; inspect code/cause. Use handles returned from use for typed extension access. For unfinished cleanup, inspect its result and continuations rather than assuming logical closure implies physical release.

## Two execution entries

On sync/async hosts, owners can call `runPipelineSync(value, terminal)` or `runPipelineAsync(value, terminal)` on the `defineHost` handle; subclasses use the same protected entries. Both consume the same registrations, order and lifecycle leases. Sync stages run in both. A visible async stage makes the sync entry throw `ASYNC_STAGE_IN_SYNC_ENTRY` before any stage or terminal runs; removing or disabling it restores sync execution.

The sync entry returns `TResult | undefined`; the async entry accepts a terminal returning `Promise<TResult>` and returns `Promise<TResult | undefined>`. A stage that omits next halts with undefined. Empty lanes invoke the terminal directly, preserving its exact value or Promise identity. Nonempty async execution waits for the actual terminal operation before cleanup. Generator hosts retain `runPipeline`; explicit sync/async entries reject them with `PIPELINE_MODE_MISMATCH`.

`getPluginRuntimeIntegration(core).assertPreparedRegistration()` checks the original registration only. Current installation uses original operation admission; a completed candidate in the same unpublished batch requires its exact batch identity and a current installation; published registrations use the original handle admission. Rollback, removal, and host closing revoke access. It returns no registration object and grants no late resource or installation rights. Existing `assertCurrent()` and `core.config.get()` semantics remain unchanged.
