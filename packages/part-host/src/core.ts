import type { IIssue } from '@migaia/part-contract'
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { PartCatalog, type IContribution } from './catalog.ts'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { ScopeState } from './state.ts'
import type {
  IPartHost,
  IPartPlugin,
  IPartPluginSpec,
  IPartRendererFactory,
  IResolvedNode
} from './types.ts'

/** PH plugin name of the core plugin. */
export const PART_CORE_PLUGIN = 'part-core'

/** Single error channel of a host: each error object is reported once. */
export class Diagnostics {
  /** Errors already reported. */
  readonly #reported = new WeakSet<object>()
  /** Sink for reported errors; replaced by `createPartHost` with the caller's `onError`. */
  #sink: (error: unknown) => void = (error) => console.error(error)

  /** Installs the caller's sink. */
  setSink(sink: (error: unknown) => void): void {
    this.#sink = sink
  }

  /** Reports an error unless the same error object was already reported. */
  report(error: unknown): void {
    if (typeof error === 'object' && error !== null) {
      if (this.#reported.has(error)) return
      this.#reported.add(error)
    }
    this.#sink(error)
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
  /** Host bound by `createPartHost` right after the core plugin installs. */
  #host: IPartHost | undefined
  /** Scope state bound together with the host. */
  #state: ScopeState | undefined

  /** Binds the host and its state. */
  bind(host: IPartHost, state: ScopeState): void {
    this.#host = host
    this.#state = state
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
  })
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

/** Builds the contribution of one plugin generation from its spec and resolved outputs. */
function contributionOf(
  spec: IPartPluginSpec,
  deps: Readonly<Record<string, unknown>>
): IContribution {
  /** Resolved Feature outputs per effect id. */
  const effectFeatures = new Map<string, Readonly<Record<string, unknown>>>()
  ;(spec.effects ?? []).forEach((effect, position) => {
    /** Outputs keyed by the effect's own aliases. */
    const outputs: Record<string, unknown> = {}
    for (const alias of Object.keys(effect.deps))
      outputs[alias] = deps[effectAlias(position, alias)]
    effectFeatures.set(effect.descriptor.id, outputs)
  })
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
      ...Object.values(spec.resources ?? {})
    ],
    implementations: spec.implementations ?? [],
    rules: spec.rules ?? [],
    kinds: spec.kinds ?? {},
    effectFeatures
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
  /** Feature that resolves dependencies and builds this generation's contribution. */
  const registration = defineFeature(
    (_core, deps: Readonly<Record<string, unknown>>) => ({
      catalog: deps.catalog as PartCatalog,
      contribution: contributionOf(spec, deps)
    }),
    dependencies as never
  )
  /** Resource Features exposed under their declared names. */
  const resourceFeatures: Record<string, unknown> = {}
  for (const [name, resource] of Object.entries(spec.resources ?? {}))
    resourceFeatures[name] = resource.feature
  return definePlugin({
    name: spec.name,
    features: { ...spec.features, ...resourceFeatures, partRegistration: registration } as never,
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
