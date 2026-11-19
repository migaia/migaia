import {
  defineHost,
  type IPluginDependencyMutationOptions,
  type IPluginHostDisposalResult,
  type IPluginRemoval
} from '@migaia/plugin-host'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { featuresModule } from '@migaia/plugin-host/features'
import { eventNameOf, formatAddress, parseAddress } from '@migaia/part-contract'
import { createRuntime } from '@migaia/reactive'
import { BlueprintStore } from './blueprints.ts'
import { CoreRuntime, partCorePlugin } from './core.ts'
import { EffectRunner } from './effects.ts'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import { ScopeState } from './state.ts'
import type {
  ICatalog,
  IDeriveDefinition,
  IModelHandle,
  IMountHandle,
  IPartHost,
  IPartHostOptions,
  IPartPlugin,
  IRendererMount,
  IResolvedChanges,
  IResourceHandle,
  IScopeState
} from './types.ts'

/** Default upper bound for in-flight effects to settle during dispose. */
const DEFAULT_DISPOSE_TIMEOUT_MS = 5000
/** Execution limits of the underlying plugin host. */
const EXECUTION = { mutationTimeoutMs: 30000, pipelineDrainTimeoutMs: 30000 }

/** Minimal plugin-host surface this package drives. */
type IPluginHostLike = {
  use(plugin: unknown): Promise<readonly { getFeature(name: string): unknown }[]>
  unUse(name: string, options?: IPluginDependencyMutationOptions): Promise<IPluginRemoval>
  replace(name: string, next: unknown): Promise<unknown>
  dispose(): Promise<IPluginHostDisposalResult>
}

/** One mount registered on a blueprint. */
class MountHandle implements IMountHandle {
  /** Renderer mount. */
  readonly #mount: IRendererMount
  /** Removes the mount from the host registry. */
  readonly #release: (mount: IRendererMount) => void
  /** Whether unmount already ran. */
  #done = false

  /** Captures the mount and its release callback. */
  constructor(mount: IRendererMount, release: (mount: IRendererMount) => void) {
    this.#mount = mount
    this.#release = release
  }

  /** Unmounts once. */
  unmount(): void {
    if (this.#done) return
    this.#done = true
    this.#release(this.#mount)
    this.#mount.unmount()
  }
}

/** Part host implementation over one plugin host. */
class PartHost implements IPartHost {
  /** Blueprint surface. */
  readonly blueprint: IPartHost['blueprint']
  /** Plugin host owning every registration. */
  readonly #plugins: IPluginHostLike
  /** Core runtime of the core plugin. */
  readonly #core: CoreRuntime
  /** Scope state. */
  readonly #state: ScopeState
  /** Blueprint processing. */
  readonly #store: BlueprintStore
  /** Effect queues. */
  readonly #effects: EffectRunner
  /** Mounts by blueprint id. */
  readonly #mounts = new Map<string, Set<IRendererMount>>()
  /** Serial queue of load, patch and plugin changes. */
  #queue: Promise<unknown> = Promise.resolve()
  /** Cached dispose result. */
  #disposal: Promise<IPluginHostDisposalResult> | undefined
  /** Effect drain bound for dispose. */
  readonly #disposeTimeoutMs: number

  /** Wires state, store and effects around the installed core runtime. */
  constructor(plugins: IPluginHostLike, core: CoreRuntime, options: IPartHostOptions) {
    this.#plugins = plugins
    this.#core = core
    this.#disposeTimeoutMs = options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS
    this.#state = new ScopeState(options.runtime ?? createRuntime(), (id) => this.#deriveOf(id))
    this.#store = new BlueprintStore(core.catalog, this.#state, (changes) => this.#deliver(changes))
    this.#effects = new EffectRunner({
      lookup: (id) => core.catalog.effect(id),
      read: (path) => this.#state.read(path),
      write: (path, value) => this.#state.write(path, value),
      enqueue: (address, event, detail) =>
        void this.dispatch(address, event, detail).catch(() => undefined),
      report: (error) => core.diagnostics.report(error),
      resources: core.resources,
      models: core.models
    })
    this.blueprint = {
      load: (input) => this.#serial(() => this.#store.load(input)),
      patch: (id, operations) => this.#serial(() => this.#store.patch(id, operations))
    }
    if (options.onError !== undefined) core.diagnostics.setSink(options.onError)
    core.bind(this, this.#state)
    core.catalog.subscribe((tags) => this.#refresh(tags))
  }

  /** Catalog surface. */
  get catalog(): ICatalog {
    return this.#core.catalog
  }

  /** Scope state surface. */
  get state(): IScopeState {
    return this.#state
  }

  /** Resource surface; the same object effects and renderers receive. */
  get resources(): IResourceHandle {
    return this.#core.resources
  }

  /** Model validation surface. */
  get models(): IModelHandle {
    return this.#core.models
  }

  /** Mounts the latest tree of a blueprint through the render slot. */
  mount(target: unknown, blueprintId: string): IMountHandle {
    this.#assertOpen()
    /** Renderer factory. */
    const factory = this.#core.renderSlot.require()
    /** Latest tree; mounting needs a loaded blueprint without errors. */
    const tree = this.#store.tree(blueprintId)
    if (tree === undefined)
      throw createPartHostError(
        PartHostErrorCode.blueprintUnknown,
        PartHostErrorText.blueprintUnknown(blueprintId)
      )
    /** New renderer mount. */
    const mount = factory.create(target, tree, this)
    /** Mount set of the blueprint. */
    const set = this.#mounts.get(blueprintId) ?? new Set<IRendererMount>()
    set.add(mount)
    this.#mounts.set(blueprintId, set)
    return new MountHandle(mount, (released) => set.delete(released))
  }

  /**
   * Dispatches an event to the subscription of an address. A template-row instance address
   * (`…@row:<key>`) uses the subscription of its static node and passes the row key to the effect.
   */
  async dispatch(address: string, event: string, detail: unknown): Promise<void> {
    this.#assertOpen()
    /** Static address plus the row key of a template-row instance address. */
    const { segments, rowKey } = parseAddress(address)
    /** Subscription of the event on the static node, if any. */
    const subscription = this.#store.node(formatAddress({ segments }))?.facets?.events?.[event]
    if (subscription === undefined || !matchesFilter(subscription.filter, detail)) return
    await this.#effects.run(subscription.handler, {
      address,
      name: eventNameOf(event),
      key: event,
      detail,
      ...(rowKey === undefined ? {} : { rowKey })
    })
  }

  /** Installs a plugin. */
  async use(plugin: IPartPlugin): Promise<void> {
    this.#assertOpen()
    await this.#plugins.use(plugin)
  }

  /** Removes a plugin; suspended dependents' catalog entries become unavailable. */
  async unUse(name: string, options?: IPluginDependencyMutationOptions): Promise<IPluginRemoval> {
    /** PH removal result. */
    const result = await this.#plugins.unUse(name, options)
    /** Plugins the removal suspended. */
    const suspended = result.affected.steps
      .filter((step) => step.action === 'suspend')
      .map((step) => step.name)
    this.#core.catalog.setAvailable(suspended, false)
    if (!result.ok) for (const error of result.errors) this.#core.diagnostics.report(error)
    return result
  }

  /** Replaces a plugin with a new generation of the same name. */
  async replace(name: string, next: IPartPlugin): Promise<void> {
    this.#assertOpen()
    await this.#plugins.replace(name, next)
  }

  /** Disposes once: stop new work, drain effects, unmount, release state and plugins. */
  dispose(): Promise<IPluginHostDisposalResult> {
    this.#disposal ??= this.#dispose()
    return this.#disposal
  }

  /** Dispose body. */
  async #dispose(): Promise<IPluginHostDisposalResult> {
    await Promise.race([
      this.#effects.drain(),
      new Promise((resolve) => setTimeout(resolve, this.#disposeTimeoutMs))
    ])
    for (const set of this.#mounts.values()) for (const mount of set) mount.unmount()
    this.#mounts.clear()
    this.#core.resources.dispose()
    this.#state.dispose()
    /** Plugin host disposal result. */
    const result = await this.#plugins.dispose()
    for (const error of result.cleanupErrors) this.#core.diagnostics.report(error)
    return result
  }

  /** Throws HOST_DISPOSED after dispose started. */
  #assertOpen(): void {
    if (this.#disposal !== undefined)
      throw createPartHostError(PartHostErrorCode.hostDisposed, PartHostErrorText.hostDisposed)
  }

  /** Runs work after earlier queued work; failures reject only this call. */
  #serial<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.#disposal !== undefined)
      return Promise.reject(
        createPartHostError(PartHostErrorCode.hostDisposed, PartHostErrorText.hostDisposed)
      )
    /** This step. */
    const step = this.#queue.then(work)
    this.#queue = step.catch(() => undefined)
    return step
  }

  /** Re-enhances affected tags after a catalog change; failures go to diagnostics. */
  #refresh(tags: ReadonlySet<string>): void {
    if (this.#disposal !== undefined) return
    this.#serial(() => this.#store.refreshTags(tags)).catch((error: unknown) =>
      this.#core.diagnostics.report(error)
    )
  }

  /** Sends a change set to every mount of its blueprint. */
  #deliver(changes: IResolvedChanges): void {
    for (const mount of this.#mounts.get(changes.blueprintId) ?? []) mount.update(changes)
  }

  /** Derive definition by id. */
  #deriveOf(id: string): IDeriveDefinition<unknown, unknown> | undefined {
    /** Catalog definition. */
    const definition = this.#core.catalog.get(id)
    return definition?.descriptor.kind === 'derive'
      ? (definition as IDeriveDefinition<unknown, unknown>)
      : undefined
  }
}

/** True when a detail passes a subscription filter: `reason` lists or exact field values. */
function matchesFilter(
  filter: Readonly<Record<string, unknown>> | undefined,
  detail: unknown
): boolean {
  if (filter === undefined) return true
  /** Detail fields. */
  const fields = (typeof detail === 'object' && detail !== null ? detail : {}) as Record<
    string,
    unknown
  >
  for (const [key, expected] of Object.entries(filter)) {
    /** Accepted values. */
    const accepted = Array.isArray(expected) ? expected : [expected]
    if (!accepted.includes(fields[key])) return false
  }
  return true
}

/**
 * Creates a part host: installs the core plugin, binds the host to it, then installs the caller's
 * plugins in order. Hosts take no `features` option; Features come only from plugins.
 */
export async function createPartHost(options: IPartHostOptions = {}): Promise<IPartHost> {
  /** Plugin host with Feature dependencies enabled. */
  const plugins = defineHost({
    modules: [featuresModule, featureDependenciesModule],
    host: { execution: EXECUTION }
  }) as unknown as IPluginHostLike
  /** Core plugin handle. */
  const [coreHandle] = await plugins.use(partCorePlugin)
  /** Host bound to the core runtime. */
  const host = new PartHost(plugins, coreHandle?.getFeature('runtime') as CoreRuntime, options)
  for (const plugin of options.plugins ?? []) await host.use(plugin)
  return host
}
