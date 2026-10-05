import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginDisposer,
  IPluginHostCore
} from './typing.js'
import type {
  IAbortController,
  IGenerationRequest,
  ILifecycleScope,
  IProvisionalScope
} from '@migaia/lifecycle'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IStageEntry, IStageOwnerSegment } from './stage-lanes.js'
import type { IPluginSetupAttempt } from './setup-runtime.js'

export type IPluginDefinition<TCore> = {
  readonly owner: IPluginConstraint<TCore>
  readonly name: string
  readonly config: IPluginConfig
  readonly install: IPluginConstraint<TCore>['install']
  /** Captured preparation hook; absent on the one-argument installation path. */
  readonly setup?: (context: import('./typing.js').IPluginSetupContext) => unknown
  readonly update?: IPluginConstraint<TCore>['update']
  readonly onEnable?: IPluginConstraint<TCore>['onEnable']
  readonly onDisable?: IPluginConstraint<TCore>['onDisable']
  readonly onDependencyReplaced?: IPluginConstraint<TCore>['onDependencyReplaced']
  readonly activation: 'eager' | 'lazy'
  readonly dispose?: IPluginConstraint<TCore>['dispose']
  /** Captured release hook; never re-read from a mutable owner object. */
  readonly beforeRelease?: IPluginConstraint<TCore>['beforeRelease']
  /** Symbol disposer captured with the plugin admission snapshot; never re-probe owner at cleanup. */
  readonly disposer?: IPluginDisposer
  readonly features: Readonly<Record<string, object>>
  readonly featureExpose?: object | ((core: TCore) => object)
  /** New function-form definitions create this descriptor once for each registration. */
  readonly descriptorFactory?: (core: TCore) => IPluginDescriptor
}

/** Registration-local hooks returned by the synchronous descriptor factory. */
export type IPluginDescriptor<
  TExtension extends Record<string, unknown> = Record<string, never>,
  TPublic extends object = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TLegacyShared extends object = Record<never, never>
> = Readonly<{
  readonly install?: () => TExtension | PromiseLike<TExtension>
  readonly expose?: () => TPublic & (TPublic extends PromiseLike<unknown> ? never : unknown)
  readonly featureExpose?: () => TExpose & (TExpose extends PromiseLike<unknown> ? never : unknown)
}> &
  (TLegacyShared extends object ? unknown : never)

export type IRegistration<TDomainCore extends object, TValue> = {
  readonly name: string
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  config: IPluginConfig
  extensions: IExtensionOwnership[]
  /** Candidate and committed shared receipts belong to this exact registration generation. */
  sharedContributions?: ISharedExtensionContribution<TDomainCore, TValue>[]
  /** Original registration reservations retain a facade while native generations rebind. */
  sharedSlots?: ISharedExtensionReservation<TDomainCore, TValue>[]
  pipelineDisposers: IPluginDisposer[]
  /** Stages registered by this exact generation, not keyed by function identity. */
  stageEntries: IStageEntry<TValue>[]
  /** Stable name slot shared by committed generations, if this owner registered a stage. */
  segment?: IStageOwnerSegment
  /** Exact generation lease key; replacement generations never share a physical drain fence. */
  readonly pipelineOwnerKey: object
  /** Captured resource/disposer pairs used by composition's strict physical cleanup chain. */
  resourceDisposers: Array<
    Readonly<{ readonly resource: unknown; readonly dispose: IPluginDisposer }>
  >
  installed: boolean
  /** Prevents a published registration from running its release hook twice. */
  beforeReleaseRan?: boolean
  /** Orthogonal reachability state; disabling never changes lifecycle or releases resources. */
  enabled: boolean
  /** Whether a missing or unavailable required provider has temporarily gated this registration. */
  suspended: boolean
  /**
   * Set while suspended when a provider this registration bound to changed generation (replace
   * restart) before recovery; its retained instance is stale, so recovery must reinstall it instead
   * of resuming or rebinding it.
   */
  stale: boolean
  lifecycle: (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle]
  lifecycleController?: IAbortController
  operation?: IGenerationRequest
  /** Output owned by this registration's current setup attempt. */
  setupOutput?: unknown
  /** Attempt lifetime retained by setup contexts after this registration settles. */
  setupAttempt?: IPluginSetupAttempt
  operationDeadlineAt?: number
  provisional?: IProvisionalScope
  scope?: ILifecycleScope
  core?: TDomainCore & IPluginHostCore<TValue>
  featureOutputs?: Readonly<Record<string, object>>
  featureExpose?: object
  featureExposeValid?: boolean
  featurePending?: import('@migaia/lifecycle').IPendingTracker
  /** Whether lazy/eager installation has completed for this registration. */
  activated: boolean
  /** Shared activation Promise returned to concurrent callers. */
  activationPromise?: Promise<void>
  /** Captured function-form descriptor; it is never shared across registrations. */
  descriptor?: IPluginDescriptor
}

type IExtensionOwnership = {
  readonly key: PropertyKey
  readonly descriptor: PropertyDescriptor
}

/** Shared publication extends the existing extension owner rather than creating another registry. */
export type ISharedExtensionSlot<TDomainCore extends object, TValue> = {
  readonly key: PropertyKey
  readonly family: object
  facade: object
  /** Final contribution removal retires this facade permanently. */
  retired: boolean
  /** Ready physical sessions and live registrations remain separate canonical membership facts. */
  readonly contributions: Set<ISharedExtensionContribution<TDomainCore, TValue>>
  readonly registrations: Map<
    IRegistration<TDomainCore, TValue>,
    ISharedExtensionReservation<TDomainCore, TValue>
  >
  readonly names: Map<string, ISharedExtensionBucket<TDomainCore, TValue>>
  readonly instanceIds: Map<string, ISharedExtensionBucket<TDomainCore, TValue>>
}

/** One original reservation owns its cold metadata across ready receipt withdrawal and rebind. */
export type ISharedExtensionReservation<TDomainCore extends object, TValue> = {
  readonly slot: ISharedExtensionSlot<TDomainCore, TValue>
  value?: object
  /** Native adapters publish initial readiness only after this original reservation commits. */
  onCommit?: () => void
}

/** The canonical bucket caches its sole receipt so hot lookup never allocates an iterator. */
export type ISharedExtensionBucket<TDomainCore extends object, TValue> = {
  readonly members: Set<ISharedExtensionContribution<TDomainCore, TValue>>
  single: ISharedExtensionContribution<TDomainCore, TValue> | undefined
}

/** Revocation compares the receipt itself so late cleanup cannot touch a successor registration. */
export type ISharedExtensionContribution<TDomainCore extends object, TValue> = Readonly<{
  slot: ISharedExtensionSlot<TDomainCore, TValue>
  registration: IRegistration<TDomainCore, TValue>
  instanceId: string
  value: object
}>

/** Ordinary exclusive slots retain their original registration owner. */
export type IExtensionOwner<TDomainCore extends object, TValue> =
  | IRegistration<TDomainCore, TValue>
  | ISharedExtensionSlot<TDomainCore, TValue>

export type IInstallEntry<TDomainCore extends object, TValue> = {
  readonly plugin: IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
  readonly name: string
  /**
   * Host-owned runtime config carried over when a registration is re-instantiated (replace
   * restart). Absent for first installs, which start from the definition's `config`.
   */
  readonly config?: IPluginConfig
}
