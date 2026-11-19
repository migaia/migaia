import type { IIssue, IPartFacets, ITraceEvent, ITraceStep } from '@migaia/part-contract'
import { createTraceSink } from '#trace'
import type { BlueprintStore } from './blueprints.ts'
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { PartCatalog, type IContribution } from './catalog.ts'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import { ModelHandle } from './models.ts'
import { ResourceStore } from './resources.ts'
import type { ScopeState } from './state.ts'
import type { ITraceSink } from './trace/sink.ts'
import type {
  IDiagnosticInfo,
  IIsolatedRunner,
  IPartHost,
  IPartPlugin,
  IPartPluginSpec,
  IPartRendererFactory,
  IResolvedNode
} from './types.ts'

/** PH plugin name of the core plugin. */
export const PART_CORE_PLUGIN = 'part-core'

/** Address carried on an error object, when a thrower attached one. */
function addressOnError(error: unknown): string | undefined {
  /** Candidate property. */
  const address = (error as { readonly address?: unknown } | null | undefined)?.address
  return typeof address === 'string' ? address : undefined
}

/**
 * Single error channel of a host: each error object is reported once. Every report carries the host
 * context set with `setContext` and the address of the failing node, without changing the error
 * object.
 */
export class Diagnostics {
  /** Errors already reported. */
  readonly #reported = new WeakSet<object>()
  /** Sink for reported errors; replaced by `createPartHost` with the caller's `onError`. */
  #sink: (error: unknown, info: IDiagnosticInfo) => void = (error) => console.error(error)
  /** Host context attached to every later report (for example version and snapshot hash). */
  #context: Readonly<Record<string, string>> = {}

  /** Installs the caller's sink. */
  setSink(sink: (error: unknown, info: IDiagnosticInfo) => void): void {
    this.#sink = sink
  }

  /** Replaces the context attached to later reports. */
  setContext(context: Readonly<Record<string, string>>): void {
    this.#context = { ...context }
  }

  /**
   * Reports an error unless the same error object was already reported. `address` names the node
   * that failed when the caller knows it; otherwise an `address` property on the error is used.
   */
  report(error: unknown, address?: string): void {
    if (typeof error === 'object' && error !== null) {
      if (this.#reported.has(error)) return
      this.#reported.add(error)
    }
    /** Address of the failure, if known. */
    const at = address ?? addressOnError(error)
    this.#sink(
      error,
      at === undefined ? { context: this.#context } : { address: at, context: this.#context }
    )
  }
}

/** Holds the isolated runner of a host; private state survives the freezing of Feature outputs. */
export class IsolationSlot {
  /** Registered runner, if any. */
  #runner: IIsolatedRunner | undefined

  /** Replaces the runner; `undefined` clears it. */
  set(runner: IIsolatedRunner | undefined): void {
    this.#runner = runner
  }

  /** Current runner. */
  get(): IIsolatedRunner | undefined {
    return this.#runner
  }
}

/** Render slot of a host: at most one renderer factory, replaced only by the same plugin name. */
export class RenderSlot {
  /** Current factory and its owning plugin. */
  #current: { readonly plugin: string; readonly factory: IPartRendererFactory } | undefined

  /** Registers a factory for a plugin; another plugin name is RENDERER_DUPLICATE. */
  provide(plugin: string, factory: IPartRendererFactory): void {
    if (this.#current !== undefined && this.#current.plugin !== plugin)
      throw createPartHostError(
        PartHostErrorCode.rendererDuplicate,
        PartHostErrorText.rendererDuplicate(this.#current.plugin)
      )
    this.#current = { plugin, factory }
  }

  /** Withdraws a factory if it is still the current one. */
  withdraw(factory: IPartRendererFactory): void {
    if (this.#current?.factory === factory) this.#current = undefined
  }

  /** Current factory or RENDERER_MISSING. */
  require(): IPartRendererFactory {
    if (this.#current === undefined)
      throw createPartHostError(
        PartHostErrorCode.rendererMissing,
        PartHostErrorText.rendererMissing
      )
    return this.#current.factory
  }
}

/** Per-host core state created when the core plugin installs; the host binds itself afterwards. */
export class CoreRuntime {
  /** Host catalog. */
  readonly catalog = new PartCatalog()
  /** Host error channel. */
  readonly diagnostics = new Diagnostics()
  /** Host render slot. */
  readonly renderSlot = new RenderSlot()
  /** Host resource store; reads state lazily, so it exists before the host binds. */
  readonly resources = new ResourceStore({
    runtime: () => this.state().runtime,
    resource: (id) => this.catalog.resource(id),
    readState: (path) => this.state().read(path),
    derived: (id) => this.state().derived(id),
    report: (error) => this.diagnostics.report(error)
  })
  /** Host model validation surface. */
  readonly models = new ModelHandle((id) => this.catalog.get(id))
  /** Isolated runner slot; a plugin fills it, isolated effects are refused while it is empty. */
  readonly isolation = new IsolationSlot()
  /** Development trace recorder, or the no-op sink in production builds. */
  readonly trace: ITraceSink = createTraceSink()

  /** Subscribes the resource store to generation changes of resource definitions. */
  constructor() {
    this.catalog.subscribeResources((ids) => this.resources.changed(ids))
  }
  /** Host bound by `createPartHost` right after the core plugin installs. */
  #host: IPartHost | undefined
  /** Scope state bound together with the host. */
  #state: ScopeState | undefined
  /** Blueprint store bound together with the host, read by the trace Feature. */
  #store: BlueprintStore | undefined

  /** Binds the host, its state and its blueprint store. */
  bind(host: IPartHost, state: ScopeState, store: BlueprintStore): void {
    this.#host = host
    this.#state = state
    this.#store = store
  }

  /** Bound blueprint store. */
  store(): BlueprintStore {
    return this.#store as BlueprintStore
  }

  /** Bound host; plugins install only after binding. */
  host(): IPartHost {
    return this.#host as IPartHost
  }

  /** Bound state. */
  state(): ScopeState {
    return this.#state as ScopeState
  }
}

/** State surface other plugins receive; it reads the host state bound at creation. */
class StateFeature {
  /** Core runtime of the host. */
  readonly #core: CoreRuntime

  /** Wraps the core runtime. */
  constructor(core: CoreRuntime) {
    this.#core = core
  }

  /** Reactive runtime of the host. */
  get runtime(): ScopeState['runtime'] {
    return this.#core.state().runtime
  }

  /** Tracked read of a path. */
  read(path: string): unknown {
    return this.#core.state().read(path)
  }

  /** Write of a path. */
  write(path: string, value: unknown): void {
    this.#core.state().write(path, value)
  }

  /** Writes a path only when it was never written. */
  seed(path: string, value: unknown): void {
    this.#core.state().seed(path, value)
  }

  /** Resolves a facet value of a node; `row` feeds `$row` bindings of template-row instances. */
  resolve(node: IResolvedNode, value: unknown, row?: Readonly<Record<string, unknown>>): unknown {
    return this.#core.state().resolve(node, value, row)
  }
}

/** Effect surface other plugins receive. */
class EffectFeature {
  /** Core runtime of the host. */
  readonly #core: CoreRuntime

  /** Wraps the core runtime. */
  constructor(core: CoreRuntime) {
    this.#core = core
  }

  /** Dispatches an event of an address to its subscription. */
  dispatch(address: string, event: string, detail: unknown): Promise<void> {
    return this.#core.host().dispatch(address, event, detail)
  }

  /**
   * Registers the runner for `isolated` effects (or clears it with `undefined`). Runs already
   * started keep the runner they started with.
   */
  setIsolatedRunner(runner: IIsolatedRunner | undefined): void {
    this.#core.isolation.set(runner)
  }
}

/** Blueprint surface other plugins receive. */
class BlueprintFeature {
  /** Core runtime of the host. */
  readonly #core: CoreRuntime

  /** Wraps the core runtime. */
  constructor(core: CoreRuntime) {
    this.#core = core
  }

  /** Loads a blueprint through the host. */
  load(input: unknown): Promise<{ readonly issues: readonly IIssue[] }> {
    return this.#core.host().blueprint.load(input)
  }
}

/**
 * Development trace surface: enhancement steps and runtime events per address (derive
 * recomputations under `$derive:<id>`), loaded addresses and resolved configuration. Without the
 * `development` condition every read is empty and `subscribe` registers nothing.
 */
class TraceFeature {
  /** Core runtime of the host. */
  readonly #core: CoreRuntime

  /** Wraps the core runtime. */
  constructor(core: CoreRuntime) {
    this.#core = core
  }

  /** Enhancement steps of an address, oldest first. */
  steps(address: string): readonly ITraceStep[] {
    return this.#core.trace.steps(address)
  }

  /** Runtime events of an address or `$derive:<id>` key, oldest first. */
  events(key: string): readonly ITraceEvent[] {
    return this.#core.trace.events(key)
  }

  /** Every address of the loaded blueprints, in load and document order. */
  addresses(): readonly string[] {
    return this.#core.trace.enabled ? this.#core.store().addresses() : []
  }

  /** Resolved configuration of an address, or undefined. */
  resolved(address: string): IPartFacets | undefined {
    return this.#core.trace.enabled ? this.#core.store().resolved(address) : undefined
  }

  /** Listens for new records; the removal may be called more than once. */
  subscribe(listener: (key: string) => void): () => void {
    return this.#core.trace.subscribe(listener)
  }
}

/** Root Feature creating the per-host core runtime. */
const runtimeFeature = defineFeature(() => new CoreRuntime())

/** Features of the core plugin; every output is derived from the same core runtime. */
const coreFeatures = {
  runtime: runtimeFeature,
  catalog: defineFeature((_core, deps) => deps.runtime.catalog, { runtime: runtimeFeature }),
  diagnostics: defineFeature((_core, deps) => deps.runtime.diagnostics, {
    runtime: runtimeFeature
  }),
  renderSlot: defineFeature((_core, deps) => deps.runtime.renderSlot, { runtime: runtimeFeature }),
  state: defineFeature((_core, deps) => new StateFeature(deps.runtime), {
    runtime: runtimeFeature
  }),
  trace: defineFeature((_core, deps) => new TraceFeature(deps.runtime), {
    runtime: runtimeFeature
  }),
  effect: defineFeature((_core, deps) => new EffectFeature(deps.runtime), {
    runtime: runtimeFeature
  }),
  blueprint: defineFeature((_core, deps) => new BlueprintFeature(deps.runtime), {
    runtime: runtimeFeature
  }),
  enhance: defineFeature(
    (_core, deps) => ({ enhancersFor: (tag: string) => deps.runtime.catalog.enhancersFor(tag) }),
    {
      runtime: runtimeFeature
    }
  ),
  derive: defineFeature(
    (_core, deps) => ({ value: (id: string) => deps.runtime.state().derived(id) }),
    {
      runtime: runtimeFeature
    }
  ),
  style: defineFeature((_core, deps) => ({ catalog: deps.runtime.catalog }), {
    runtime: runtimeFeature
  }),
  resources: defineFeature((_core, deps) => deps.runtime.resources, { runtime: runtimeFeature }),
  models: defineFeature((_core, deps) => deps.runtime.models, { runtime: runtimeFeature })
}

/** Names of the Features the core plugin provides. */
export type IPartCoreFeatureName = keyof typeof coreFeatures

/** Public view of the core plugin: its name and Feature references for other plugins' dependencies. */
export type IPartCorePlugin = IPartPlugin & { getFeature(name: IPartCoreFeatureName): unknown }

/** Core plugin every part host installs first; other plugins reference its Features by name. */
export const partCorePlugin: IPartCorePlugin = definePlugin({
  name: PART_CORE_PLUGIN,
  features: coreFeatures,
  install: () => ({})
}) as unknown as IPartCorePlugin

/** The part of a registration lifetime signal this package uses. */
type IAbortSignalLike = {
  addEventListener(type: 'abort', listener: () => void, options: { readonly once: true }): void
}

/** Dependency alias of one effect dependency inside the registration Feature. */
function effectAlias(effect: number, alias: string): string {
  return `effect${effect}_${alias}`
}

/** Dependency alias of one resource dependency inside the registration Feature. */
function resourceAlias(resource: number, alias: string): string {
  return `resource${resource}_${alias}`
}

/** Resolved dependency outputs of each definition, keyed by descriptor id. */
function resolvedOutputs(
  definitions: readonly { readonly descriptor: { readonly id: string }; readonly deps: object }[],
  deps: Readonly<Record<string, unknown>>,
  aliasOf: (position: number, alias: string) => string
): Map<string, Readonly<Record<string, unknown>>> {
  /** Outputs per definition id. */
  const resolved = new Map<string, Readonly<Record<string, unknown>>>()
  definitions.forEach((definition, position) => {
    /** Outputs keyed by the definition's own aliases. */
    const outputs: Record<string, unknown> = {}
    for (const alias of Object.keys(definition.deps))
      outputs[alias] = deps[aliasOf(position, alias)]
    resolved.set(definition.descriptor.id, outputs)
  })
  return resolved
}

/** Builds the contribution of one plugin generation from its spec and resolved outputs. */
function contributionOf(
  spec: IPartPluginSpec,
  deps: Readonly<Record<string, unknown>>
): IContribution {
  return {
    plugin: spec.name,
    token: {},
    override: new Set(spec.override ?? []),
    definitions: [
      ...(spec.parts ?? []),
      ...(spec.enhancers ?? []),
      ...(spec.derives ?? []),
      ...(spec.effects ?? []),
      ...(spec.modifiers ?? []),
      ...(spec.fragments ?? []),
      ...(spec.resources ?? []),
      ...(spec.models ?? [])
    ],
    implementations: spec.implementations ?? [],
    rules: spec.rules ?? [],
    kinds: spec.kinds ?? {},
    effectFeatures: resolvedOutputs(spec.effects ?? [], deps, effectAlias),
    resourceFeatures: resolvedOutputs(spec.resources ?? [], deps, resourceAlias)
  }
}

/**
 * Defines a part plugin. Installing it registers its contributions in the host catalog for exactly
 * this generation; releasing the generation withdraws them.
 */
export function definePartPlugin(spec: IPartPluginSpec): IPartPlugin {
  /** Dependencies of the registration Feature: the core catalog plus every effect dependency. */
  const dependencies: Record<string, unknown> = { catalog: partCorePlugin.getFeature('catalog') }
  ;(spec.effects ?? []).forEach((effect, position) => {
    for (const [alias, reference] of Object.entries(effect.deps))
      dependencies[effectAlias(position, alias)] = reference
  })
  ;(spec.resources ?? []).forEach((resource, position) => {
    for (const [alias, reference] of Object.entries(resource.deps))
      dependencies[resourceAlias(position, alias)] = reference
  })
  /** Feature that resolves dependencies and builds this generation's contribution. */
  const registration = defineFeature(
    (_core, deps: Readonly<Record<string, unknown>>) => ({
      catalog: deps.catalog as PartCatalog,
      contribution: contributionOf(spec, deps)
    }),
    dependencies as never
  )
  return definePlugin({
    name: spec.name,
    features: { ...spec.features, partRegistration: registration } as never,
    install: (core: {
      readonly features: Record<string, unknown>
      readonly lifecycle: { readonly signal: IAbortSignalLike }
    }) => {
      /** Registration output of this generation. */
      const output = core.features.partRegistration as {
        readonly catalog: PartCatalog
        readonly contribution: IContribution
      }
      output.catalog.register(output.contribution)
      core.lifecycle.signal.addEventListener(
        'abort',
        () => output.catalog.withdraw(spec.name, output.contribution.token),
        { once: true }
      )
      spec.onInstall?.(core.features, core.lifecycle.signal)
      return {}
    }
  }) as unknown as IPartPlugin
}
