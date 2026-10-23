# @migaia/tray usage guide

Choose a complete task below, then consult the static-resource graph, managed-plugin, loading and instance-registry contracts. These examples use real Tray, PluginHost and Runtime objects in one realm. They do not establish Worker, process, sandbox or cross-machine execution.

## Find a scenario

| Scenario                                                        | Main API          | Details                                                                              |
| --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ |
| Start dependencies before consumers and release them last       | `createTrayGraph` | [Complete example](#start-dependencies-before-consumers-and-release-them-last)       |
| Retry a blocked readiness gate without retrying a failed gate   | `createTrayGraph` | [Complete example](#retry-a-blocked-readiness-gate-without-retrying-a-failed-gate)   |
| Keep a dependent plugin blocked until its provider is installed | `createHost`      | [Complete example](#keep-a-dependent-plugin-blocked-until-its-provider-is-installed) |
| Transfer loaded artifact cleanup only when admission commits    | `loadIntoHost`    | [Complete example](#transfer-loaded-artifact-cleanup-only-when-admission-commits)    |
| Keep a cancelled callback alive until it really settles         | `createRuntime`   | [Complete example](#keep-a-cancelled-callback-alive-until-it-really-settles)         |
| Remove the current plugin after its callback releases the lease | `createRuntime`   | [Complete example](#remove-the-current-plugin-after-its-callback-releases-the-lease) |

## Run the examples

Install this package and plugin-host, which managed-Host examples import directly.

```bash
pnpm add @migaia/tray @migaia/plugin-host
```

Each example can be saved as a separate ESM TypeScript file and run with Node 24. Explicit Promise gates and lifecycle results control ordering without fake ports, browser globals or background Workers. In production, finish cleanup through the same owner using dispose/physicalCompletion and retain causes and cleanup results.

## Start dependencies before consumers and release them last

An application starts a service before its configuration is available, or tears down configuration while the service still uses it.

Array order and scattered finally blocks do not describe dependencies; changing registration order can change which resource survives a failure.

Declare the service's config key in requires. createTrayGraph does not start during construction; ready starts dependencies first and dispose releases consumers before providers.

### Example parameters

The complete entry array is createTrayGraph's one required argument. Keys are centrally declared branded strings; kind is required and uses 'service'/'value' here. requires declares the service's direct config dependency and defaults to an empty array. Start returns a value and callable release. The context.get type argument describes the read statically. Readiness is omitted, so there is no external gate. Ready and dispose take no arguments.

```ts doc-test=run
import { createTrayGraph, type ITrayKey } from '@migaia/tray'

const config = 'config' as ITrayKey
const service = 'service' as ITrayKey
const events: string[] = []
const tray = createTrayGraph([
  {
    key: service,
    kind: 'service',
    requires: [config],
    start: (context) => {
      events.push('start:service')
      return {
        value: context.get<number>(config) * 2,
        release: () => {
          events.push('release:service')
        }
      }
    }
  },
  {
    key: config,
    kind: 'value',
    start: () => {
      events.push('start:config')
      return {
        value: 21,
        release: () => {
          events.push('release:config')
        }
      }
    }
  }
])
console.log('before:', tray.state, events.length)
await tray.ready()
console.log('value:', tray.get<number>(service))
await tray.dispose()
console.log(events.join(','))
console.log('after:', tray.state)
```

Output:

```text
before: open 0
value: 42
start:config,start:service,release:service,release:config
after: terminal
```

Output: before: open 0; value: 42; start:config,start:service,release:service,release:config; after: terminal.

The dependency starts first despite being listed second, and is released last. These are same-realm resources with explicit release callbacks; this example does not demonstrate Worker or process isolation.

## Retry a blocked readiness gate without retrying a failed gate

A service cannot start until an external provider becomes ready, but a temporary block should not be treated as a permanently failed startup.

Polling a captured blocked object keeps reading old facts, while retrying every rejected Promise can rerun a failure the provider has declared final.

Return current snapshots from the readiness getter and call ready again after a blocked result. A failed snapshot is final and retains its rejected Promise.

### Example parameters

Omitting readiness supplies no external gate. This getter returns a state/error snapshot, with state limited to ready, blocked or failed. The blocked error preserves the reason without starting the service; replacing the snapshot only takes effect through another explicit ready call. A separate failed graph checks cached rejection identity. Error undefined means the ready snapshot has no error, without removing the requirement for a complete start result.

```ts doc-test=run
import { createTrayGraph, type ITrayKey, type IGraphReadinessSnapshot } from '@migaia/tray'

const key = 'search' as ITrayKey
const waiting = new Error('provider not ready')
let snapshot: IGraphReadinessSnapshot = { state: 'blocked', error: waiting }
let starts = 0
const tray = createTrayGraph([
  {
    key,
    kind: 'service',
    get readiness() {
      return snapshot
    },
    start: () => {
      starts += 1
      return { value: 42, release: () => undefined }
    }
  }
])
try {
  await tray.ready()
} catch (error) {
  console.log('blocked:', error === waiting, starts)
}
snapshot = { state: 'ready', error: undefined }
await tray.ready()
console.log('retry:', tray.state, starts, tray.get<number>(key))
await tray.dispose()

const failure = new Error('provider failed')
const failed = createTrayGraph([
  {
    key,
    kind: 'service',
    readiness: { state: 'failed', error: failure },
    start: () => ({ value: 0, release: () => undefined })
  }
])
const first = failed.ready()
console.log('cached:', first === failed.ready())
try {
  await first
} catch (error) {
  console.log('cause:', error === failure)
}
await failed.dispose()
```

Output:

```text
blocked: true 0
retry: ready 1 42
cached: true
cause: true
```

Output: blocked: true 0; retry: ready 1 42; cached: true; cause: true.

Blocked readiness starts nothing and can be sampled again explicitly. Failed readiness keeps one Promise and the original error. No timer polls the provider, and disposal prevents later retries.

## Keep a dependent plugin blocked until its provider is installed

A plugin arrives before its required provider. Installing it immediately exposes a half-ready feature; discarding it forces the caller to reconstruct the dependency chain later.

A list of plugin names cannot distinguish a registered definition from an installed, ready plugin or explain which consumer must stop when a provider leaves.

Declare the dependency with a Feature reference. createHost retains the blocked consumer; use installs the provider and reconciles its consumers, while unUse blocks them again.

### Example parameters

Create returns the sole AppHost. Its PluginHost execution.mutationTimeoutMs and pipelineDrainTimeoutMs are explicitly false, disabling those deadlines. CreateHost requires create, plugins, mutationAdmissionMs, quiescenceMs and shutdown without defaults. Both budgets are 1000 milliseconds here. Strict-drain awaits physical cleanup; bounded is the other mode. Provider.getFeature('value') is required by default, and config in the Feature dependency map names that dependency. Report is omitted, with no custom diagnostic callback.

```ts doc-test=run
import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
const events: string[] = []
const provider = definePlugin({
  name: 'config',
  features: { value: defineFeature(() => ({ base: '/api' })) },
  install: () => {
    events.push('config')
    return {}
  }
})
const consumer = definePlugin({
  name: 'screen',
  features: {
    value: defineFeature(() => ({}), { config: provider.getFeature('value') })
  },
  install: () => {
    events.push('screen')
    return {}
  }
})
const host = await createHost({
  create,
  plugins: [consumer] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
try {
  console.log('before:', host.pluginState('screen'), events.length)
  const installed = await host.use(provider)
  console.log('after:', installed.ok, host.pluginState('screen'))
  console.log(events.join(','))
  const removed = await host.unUse('config')
  console.log('removed:', removed.ok, host.pluginState('screen'))
} finally {
  await host.dispose()
}
```

Output:

```text
before: blocked 0
after: true ready
config,screen
removed: true blocked
```

Output: before: blocked 0; after: true ready; config,screen; removed: true blocked.

The blocked consumer was not installed early; the provider installs first when it arrives. Required dependencies come from Feature references. This is one local managed PluginHost, not a native-host launch.

## Transfer loaded artifact cleanup only when admission commits

Loading a plugin also acquires a resource. If conversion fails, that resource must be released; after a successful install it must stay alive until that exact plugin is removed.

Splitting load, conversion and installation across independent try/finally blocks can free a committed resource early or leak an uncommitted one.

Use defineLoader and defineAdapter with loadIntoHost. The transaction owns the provisional artifact, rolls it back on conversion failure, and transfers custody on a committed mutation.

### Example parameters

Host, source, loader, adapter, mutation and timeoutMs are required. Mutation use installs a definition, with replace as the alternative. TimeoutMs false disables its deadline; numeric values must be finite and non-negative. Loader returns a numeric value and lifecycle release descriptor with force; adapter returns a plugin descriptor. An omitted signal removes only the caller bridge, not deadline/scope cancellation, which remains cooperative. Committed determines custody, while ok determines successful-view typing. Host construction uses the same explicit options as above.

```ts doc-test=run
import { PluginHost } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'
import { defineAdapter } from '@migaia/tray/adapter'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
const host = await createHost({
  create,
  plugins: [],
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
let releases = 0
const loader = defineLoader({
  load: (source: number) => ({
    value: source,
    release: {
      force: () => {
        releases += 1
      }
    }
  })
})
const adapter = defineAdapter({
  adapt: (value: number) => ({
    name: 'answer' as const,
    install: () => ({ answer: () => value })
  })
})
try {
  const result = await loadIntoHost({
    host,
    source: 42,
    loader,
    adapter,
    mutation: 'use',
    timeoutMs: false
  })
  console.log('committed:', result.ok, result.committed, releases)
  if (result.ok) console.log('value:', result.view.extensions.answer())
  await host.unUse('answer')
  console.log('released:', releases)
  const primary = new TypeError('artifact rejected')
  try {
    await loadIntoHost({
      host,
      source: 7,
      loader,
      adapter: defineAdapter({
        adapt: () => {
          throw primary
        }
      }),
      mutation: 'use',
      timeoutMs: false
    })
  } catch (error) {
    console.log(
      'rolled back:',
      error === primary,
      (error as Error & { code?: string }).code,
      releases
    )
  }
} finally {
  await host.dispose()
}
```

Output:

```text
committed: true true 0
value: 42
released: 1
rolled back: true ADAPTER_EXECUTION_FAILED 2
```

Output: committed: true true 0; value: 42; released: 1; rolled back: true ADAPTER_EXECUTION_FAILED 2.

Success retains the artifact until unUse, while adapter failure releases its artifact and preserves the TypeError. Custody follows committed, not merely ok; cleanup can be deferred by active work or fail separately.

## Keep a cancelled callback alive until it really settles

A caller cancels a task while its callback is still using plugin extensions. Reporting it as finished immediately lets cleanup run against resources the callback still holds.

Promise races only stop waiting; they do not stop same-realm user code or prove it has released its resources.

Run through createRuntime with a caller signal. The callback receives a cooperative signal, and its generation remains leased until the callback settles; this example releases a Promise gate explicitly.

### Example parameters

CreateRuntime(host) defaults to shutdown.mode strict-drain and no report callback, borrowing the Host. Run requires the name, options and callback. Signal is optional, while timeoutMs is required false or a finite non-negative number. Extensions exposes only the current billing installation; signal is native and cooperative. An explicit Promise gate determines completion without a timing assumption. Host construction uses the same options as above, and Runtime.dispose does not replace Host.dispose.

```ts doc-test=run
import { PluginHost } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { createRuntime } from '@migaia/tray/runtime'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
const host = await createHost({
  create,
  plugins: [
    { name: 'billing', install: () => ({ double: (value: number) => value * 2 }) }
  ] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
const runtime = createRuntime(host)
const caller = new AbortController()
const reason = new Error('caller cancelled')
let finish!: () => void
const gate = new Promise<void>((resolve) => {
  finish = resolve
})
let observed: { readonly aborted: boolean; readonly reason: unknown } | undefined
try {
  const run = runtime.run(
    'billing',
    { signal: caller.signal, timeoutMs: false },
    async ({ signal, extensions }) => {
      observed = signal
      console.log('value:', extensions.double(21))
      await gate
      return 'settled'
    }
  )
  caller.abort(reason)
  console.log('aborted:', observed?.aborted, observed?.reason === reason, runtime.activeRuns)
  finish()
  console.log('result:', await run, runtime.activeRuns)
  await runtime.dispose()
  console.log('host:', host.state)
} finally {
  finish()
  await runtime.dispose()
  await host.dispose()
}
```

Output:

```text
value: 42
aborted: true true 1
result: settled 0
host: active
```

Output: value: 42; aborted: true true 1; result: settled 0; host: active.

Cancellation preserves the reason and leaves one active run until actual settlement. A callback may still return successfully. Runtime disposal does not dispose its borrowed Host; deadlines also signal cancellation rather than preempting code.

## Remove the current plugin after its callback releases the lease

A one-shot plugin wants to remove itself after returning a result. Waiting for ordinary removal inside its own callback can wait on the callback's own generation lease.

Capturing the raw Host bypasses the current generation capability, while treating a mutation receipt as an ordinary Promise hides when cleanup may safely start.

Return self.unUse's ticket from the callback, then await ticket.completion outside run. Runtime releases the callback lease before submitting that exact-generation mutation.

### Example parameters

The Host plugins tuple installs oneShot. Its install core supplies onDispose rather than being the Host handle. Run requires timeoutMs false and has no caller signal by default. Self.unUse takes no arguments and is bound to this run's name/generation; self.replace(plugin) is the replacement alternative. Return the ticket and read completion outside the callback. It has no then and does not itself await mutation. Runtime still defaults to strict-drain, and Host budgets remain explicit as above.

```ts doc-test=run
import { PluginHost, type IPluginHostCore } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { createRuntime } from '@migaia/tray/runtime'

class AppHost extends PluginHost<Record<string, never>, string> {}
const create = () =>
  new AppHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
let releases = 0
const host = await createHost({
  create,
  plugins: [
    {
      name: 'oneShot',
      install: (core: IPluginHostCore<string>) => {
        core.onDispose(() => {
          releases += 1
        })
        return { answer: () => 42 }
      }
    }
  ] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
const runtime = createRuntime(host)
try {
  const ticket = await runtime.run('oneShot', { timeoutMs: false }, ({ self, extensions }) => {
    console.log('value:', extensions.answer())
    return self.unUse()
  })
  console.log('ticket:', 'then' in ticket, runtime.activeRuns)
  await ticket.completion
  console.log('removed:', host.plugins.includes('oneShot'), releases)
} finally {
  await runtime.dispose()
  await host.dispose()
}
```

Output:

```text
value: 42
ticket: false 0
removed: false 1
```

Output: value: 42; ticket: false 0; removed: false 1.

The ticket is not thenable, and its outer completion observes one plugin cleanup after the callback ends. Reading completion inside that callback rejects RUNTIME_CONTRACT_INVALID. Runtime and Host still need separate disposal.

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

Loader, Adapter and Runtime are not aggregated by the root. Install directly imported dependencies explicitly. Runtime dependencies are capability, event-subscriber, lifecycle, plugin-host, rpc-contract, rpc-host, rpc-plugin-process, rpc-plugin-thread, rpc-plugin-coroutines, supervision, and utils. Cross-machine discovery, browser Worker integration, UI, durable messages, and automatic failover retry are outside these composition guarantees.

### RPC plugins on the original ordinary Host

Tray installs `processPlugin`, `threadPlugin`, or `coroutinePlugin` on its existing plugin-host Host. The plugin keeps the actual definition name and expose list; the Host's process/thread/coroutine outlet continues to address one named instance and use its original stop/restart/replace controls.

| Carrier   | Parent source                                                          | Child source                                                                                            |
| --------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| process   | `processPlugin({ spawn: { entry, supervision, wrap }, name, expose })` | `processPlugin({ connectToParent: true, name, expose })`                                                |
| thread    | `threadPlugin({ spawn: { entry, limits, supervisor }, name, expose })` | `threadPlugin({ connectToParent: true, name, expose })`                                                 |
| coroutine | `coroutinePlugin({ spawn: task, supervisor, name, expose })`           | `coroutinePlugin({ connectToParent: connect, name, expose })` with the task's genuine opaque connection |

The table shows option placement; optional fields may be omitted. Tray selects these from its existing Host definition and task context. Coroutine connectToParent is the actual callback token, not boolean true. Per-instance request/notify/stream remain targeted; Tray retains the original supervisor lifecycle owner.

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
