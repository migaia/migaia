/**
 * Defines opaque composition capabilities and batch publication/cleanup results. Private runtime
 * provenance remains owned by composition.
 */
import type { IPluginHostPhysicalCleanupResult } from './plugin-lifecycle-types.js'
import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IExtractPluginExt } from './plugin-inference-types.js'
import type { IPluginHostConfigFor } from './plugin-handle-types.js'
import type { ICleanupResult } from '@migaia/lifecycle'

/** Opaque Host-owned ordering slot; callers may retain it but cannot inspect its ordinal. */
export type IPluginDataOrderSlot = Readonly<{ readonly __pluginDataOrderSlot: unique symbol }>

/** Opaque immutable admission snapshot produced by the PluginHost canonical factory. */
declare const pluginAdmissionBrand: unique symbol

export type IPluginAdmission<TPlugin extends IPluginConstraint<any>> = Readonly<{
  readonly [pluginAdmissionBrand]?: TPlugin
}>

/** One admission request for the composition integration boundary. */
export type IPluginAdmissionRequest = Readonly<{
  /** Opaque definition snapshot produced by the canonical admission factory. */
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
  /** Live ordering lane issued by the receiving Host for this same definition name. */
  readonly slot: IPluginDataOrderSlot
}>

/** Opaque prepared candidate admission owned by one concrete PluginHost. */
export type IPluginPreparedAdmissions = object

/** Canonical name for the opaque token accepted by composition publication. */
export type IRegistrationToken<TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>> =
  object & Readonly<{ readonly __plugin?: TPlugin }>

/** Narrow extension-only view for one live registration token. */
export type IRegistrationView<TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>> =
  Readonly<{
    /** Exact-generation guarded extensions; they never follow a same-name replacement. */
    readonly extensions: Readonly<IExtractPluginExt<TPlugin>>
  }>

/** Opaque exact registration batch prepared for logical removal. */
export type IPluginPreparedRemovalBatch = object

/** Canonical fence supplied by Graph before Host physical cleanup begins. */
export type IPluginBatchRemovalOptions = Readonly<{
  /**
   * Optional external lease fence; logical revocation precedes waiting, physical cleanup follows
   * it.
   */
  readonly beforeCleanup?: PromiseLike<void>
}>

/** Result of one prepared batch removal, preserving the Host dynamic-view contract. */
export type IPluginBatchRemovalLeaf = ICleanupResult &
  Readonly<{
    /** Exact registration generation revoked by this leaf. */
    readonly receipt: IRegistrationToken
    /** Registration name retained for correlating cleanup observations. */
    readonly name: string
    /** True only when this leaf has no cleanup errors or unsettled physical continuation. */
    readonly cleanupComplete: boolean
  }>

/** Aggregate result for one all-or-nothing prepared removal commit. */
export type IPluginBatchRemovalResult<TSnapshot> = ICleanupResult &
  Readonly<{
    /** True when the committed batch has no cleanup errors or physical continuation. */
    readonly ok: boolean
    /** Logical removal already committed even if cleanup is incomplete or failed. */
    readonly committed: true
    /** Remaining Host publication captured immediately after logical revocation. */
    readonly snapshot: TSnapshot
    /** Per-registration cleanup observations in dependency-safe cleanup order. */
    readonly leaves: readonly IPluginBatchRemovalLeaf[]
    /** True only when the batch reports no cleanup errors or unsettled continuation. */
    readonly cleanupComplete: boolean
  }>

/** Internal composition snapshot; ordinary Host consumers receive name-addressed handles. */
export type IPluginHostCompositionSnapshot = Readonly<{
  /** Frozen extension publication with exact-registration liveness guards. */
  readonly extensions: Readonly<Record<PropertyKey, unknown>>
  /** Host config capability; reading a path still resolves current committed configuration. */
  readonly config: IPluginHostConfigFor<readonly IPluginConstraint<any>[]>
}>

/** Host-owned integration used by a composition owner to perform total batch publication. */
export type IPluginHostCompositionIntegration<_THost> = Readonly<{
  /** Live committed revision, used to reject publication of a drifted prepared candidate. */
  readonly revision: number
  /** Captures current enabled publication; throws when the Host no longer accepts access. */
  getCurrentSnapshot(): IPluginHostCompositionSnapshot
  /** Captures a definition without running hooks and returns its immutable opaque admission. */
  createPluginAdmission<TPlugin extends IPluginConstraint<any>>(
    plugin: TPlugin
  ): IPluginAdmission<TPlugin>
  /** Allocates a stable name-matched stage lane; a second live slot for the same name is invalid. */
  createDataOrderSlot(name: string): IPluginDataOrderSlot
  /** Queues construction without publication; the owner must later commit or discard the capsule. */
  prepareAdmissions(
    requestsInPublicationOrder: readonly IPluginAdmissionRequest[]
  ): Promise<IPluginPreparedAdmissions>
  /**
   * Synchronously publishes one unused candidate if revision/lanes remain current; returns
   * receipts.
   */
  commitPreparedAdmissions(prepared: IPluginPreparedAdmissions): readonly IRegistrationToken[]
  /** Rolls back an unpublished candidate; repeated or foreign discard returns empty cleanup detail. */
  discardPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): Promise<IPluginHostPhysicalCleanupResult>
  /** Permanently retires this Host's lane; repeated retirement is harmless, foreign slots fail. */
  retireDataOrderSlot(slot: IPluginDataOrderSlot): void
  /** Captures exact live receipts, rejecting duplicates or an omitted required dependent. */
  prepareUnUseBatch(
    receiptsInCleanupOrder: readonly IRegistrationToken[]
  ): IPluginPreparedRemovalBatch
  /** Rechecks generations/dependencies, revokes all leaves, then waits for the fence and cleanup. */
  commitPreparedUnUseBatch<TView>(
    prepared: IPluginPreparedRemovalBatch,
    options: IPluginBatchRemovalOptions
  ): Promise<IPluginBatchRemovalResult<TView>>
}>
