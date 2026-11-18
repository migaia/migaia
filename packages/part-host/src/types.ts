import type {
  IBehavior,
  IDescriptor,
  IIssue,
  IJsonPatchOperation,
  IKindSchema,
  IPartFacets,
  IPartNode,
  IRuleDefinition,
  IStandardSchemaInput
} from '@migaia/part-contract'
import type {
  IFeatureRecord,
  IPluginDependencyMutationOptions,
  IPluginHostDisposalResult,
  IPluginRemoval
} from '@migaia/plugin-host'
import type { IRuntime } from '@migaia/reactive'

/** A definition registered in the catalog: its descriptor plus the runtime payload of its kind. */
export type IDefinition = { readonly descriptor: IDescriptor }

/** Part definition; `TProps` is the props type the part accepts. */
export type IPartDefinition<TProps> = IDefinition & { readonly __props?: TProps }

/** Enhancer: a pure configuration transform for the tags it targets. */
export type IEnhancerDefinition<TArgs> = IDefinition & {
  readonly transform: (config: IPartFacets, context: IEnhancerContext<TArgs>) => IPartFacets
}

/** What an enhancer receives besides the configuration. */
export type IEnhancerContext<TArgs> = {
  readonly address: string
  readonly node: IPartNode
  readonly args: TArgs | undefined
}

/** Read-only state view handed to derive computations. */
export type IDeriveStateView = {
  read(path: string): unknown
  write(path: string, value: unknown): never
}

/** Derive: a pure computation over state paths. */
export type IDeriveDefinition<TArgs, TOut> = IDefinition & {
  readonly compute: (state: IDeriveStateView, args: TArgs | undefined) => TOut
}

/** Context an effect run receives: resolved Feature outputs, state access and queued dispatch. */
export type IEffectContext<TDeps> = {
  readonly features: TDeps
  readonly state: { read(path: string): unknown; write(path: string, value: unknown): void }
  dispatch(address: string, event: string, detail: unknown): void
}

/** Effect: ordered side effects run for event subscriptions. */
export type IEffectDefinition = IDefinition & {
  readonly deps: IFeatureRecordLike
  readonly sync: boolean
  readonly run: (
    event: IEffectEvent,
    context: IEffectContext<Readonly<Record<string, unknown>>>
  ) => unknown
}

/** Event delivered to an effect. */
export type IEffectEvent = {
  readonly address: string
  readonly name: string
  readonly detail: unknown
}

/** Feature reference map accepted as effect dependencies. */
export type IFeatureRecordLike = Readonly<Record<string, unknown>>

/** Resource: a PH Feature with parameter, result and command schemas plus its descriptor. */
export type IResourceDefinition = IDefinition & { readonly feature: unknown }

/** Renderer implementation entry stored opaquely by the catalog. */
export type IPartImplementation = {
  readonly renderer: string
  readonly partId: string
  readonly value: unknown
}

/** Specification of a part plugin. */
export type IPartPluginSpec = {
  readonly name: string
  readonly parts?: readonly IPartDefinition<unknown>[]
  readonly enhancers?: readonly IEnhancerDefinition<never>[]
  readonly derives?: readonly IDeriveDefinition<never, unknown>[]
  readonly effects?: readonly IEffectDefinition[]
  readonly resources?: Readonly<Record<string, IResourceDefinition>>
  readonly rules?: readonly IRuleDefinition<unknown>[]
  readonly kinds?: Readonly<Record<string, IKindSchema>>
  readonly implementations?: readonly IPartImplementation[]
  readonly override?: readonly string[]
  readonly features?: IFeatureRecord
}

/** One resolved style rule for an address. */
export type IStyleRule = {
  readonly address: string
  readonly layer: 'tokens' | 'parts' | 'blueprint' | 'local'
  readonly declarations: Readonly<Record<string, string>>
}

/** A node after enhancement, ready for a renderer. */
export type IResolvedNode = {
  readonly address: string
  readonly definition: IPartDefinition<unknown>
  readonly behavior: IBehavior
  readonly config: IPartFacets
  readonly derivedAria: Readonly<Record<string, string>>
  readonly tabIndex?: 0 | -1
  readonly openStatePath?: string
  readonly styleRules: readonly IStyleRule[]
  readonly children: readonly IResolvedNode[]
  readonly slots: Readonly<Record<string, readonly IResolvedNode[]>>
}

/** Resolved blueprint tree. */
export type IResolvedTree = { readonly blueprintId: string; readonly root: IResolvedNode }

/** Change set delivered to renderer mounts after a patch or re-enhancement. */
export type IResolvedChanges = {
  readonly blueprintId: string
  readonly tree: IResolvedTree
  readonly changed: readonly IResolvedNode[]
  readonly removed: readonly string[]
}

/** Result of `load` and `patch`. */
export type ILoadResult = {
  readonly blueprintId: string
  readonly tree: IResolvedTree | undefined
  readonly issues: readonly IIssue[]
}

/** Scope state of a host. Paths are `page.*`, `section.*` or `part.*`. */
export type IScopeState = {
  readonly runtime: IRuntime
  read(path: string): unknown
  write(path: string, value: unknown): void
  resolve(node: IResolvedNode, value: unknown): unknown
}

/** Catalog surface of a host. */
export type ICatalog = {
  get(id: string): IDefinition | undefined
  byTag(tag: string): readonly IDefinition[]
  implementation(renderer: string, partId: string): unknown
  manifest(): readonly string[]
}

/** Renderer mount created per `host.mount` call. */
export type IRendererMount = { update(changes: IResolvedChanges): void; unmount(): void }

/** Renderer factory registered into the render slot. */
export type IPartRendererFactory = {
  create(target: unknown, tree: IResolvedTree, host: IPartHost): IRendererMount
}

/** Handle of one mount. */
export type IMountHandle = { unmount(): void }

/** Plugin produced by `definePartPlugin`; opaque PH plugin definition. */
export type IPartPlugin = { readonly name: string }

/** Options of `createPartHost`. */
export type IPartHostOptions = {
  readonly plugins?: readonly IPartPlugin[]
  readonly runtime?: IRuntime
  readonly onError?: (error: unknown) => void
  readonly disposeTimeoutMs?: number
}

/** Part host surface. */
export type IPartHost = {
  readonly blueprint: {
    load(input: unknown): Promise<ILoadResult>
    patch(blueprintId: string, operations: readonly IJsonPatchOperation[]): Promise<ILoadResult>
  }
  readonly catalog: ICatalog
  readonly state: IScopeState
  mount(target: unknown, blueprintId: string): IMountHandle
  dispatch(address: string, event: string, detail: unknown): Promise<void>
  use(plugin: IPartPlugin): Promise<void>
  unUse(name: string, options?: IPluginDependencyMutationOptions): Promise<IPluginRemoval>
  replace(name: string, next: IPartPlugin): Promise<void>
  dispose(): Promise<IPluginHostDisposalResult>
}

/** Schema input re-exported for definition specs. */
export type ISchemaInput = IStandardSchemaInput
