# `@migaia/plugin-host` usage guide

[简体中文](./USEGUIDE.md) · [Overview and quick start](./README.en.md)

| Find a scenario                                                                                                                 | Entry           | Behavior to confirm                               |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------- |
| [Install a plugin and read its extension](#install-a-plugin-and-read-its-extension)                                             | `defineHost`    | Extensions after successful installation          |
| [Roll back a failed batch without removing existing plugins](#roll-back-a-failed-batch-without-removing-existing-plugins)       | `defineHost`    | Rollback preserves earlier plugins                |
| [Keep configuration separate from later source mutations](#keep-configuration-separate-from-later-source-mutations)             | `definePlugin`  | A definition snapshot owns configuration          |
| [Release plugin resources once in reverse acquisition order](#release-plugin-resources-once-in-reverse-acquisition-order)       | `definePlugin`  | One disposal promise and a reverse resource stack |
| [Start providers before consumers regardless of argument order](#start-providers-before-consumers-regardless-of-argument-order) | `defineFeature` | Dependency order and exact output identity        |
| [Reject a missing provider before installers run](#reject-a-missing-provider-before-installers-run)                             | `defineFeature` | No installer runs with a missing prerequisite     |

Install the root package first. Each section is independently runnable and uses the code from its matching website case.

```bash
pnpm add @migaia/plugin-host
```

Shared parameters: defineHost requires host constructor options. Nested execution.mutationTimeoutMs and execution.pipelineDrainTimeoutMs are required without defaults, bounding active mutation and pipeline draining. Both are 5000 ms here; false waits without a deadline. Omitted pipeline.mode is sync. Omitted domainCore returns an empty object, and omitted custom dispose uses core structured cleanup.

## Install a plugin and read its extension

An application needs to add a named capability and later release its resources. Consumers need a usable extension after installation, rather than a partially initialized plugin object.

Assigning plugin methods directly onto an object does not define when installation commits or who owns cleanup. Returning before an asynchronous installer finishes also exposes methods before their resources exist.

defineHost creates the lifecycle owner, and await host.use() returns the installed registration. Both execution budgets are required and set to 5000 ms here; they have no implicit defaults. Dispose the host after use.

definePlugin requires the nonempty name greeting and an install callback returning an ordinary extension object. greet is a plugin-defined no-argument method returning a string. host.use takes a plugin batch and returns handles in input order.

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
await host.dispose()
```

Output:

```text
hello
```

Prints `hello`. The registration extension is called only after the installation promise has completed, and the final await waits for host cleanup.

The handle owns host operations; the plugin owns the extension it installs. mutationTimeoutMs bounds active mutations and pipelineDrainTimeoutMs bounds shutdown draining; false explicitly removes either deadline. These limits do not preempt user JavaScript.

## Roll back a failed batch without removing existing plugins

A feature bundle installs several plugins, but one installer rejects its settings. Previously installed capabilities must stay live, and resources created earlier in the failed bundle must be released.

Registering each extension immediately leaves half a bundle visible after failure. A catch that clears the whole registry also removes plugins that were committed before this batch began.

defineHost keeps a use() batch private until it commits. Register draft cleanup through core.onDispose during installation, then await use(draft, broken) to observe completed rollback and the original failure cause.

Both arguments to use(draft, broken) belong to this batch; existing does not. core.onDispose(resource) requires a cleanup resource and accepts ownership during installation. original is a prebuilt local failure object; comparing error.cause === original verifies its identity.

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const released: string[] = []
const [existing] = await host.use(
  definePlugin({
    name: 'existing',
    install: () => ({ read: () => 'live' })
  })
)
const original = new TypeError('invalid plugin settings')
const draft = definePlugin({
  name: 'draft',
  install: (core) => {
    core.onDispose(() => {
      released.push('draft')
    })
    return {}
  }
})
const broken = definePlugin({
  name: 'broken',
  install: () => {
    throw original
  }
})
try {
  await host.use(draft, broken)
} catch (error) {
  console.log((error as { code: string }).code, error instanceof Error && error.cause === original)
}
console.log(released.join(','))
console.log(existing.extensions.read())
await host.dispose()
```

Output:

```text
PLUGIN_INSTALL_FAILED true
draft
live
```

Prints `PLUGIN_INSTALL_FAILED true`, `draft`, then `live`. The wrapper retains the exact TypeError on cause; the failed batch releases its draft resource while the existing registration still works.

Asynchronous use() releases registered failed-batch resources before rejecting; this example acquires one resource. Previously committed registrations stay live. Arbitrary external side effects are not undone, and rollback errors remain secondary detail.

## Keep configuration separate from later source mutations

A plugin definition captures application settings, then the caller edits the original settings object before installation. The installed configuration should reflect the captured definition, not that later edit.

A shallow copy only separates the outer object. Nested settings remain shared references, so changing a nested limit can silently alter what a future installer reads.

definePlugin snapshots and recursively freezes admitted configuration data when the definition is created. Pass ordinary data records or arrays; the host later reads its own configuration through config.get(path).

config is optional and defaults to an empty configuration. Here its nested field is settings.limit: 3, captured when the definition is created. The required get path meter.settings.limit selects the plugin, settings record, and limit value. Unknown paths return undefined.

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const settings = { limit: 3 }
const definition = definePlugin({
  name: 'meter',
  config: { settings },
  install: () => ({})
})
settings.limit = 99
const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
await host.use(definition)
console.log(host.config.get('meter.settings.limit'))
console.log(Object.isFrozen(definition.config), Object.isFrozen(definition.config?.settings))
await host.dispose()
```

Output:

```text
3
true true
```

Prints `3` and `true true` on separate lines. Editing settings.limit to 99 does not change the installed value, and both captured configuration levels are frozen.

Omitted config defaults to an empty configuration. This is not JSON serialization: supported function leaves retain identity, while unsupported prototypes, accessors, symbols, thenables and cycles are rejected. Use host.config.update() for a committed configuration change.

## Release plugin resources once in reverse acquisition order

A plugin opens resources in order and depends on later resources being released first. Several callers may also ask the same host to close, so cleanup must not run again for every caller.

Keeping separate teardown lists makes it easy to reverse one list incorrectly or invoke a disposer twice. Calling cleanup from every dispose request multiplies releases of the same resource.

During definePlugin installation, core.onDispose transfers resources to that registration. defineHost memoizes the disposal promise; await it to observe the plugin hook followed by the resource stack.

Each core.onDispose call receives a no-argument cleanup function. The optional definition dispose hook is plugin-level cleanup; an omitted hook adds no step. Host dispose() takes no arguments and memoizes default core cleanup, releasing resources in reverse registration order.

```ts doc-test=run
import { defineHost, definePlugin } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const released: string[] = []
const resource = definePlugin({
  name: 'resource',
  install: (core) => {
    core.onDispose(() => {
      released.push('first')
    })
    core.onDispose(() => {
      released.push('second')
    })
    return {}
  },
  dispose: () => {
    released.push('plugin')
  }
})
await host.use(resource)
const closing = host.dispose()
console.log(host.dispose() === closing)
await closing
console.log(released.join(','))
await host.dispose()
console.log(released.length)
```

Output:

```text
true
plugin,second,first
3
```

Prints `true`, `plugin,second,first`, then `3`. Concurrent dispose calls share one promise, the plugin hook runs before its resources, and another completed dispose call adds no releases.

onDispose admits resources during installation; it is not a general late-registration API. The host collects cleanup failures, and disposeStepTimeoutMs defaults to 5000 ms per step; inspect cleanupComplete and physicalCompletion when cleanup exceeds its budget.

## Start providers before consumers regardless of argument order

Two plugins are supplied in UI discovery order, so a consumer can appear before the provider it needs. The consumer still needs the exact provider output, not a separate reconstructed service.

Installing strictly in array order fails when discovery order changes. Rebuilding the dependency inside each consumer avoids the missing value but creates duplicate service state and separate lifetimes.

defineFeature declares synchronous factories and dependency aliases. provider.getFeature() creates a required cross-plugin reference; host.use() validates the graph and starts the provider before resolving the consumer.

defineFeature(factory, dependencies?) requires a synchronous factory. The optional dependency map defaults to empty. summary declares cache as an alias of provider.getFeature("cache"), required by default. features is the optional named Feature map; use(consumer, provider) intentionally reverses installation order.

```ts doc-test=run
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
const order: string[] = []
const output = { read: () => 42 }
let sameOutput = false
const cache = defineFeature(() => {
  order.push('provider')
  return output
})
const provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })
const summary = defineFeature(
  (_core, dependencies) => {
    order.push('consumer')
    sameOutput = dependencies.cache === output
    return { read: () => dependencies.cache.read() }
  },
  { cache: provider.getFeature('cache') }
)
const consumer = definePlugin({ name: 'consumer', features: { summary }, install: () => ({}) })
const [consumerHandle, providerHandle] = await host.use(consumer, provider)
console.log(order.join(' -> '))
console.log(sameOutput)
console.log(consumerHandle.name, providerHandle.name)
await host.dispose()
```

Output:

```text
provider -> consumer
true
consumer provider
```

Prints `provider -> consumer`, `true`, then `consumer provider`. Factories follow dependency order and the consumer receives the exact output object; returned registration handles still follow the input order.

Factories must synchronously return objects, though their methods may be asynchronous. Outputs are frozen per registration; omitted dependencies mean an empty map, and required references must have available providers. This graph orders capabilities, not reactive data changes.

## Reject a missing provider before installers run

A deployment enables a consumer plugin but omits its required provider. The host should report the missing prerequisite before the consumer opens any resources.

Looking up services inside the installer discovers the problem only after earlier setup has already performed work. Passing undefined onward shifts the failure into unrelated consumer code.

A reference returned by getFeature() is required by default. defineFeature retains that dependency, and host.use() checks it before installation; count installer calls to make that admission boundary visible.

getFeature("cache") requires a declared name. Without { optional: true }, the reference is required. use(consumer) omits the provider and fails preflight; installs increments only inside the consumer installer.

```ts doc-test=run
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'

const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } }
})
let installs = 0
const cache = defineFeature(() => ({ read: () => 42 }))
const provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })
const summary = defineFeature(
  (_core, dependencies) => ({
    read: () => dependencies.cache.read()
  }),
  { cache: provider.getFeature('cache') }
)
const consumer = definePlugin({
  name: 'consumer',
  features: { summary },
  install: () => {
    installs++
    return {}
  }
})
try {
  await host.use(consumer)
} catch (error) {
  console.log((error as { code: string }).code)
}
console.log(installs)
await host.dispose()
```

Output:

```text
PREREQUISITE_MISSING
0
```

Prints `PREREQUISITE_MISSING` and `0`. The missing provider is rejected directly by preflight, and the consumer installer is never entered.

Use getFeature(name, { optional: true }) only when the consumer deliberately handles an absent output as undefined. Required and optional references both contribute ordering when a provider exists; this example intentionally uses the required default.

## Declare separate pipelines for different payloads

Put numeric processing and text splitting in separate pipelines. Names infer each stage parameter and next payload. Declarations belong at defineHost's top level; plugins register stages, while the host handle owner starts execution.

```ts doc-test=run
import {
  defineHost,
  definePlugin,
  pipelineSpec,
  type IPluginHostCoreFor
} from '@migaia/plugin-host'

const pipelines = {
  count: pipelineSpec<number>()({ mode: 'sync' }),
  text: pipelineSpec<{ text: string }>()({ mode: 'async', next: 'multiple', order: 'reverse' })
}
const host = defineHost({
  host: { execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 } },
  pipelines
})
const format = definePlugin({
  name: 'format',
  install(core: IPluginHostCoreFor<typeof host>) {
    core.pipeline('count').use((value, next) => next(value + 1))
    core.pipeline('text').use(async (value, next) => {
      await next({ text: value.text.toUpperCase() })
      await next({ text: value.text.toLowerCase() })
    })
    return {}
  }
})
await host.use(format)
const count = host.pipeline('count').run(1, (value) => value)
const texts: string[] = []
await host.pipeline('text').run({ text: 'Hi' }, (value) => {
  texts.push(value.text)
})
console.log(count, texts.join(','))
await host.unUse('format')
console.log(host.pipeline('count').run(1, (value) => value))
await host.dispose()
```

Prints `2 HI,hi`, then `1`. Removing the plugin withdraws its stages from both pipelines together. The plugin's core.pipeline('text') has no run, and misspelled names or numeric text payloads fail type checking. Owners register their own stages with host.pipeline(name).use(stage); those stages belong to no plugin, and registration is forbidden during execution.

### Explicit generic calls

If existing code supplies explicit defineHost generics, place the named axis after the previous four. Reuse the declaration object's type:

```ts doc-test=check
import { defineHost, pipelineSpec } from '@migaia/plugin-host'

const pipelines = { count: pipelineSpec<number>()({}) }
const host = defineHost<
  Record<never, never>,
  number,
  readonly [],
  Record<never, never>,
  typeof pipelines
>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  pipelines
})
host.pipeline('count').use((value, next) => next(value + 1))
await host.dispose()
```

Old explicit generic calls without pipelines need no new axis. The class entry is `PluginHost<TDomainCore, TValue, TInstalled, TPipelines>`; pass the same map in constructor options and invoke protected pipeline from subclass domain methods.

## Advanced: plugin-owned pipelines

A plugin can declare its payload, mode, next, and order in `definePlugin({ pipelines })`, without asking the application to copy its contracts. Host declarations use their original names, own pipelines use short names, and provider pipelines use `pluginName.pipelineName`. The genuine Feature dependency below supplies installation order and the qualified provider name, without another permission list.

```ts doc-test=check
import { defineFeature, defineHost, definePlugin, pipelineSpec } from '@migaia/plugin-host'

/** Own declarations infer this plugin's short names and payloads. */
const transport = definePlugin({
  name: 'transport',
  pipelines: { envelope: pipelineSpec<{ text: string }>()({ mode: 'async' }) },
  features: { ready: defineFeature(() => ({ ready: true })) },
  install(core) {
    core.pipeline('envelope').use(async (value, next) => next({ text: value.text.trim() }))
    return {}
  }
})
/** A real Feature reference supplies the existing provider dependency and qualified name. */
const dependency = defineFeature(() => ({}), { provider: transport.getFeature('ready') })
/** The dependent receives transport.envelope through inference, without copying its spec. */
const consumer = definePlugin({
  name: 'consumer',
  features: { dependency },
  install(core) {
    core.pipeline('transport.envelope').use(async (value, next) => next({ text: `${value.text}!` }))
    return {}
  }
})
/** The installed-definition type supplies owner names; use still performs actual installation. */
const host = defineHost<Record<never, never>, never, readonly [typeof transport]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
await host.use(transport, consumer)
console.log(
  await host.pipeline('transport.envelope').run({ text: ' hello ' }, (value) => value.text)
)
await host.unUse('transport', { policy: 'cascade' })
await host.dispose()
```

This prints `hello!`. Leave the install core inferred so the plugin's own `envelope` and its dependent's `transport.envelope` retain their payload types. Do not add a Host-only core annotation that hides a plugin's own declarations; `IPluginHostCoreFor<typeof host>` still fits the earlier example using only Host declarations. The installed-definition axis supplies types, while `await host.use(...)` performs the actual installation.

A plugin and its Features share that plugin's visible scope. A plugin cannot override a same-named Host pipeline. Lookup without the required dependency fails with `PIPELINE_UNKNOWN`; the diagnostic identifies the caller, requested name, and visible scopes. Groups are created in the installation transaction, rolled back on failure, and removed after draining under the existing budget.

## Advanced: compose pipelines with through

When target is inserted into source, the terminal of target is the remaining source stages and original terminal. It can transform the value, short-circuit, or handle the suffix result after `await next(...)`.

```ts doc-test=check
import { defineHost, definePlugin, pipelineSpec } from '@migaia/plugin-host'

/** Matching declarations infer both registration handles from this original definition. */
const bridge = definePlugin({
  name: 'bridge',
  pipelines: {
    source: pipelineSpec<{ count: number }>()({ mode: 'async' }),
    target: pipelineSpec<{ count: number }>()({ mode: 'async' })
  },
  install(core) {
    /** The target terminal resumes the remaining source stages and original terminal. */
    const link = core.pipeline('source').through('target')
    core.pipeline('source').use(async (value, next) => next({ count: value.count + 1 }))
    core.pipeline('target').use(async (value, next) => {
      /** This is the actual source suffix result, available after its completion. */
      const result = await next({ count: value.count * 2 })
      console.log(result)
    })
    return { removeLink: () => link.remove() }
  }
})
/** Execution remains with the owner of this actual Host. */
const host = defineHost<Record<never, never>, never, readonly [typeof bridge]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** Only this original registration owns the removable link. */
const [installed] = await host.use(bridge)
console.log(
  await host.pipeline('bridge.source').run({ count: 1 }, async (value) => value.count * 10)
)
installed.extensions.removeLink()
installed.extensions.removeLink()
await host.unUse('bridge')
await host.dispose()
```

Here target multiplies one by two, the source suffix adds one, and the original terminal multiplies by ten. Both target's next and the owner's run receive `30`. `remove()` is idempotent and withdraws only that registration; plugin removal also withdraws its links and stages. Active snapshots still drain through their original lifecycle.

Payload types and modes must match. Different modes fail with `PIPELINE_MODE_MISMATCH`. A multiple target with a non-multiple source, or a registration that creates a cycle, fails with `INVALID_PIPELINE_OPTION`; cycles are checked at registration. An empty target directly calls source next without a target snapshot or lease. `use` still accepts only a stage, never a string or pipeline object. Through belongs to plugin and Feature registration entries; Host owners retain use/run. The contract details below describe the full rules.

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
| `pipelines`                                           | Optional plugin-owned pipeline specs; see the advanced named-pipeline contract below.   |
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

Install/update cores include the domain core plus config.get(), operation, lifecycle, features, featureExpose, onDispose(resource), pipeline(name), and four use*Pipeline(stage) methods. Config reads the committed recursively readonly snapshot. Operation supplies its signal and absolute deadlineAt; lifecycle supplies the registration-generation signal. The four use*Pipeline methods still return the core; named use/through return registration handles with idempotent remove(). Registration is install-window-only and enforces mode compatibility.

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

Declare a fixed name-to-spec map in the functional entry's top-level `pipelines`, or in class constructor options. Each value is created by `pipelineSpec<TPayload>()(config)` and independently infers its payload and mode. Names are nonempty enumerable own string keys. A structurally similar plain object is not an authentic spec. Host declarations are frozen at construction. A plugin can also declare its own group in `definePlugin({ pipelines })`; the group is created during installation, rolled back on failure, and removed after draining under the existing budget. A plugin cannot override a same-named Host pipeline; collisions fail with `INVALID_PIPELINE_OPTION`.

| config field | Default     | Accepted values and behavior                                                                                           |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mode`       | `'sync'`    | `'sync'`, `'async'`, `'generator'`, or `'async-generator'`; determines stages and run results.                         |
| `next`       | `'single'`  | `'single'` or `'multiple'`; uses middleware-pipeline's four-mode continuation and failure rules directly.              |
| `order`      | `'install'` | Allocation order, or its reverse with `'reverse'`. One plugin shares its original ordering slot across every pipeline. |

The functional handle owner can use `host.pipeline(name).use(stage)` and `.run(value, done)`. Class owners use protected `pipeline(name)`. Installing plugin and Feature cores have only `use(stage)` and `through(name)` registration authority, without run. Both named methods return a handle with idempotent `remove()`; removal affects later runs while active snapshots drain through their original lifecycle.

A plugin and its Features access Host pipelines by their original names, their own pipelines by short names, and provider pipelines as `pluginName.pipelineName` through existing Feature dependencies. Unrelated plugins cannot access another group's pipelines. `IPluginHostCoreFor<typeof host>` remains useful for cores that use only Host declarations. When a plugin declares its own pipelines, let install infer its core so a Host-only annotation does not hide its short names. Unknown or invisible names synchronously throw `PIPELINE_UNKNOWN`; the diagnostic identifies the plugin or Feature, requested name, and visible Host, own-group, and dependency scopes.

Named sync/generator runs return `TResult | undefined`; async/async-generator runs return `Promise<Awaited<TResult> | undefined>`. Short-circuiting returns undefined, and each traversal that reaches the end invokes done once. Multiple mode does not return a result array: collect per-traversal results explicitly in done. In multiple mode, a stage can handle branch errors observed through next.then/await; unobserved failures still reject the runner, with several originals retained in start order under `MULTIPLE_DOWNSTREAM_FAILED`. Generators receive suffix failures through throw at yield; sync processes all registered values before aggregating failures.

Pipeline publication belongs to the same Host commit. Each pipeline reuses its compiled snapshot within a visible stage revision; reverse ordering is also compiled once. Empty lanes call the terminal directly without a snapshot or lease. Nonempty lanes reuse the same registration, ordering, and quiescence/lease owners. Rollback, unUse, replace, disablement, and suspension affect all of a plugin's pipelines in one commit. Existing runs retain their original snapshots and generation leases distinguished by pipeline; drain joins that actual work under the existing lifecycle budgets. Owner registration on any pipeline while another is executing throws `PIPELINE_EXECUTING`.

Without Host declarations, its named axis defaults to `Record<never, never>`; known plugin definitions still infer their qualified names. If neither the Host nor any plugin declares a named group, no extra named runner, lane, or lease key is allocated. Existing TValue, pipeline.mode, use*Pipeline, runPipeline/runPipelineSync/runPipelineAsync, and pipelineMode still address only the default pipeline; old explicit generic calls remain valid. Its private symbol occupies no string name. When explicitly supplying defineHost generics together with named declarations, pass `typeof pipelines` as the fifth parameter. Omitting that axis keeps it empty, so pipeline(name) accepts only never.

Invalid maps, names, specs, and order fail synchronously during construction as a native TypeError / `INVALID_PIPELINE_OPTION`, without returning a handle. Invalid mode retains `INVALID_PIPELINE_MODE`. Invalid next uses outer `INVALID_PIPELINE_OPTION` with middleware-pipeline's TypeError / `INVALID_OPTION` on cause. A spec configuration getter failure also keeps its original cause under `INVALID_PIPELINE_OPTION`.

### Advanced: through composition

`core.pipeline('y').through('z')` enters z at that position in y. The terminal of z is the remaining suffix and original terminal of y. The target can transform the same payload type, short-circuit, or handle the suffix result after an async stage's `await next(value)`. Its own order still applies.

Payload types and modes must match. Different modes fail with `PIPELINE_MODE_MISMATCH`; a multiple target with a non-multiple source, or a registration that creates a cycle, fails with `INVALID_PIPELINE_OPTION`. Cycles are checked at registration. An empty target directly calls the source next without a target snapshot or lease. Through returns a registration handle with idempotent `remove()`, owned by its registering plugin and withdrawn on removal. `use` still accepts only a stage, never a string or pipeline object; Host owners retain use/run.

### Pipelines, captured stages, and cancellation

The following four use*Pipeline methods return this on the Host and the core on a plugin; named use/through return registration handles. Unsupported lifts synchronously throw PIPELINE_MODE_MISMATCH with the upstream middleware-pipeline TypeError / INVALID_OPTION on cause.

| Registration                     | Allowed Host modes                         |
| -------------------------------- | ------------------------------------------ |
| usePipeline(stage)               | sync / async / generator / async-generator |
| useAsyncPipeline(stage)          | async                                      |
| useGeneratorPipeline(stage)      | generator / async-generator                |
| useAsyncGeneratorPipeline(stage) | async-generator                            |

For the default pipeline, class owners invoke protected runPipeline(value, done) from a domain entry; functional handles expose it directly. Both value and done are required. Sync next records a value and starts downstream after the current stage returns. Async next starts downstream immediately; awaiting it supports after-downstream logic. Omitting next is normal short-circuiting: done is skipped while the run can complete successfully. Duplicate next under the default single policy produces PIPELINE_NEXT_DUPLICATE; late next is ignored and reported as PIPELINE_NEXT_LATE.

With the default single policy, generator modes drain the current stage before passing its ordinary return value onward. Implicit undefined or GENERATOR_HALT stops the chain. GENERATOR_CONTINUE selects the last yield, or the input if nothing yielded. GENERATOR_UNDEFINED forwards an actual undefined payload only when its type permits it. Async-generator awaits serially; it provides neither streaming fan-out nor onion execution. Import modes, stage types, and these unique symbols directly from middleware-pipeline, and install that dependency directly when importing it.

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

A composition owner reads revision/getCurrentSnapshot(), captures definitions with createPluginAdmission, reserves opaque positions with createDataOrderSlot(name), then calls prepareAdmissions([{ admission, slot }]). Setup may execute, but candidate extensions, config, Features, and stages remain unpublished. commitPreparedAdmissions is synchronous without user code and rejects stale revisions. discardPreparedAdmissions rolls temporary resources back once. Returned registration tokens identify exact installations rather than whichever plugin currently has a name.

Calling createDataOrderSlot reserves its order immediately. Disablement, recovery, and replacement reuse it. Retire it only when a definition is permanently removed or the session ends. prepareUnUseBatch accepts exact tokens in the owner's cleanup order. commitPreparedUnUseBatch(prepared, { beforeCleanup? }) first commits logical revocation, then waits for the fence and generation-specific pipeline leases. beforeCleanup is optional without a default promise; when supplied it completes before cleanup.

Managed cleanup requires execution.pipelineDrainTimeoutMs. A number is shared across the batch's leases and cleanup steps; exhaustion continues later steps even if ordinary disposeStepTimeoutMs is false. Explicit pipelineDrainTimeoutMs false instead waits for actual completion step by step, bypassing ordinary limits. The budget does not revoke running work. Observe all physicalCompletion continuations for physical release, or let the outer realm owner terminate its actual execution environment.

createView(token) exposes only that exact registration's extensions, without Host, config, shared, or mutation capability. Repeated views keep function references and concrete Host receivers. Token views remain valid during disablement; complete Host views reject then and recover their original function references on enablement. Removal revokes both. Foreign or revoked tokens fail closed. Migration: the old root createRegistrationView and IPluginRegistrationReceipt were removed; use composition createView/IRegistrationToken.

inspectFeatures(roots) from composition reads trusted Feature topology without executing factories. Adapter-only getPluginRuntimeIntegration(core) accepts a canonical package core and connects declared shared outlets, Features, and registration lifetimes. It is not an admission bypass for ordinary plugins. Only canonical same-family contributions share a slot; ordinary extensions and other families cannot occupy it. A new shared getter publication on a nonextensible Host preserves native TypeError with PLUGIN_INSTALL_FAILED and leaves no failed family behind. Ordinary handle extensions retain their existing nonextensible-Host contract.

### Errors, diagnostics, and states

PluginHostError extends Error with readonly source, code, and optional detail. Its source is plugin.host; cause/errors retain original failures. Mutable native callback errors receive identity in place; immutable or non-Error values remain on cause. Complete foreign identities retain their owner. INVALID_OPTION keeps TypeError; configuration-domain and cycle failures are PluginHostError. Do not classify all failures by one class or parse diagnostic text.

Rollback failures do not replace installation failures. PLUGIN_INSTALL_FAILED.detail includes failedName and rollbackErrors in release order. Async use publishes a completed frozen detail; sync useSync publishes a frozen snapshot with detail.completion for final frozen identities. Await completion before translating errors that need all secondary failures. PLUGIN_INSTALL_ROLLBACK_FAILED is an additional diagnostic.

diagnostic's third argument retains the original contained failure. Reporter failures cannot alter Host control flow: onDiagnosticFailure receives them, then globalThis.reportError is used if available when that outlet is missing or also fails. Provide onDiagnosticFailure explicitly when Node observation is needed. PluginHostStatus is active/closing/disposed; PluginHostRegistrationLifecycle is idle/install/dispose. ERROR_TEXT is the named root export of stable English texts. MiddlewarePipelineMode and Violation belong to middleware-pipeline.

PluginHostDisposalNodeKind distinguishes Host errors, aggregates, and disposer wrappers. readPluginHostDisposalProvenance(error) reads only provenance registered by this physical package instance. Unknown errors and another package copy return undefined rather than structural guesses. This supports diagnostics, not a replacement for source/code/cause handling.

| code                               | Meaning and response                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_DISPOSED`                    | The Host is terminal; create another Host.                                                                                            |
| `HOST_DISPOSING`                   | The Host is closing and rejects new mutations.                                                                                        |
| `PLUGIN_DUPLICATE`                 | A name is occupied or duplicated in the batch.                                                                                        |
| `PLUGIN_NOT_INSTALLED`             | The named registration is absent.                                                                                                     |
| `PLUGIN_DISABLED`                  | The registration is disabled; enable it before use.                                                                                   |
| `PLUGIN_SUSPENDED`                 | A required provider is unavailable; restore the dependency.                                                                           |
| `PLUGIN_NOT_ACTIVATED`             | A lazy registration needs activation.                                                                                                 |
| `FEATURE_NOT_DECLARED`             | The requested Feature name was not declared.                                                                                          |
| `PREREQUISITE_MISSING`             | A required provider was never installed; preflight rejects.                                                                           |
| `PREREQUISITE_DISABLED`            | A required provider is disabled; enable it first.                                                                                     |
| `PREREQUISITE_REMOVED`             | A required provider was removed; reinstall it.                                                                                        |
| `DEPENDENCY_CYCLE`                 | Feature references form a cycle; no installer runs.                                                                                   |
| `DEPENDENCY_BLOCKED`               | The mutation would strand required dependents; inspect detail.blockedBy.                                                              |
| `REPLACE_NAME_MISMATCH`            | The replacement name differs; the candidate is not installed.                                                                         |
| `DEPENDENT_RESTART_FAILED`         | The replacement committed but dependents failed to restart; cause.errors starts with that failure.                                    |
| `PLUGIN_DEFINITION_INVALID`        | A retired definition field, invalid dependency, or noncanonical core is rejected as TypeError.                                        |
| `PLUGIN_INSTALL_FAILED`            | Installation/publication failed; cause preserves the primary and detail retains rollback failures.                                    |
| `SETUP_REQUIRES_ASYNC_INSTALL`     | Immediate useSync installation cannot run setup; use the async path.                                                                  |
| `PLUGIN_INSTALL_ROLLBACK_FAILED`   | Diagnostic only: rollback also failed without replacing the installation primary.                                                     |
| `INSTALL_RESULT_THENABLE`          | An own then key or async result on the sync path prevents extension publication.                                                      |
| `PLUGIN_DISPOSE_FAILED`            | A beforeRelease or plugin cleanup step failed; cause retains it and cleanup continues.                                                |
| `EXTENSION_DUPLICATE`              | An extension key is occupied; canonical Host keys take EXTENSION_RESERVED precedence.                                                 |
| `EXTENSION_OBJECT_PROTOTYPE`       | An extension key conflicts with Object.prototype.                                                                                     |
| `EXTENSION_RESERVED`               | An extension uses a Host key, then, or disposal symbol.                                                                               |
| `EXTENSION_NON_ENUMERABLE_IGNORED` | Diagnostic only: a non-enumerable extension key was skipped.                                                                          |
| `RESOURCE_OUTSIDE_INSTALL`         | Core rejects late registration without ownership; a late setup resource is released before rejection.                                 |
| `LIFECYCLE_MUTATION`               | A lifecycle reentry or mutation during setup / beforeRelease is forbidden.                                                            |
| `INVALID_PIPELINE_MODE`            | The constructor received an unsupported pipeline mode.                                                                                |
| `INVALID_PIPELINE_OPTION`          | Invalid declaration, plugin/Host name collision, incompatible through next policy or through cycle; existing causes remain reachable. |
| `PIPELINE_UNKNOWN`                 | Name is undeclared or invisible; diagnostics identify the caller and visible Host/own/dependency scopes.                              |
| `ASYNC_STAGE_IN_SYNC_ENTRY`        | A visible async stage prevents the default synchronous entry before any stage or terminal executes.                                   |
| `PIPELINE_MODE_MISMATCH`           | Unsupported stage lift or different source/target modes in through; stage-lift failures retain the upstream TypeError.                |
| `PIPELINE_NEXT_DUPLICATE`          | A stage calls next twice; downstream does not run twice.                                                                              |
| `PIPELINE_NEXT_LATE`               | Diagnostic only: next is ignored after stage completion.                                                                              |
| `PIPELINE_EXECUTING`               | A stage is registered during pipeline execution.                                                                                      |
| `PIPELINE_FAILED`                  | Async stage and downstream both fail; AggregateError.errors is [stage, downstream].                                                   |
| `MUTATION_QUEUE_TIMEOUT`           | A configured admission deadline removes queued work before it executes.                                                               |
| `DISPOSE_STEP_TIMEOUT`             | A beforeRelease or cleanup step exceeds its wait budget; cleanup continues without preemption.                                        |
| `INVALID_OPTION`                   | An invalid input shape remains a native TypeError; correct the input.                                                                 |
| `INVALID_CONFIG_VALUE`             | A configuration value violates its data grammar; detail includes path/reason.                                                         |
| `CONFIG_CYCLE_REJECTED`            | Configuration contains a reference cycle.                                                                                             |
| `CALLBACK_FAILED`                  | An unclassified config, surface-read, or defineHost disposal callback failed; identity/cause survives.                                |
| `MUTATION_EXECUTION_TIMEOUT`       | A hook exceeded its execution budget and lost commit authority.                                                                       |
| `REGISTRATION_REVOKED`             | A captured extension belongs to a removed or replaced registration.                                                                   |
| `PIPELINE_DRAIN_TIMEOUT`           | Ordinary removal exceeded its drain budget; it returns ok false and continues bounded cleanup.                                        |
| `CLEANUP_INCOMPLETE`               | Logical closure committed while cleanup failed or remains pending; inspect its continuation.                                          |
| `COMPOSITION_TARGET_UNMANAGED`     | The composition target is not a Host registered by this physical package instance.                                                    |

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
