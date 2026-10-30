/** Registers native stages and retains scoped facts; execution and lifetime remain native-owned. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import { containAsyncRejection } from '@migaia/lifecycle'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcObservation } from '@migaia/rpc-contract/interfaces'
import { HostErrorText } from '../host/error-text.ts'
import { defaultRpcWarning, type IRpcWarning } from '../host/warning.ts'
import type { IRpcFlowFeature, IRpcFlowInstallation, IRpcFlowSetupContext } from '../sdk/types.ts'
import type { IRpcFlowEntry, IRpcSharedFlows } from '../sdk/metadata.ts'
import type { RpcTransportFlowProgram } from '../sdk/flow-program.ts'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import {
  RpcFlowPoint,
  invalidFlow,
  RpcFlowLayer,
  RpcFlowPipelines,
  type IRpcFlowCore,
  type IRpcFlowStage
} from '../sdk/flow-pipelines.ts'

/** Inner-to-outer fixed positions retain canonical dependency order within each native bucket. */
const flowPositions = {
  [RpcFlowLayer.plaintext]: 0,
  schema: 1,
  idempotency: 2,
  limits: 3,
  errorMap: 4,
  auth: 5,
  chunk: 6,
  batch: 7,
  [RpcFlowLayer.wire]: 8
} as const

/** No shared wrapper is required for an ordinary native host with only local transport Features. */
const emptyShared: IRpcSharedFlows = Object.freeze({
  selection: new Map<PropertyKey, IRpcFlowFeature<object>>(),
  entries: new Map<object, IRpcFlowEntry>(),
  controls: Object.freeze({})
})

/** One explicit carrier group contributes role selection, exact native outputs and setup entries. */
function combineShared(groups: Iterable<IRpcSharedFlows>): IRpcSharedFlows {
  /** Scope-wide role uniqueness prevents independently owned duplicate flow quota resources. */
  const selection = new Map<PropertyKey, IRpcFlowFeature<object>>()
  /** Original identities preserve native setup results across transport-local placement overrides. */
  const entries = new Map<object, IRpcFlowEntry>()
  /** Shared caller aliases form the cold namespace control prefix. */
  const controls: Record<string, object> = Object.create(null)
  for (const group of groups) {
    for (const [role, feature] of group.selection) {
      if (selection.has(role))
        throw tagRpcError(
          new TypeError(HostErrorText.featureCombinationConflict),
          RpcCoreErrorCode.featureCombinationConflict
        )
      selection.set(role, feature)
    }
    for (const [feature, entry] of group.entries) entries.set(feature, entry)
    Object.assign(controls, group.controls)
  }
  return Object.freeze({ selection, entries, controls: Object.freeze(controls) })
}

/** Custom phase belongs to one fixed stage point/layer; builtin positions bypass phase ordering. */
type IPhasedStage<K extends RpcFlowPoint> = Readonly<{ stage: IRpcFlowStage<K>; phase: number }>

/**
 * Two bounded byte passes order unsigned 16-bit phases in linear time, without record-position
 * ties.
 */
function orderPhases<T extends Readonly<{ phase: number }>>(stages: T[], distinct = true): T[] {
  /** Input and output arrays alternate per bounded radix pass. */
  let ordered = stages
  // A phase has exactly two bytes, as required by defineFlowFeature's 0..65535 contract.
  for (let shift = 0; shift < 16; shift += 8) {
    /** The radix alphabet has a fixed compile-time bound of 256 byte values. */
    const offsets = new Uint32Array(256)
    for (const entry of ordered) offsets[(entry.phase >>> shift) & 255]! += 1
    /** Prefix offsets choose each byte bucket's first output position. */
    let offset = 0
    // The radix alphabet has exactly 256 byte values, independent from the number of features.
    for (let index = 0; index < 256; index += 1) {
      /** Save the bucket count before replacing it with its write cursor. */
      const count = offsets[index]!
      offsets[index] = offset
      offset += count
    }
    /** Each stage is copied once in this pass; no comparator or growable sort is used. */
    const output: T[] = []
    for (const entry of ordered) {
      /** The current byte selects its fixed bucket cursor. */
      const bucket = (entry.phase >>> shift) & 255
      output[offsets[bucket]!] = entry
      offsets[bucket]! += 1
    }
    ordered = output
  }
  /** Equal phases are invalid rather than implicitly ordered by caller record enumeration. */
  let previous: number | undefined
  for (const entry of ordered) {
    if (distinct && entry.phase === previous)
      throw tagRpcError(
        new TypeError(HostErrorText.flowPhaseConflict),
        RpcCoreErrorCode.invalidConfig
      )
    previous = entry.phase
  }
  return ordered
}

/** Callback channels compete only with callbacks of the same kind, never disjoint stages. */
type IFlowCallback = 'observe' | 'namespaceExtensions'

/** Order actual Feature callbacks with the same fixed builtin positions and custom phase owner. */
function orderCallbacks(
  entries: readonly IRpcFlowEntry[],
  channel: IFlowCallback
): readonly IRpcFlowInstallation<object>[] {
  /** The nine fixed positions match stage placement; callbacks have no wire-layer annotation. */
  const buckets = Object.values(flowPositions).map(
    (): Readonly<{ installed: IRpcFlowInstallation<object>; phase: number }>[] => []
  )
  for (const entry of entries) {
    if (entry.installed[channel] === undefined) continue
    buckets[flowPositions[entry.builtin ?? RpcFlowLayer.plaintext]]!.push({
      installed: entry.installed,
      phase: entry.definition.phase ?? 0
    })
  }
  /** An exact installation contributes each callback once even when several roots return it. */
  const seen = new Set<IRpcFlowInstallation<object>>()
  /** The cold result is cached with the scope's existing negotiation facts. */
  const ordered: IRpcFlowInstallation<object>[] = []
  for (let index = 0; index < buckets.length; index += 1) {
    /** Shared output identity is deduplicated before detecting competing custom phases. */
    const bucket =
      index === flowPositions.plaintext ? orderPhases(buckets[index]!, false) : buckets[index]!
    /** Only distinct callback owners in this channel can conflict at one custom phase. */
    let previous: number | undefined
    for (const entry of bucket) {
      if (seen.has(entry.installed)) continue
      if (index === flowPositions.plaintext && entry.phase === previous)
        invalidFlow(HostErrorText.flowPhaseConflict)
      seen.add(entry.installed)
      ordered.push(entry.installed)
      previous = entry.phase
    }
  }
  return Object.freeze(ordered)
}

/** Cached negotiation and observation facts contain only this scope's actual installations. */
type IFlowFacts = Readonly<{
  selected: readonly IRpcFlowInstallation<object>[]
  /** Observation and namespace publication each use their own cold Feature phase ordering. */
  observers: readonly IRpcFlowInstallation<object>[]
  namespaceFactories: readonly IRpcFlowInstallation<object>[]
  extensions: readonly string[]
  required: readonly string[]
  observing: boolean
  nativeBinary?: false
  transferRequiresIntegrity: boolean
  observationFacts?: IRpcFlowInstallation['observationFacts']
}>

/** A Session borrows its exact native registration's view, including during candidate startup. */
export type IRpcFlowGroup = Readonly<{
  /** Only selected transport-owned information-flow Features prevent removal with live Sessions. */
  local: boolean
  /** Exact shared setup identity excludes host capabilities overridden by local selection. */
  usesShared(shared: IRpcSharedFlows): boolean
  facts(namespace?: string): IFlowFacts
  observe(event: IRpcObservation): void
  namespaceExtensions(namespace: string): readonly Readonly<Record<string, unknown>>[]
}>

/** Compile immutable scope facts once, deduplicating exact installations without another graph. */
function compileFacts(
  installations: Iterable<IRpcFlowInstallation<object>>,
  entries: readonly IRpcFlowEntry[] = []
): IFlowFacts {
  /** Readonly native plugins keep their existing prefix; Feature callback order is phase-owned. */
  const host = [...installations]
  /** One object can be reached through several roots while retaining one observation callback. */
  const seen = new Set<IRpcFlowInstallation<object>>()
  /** Selected installations retain their native installation/dependency order. */
  const selected: IRpcFlowInstallation<object>[] = []
  /** Optional and required negotiation domains remain independent. */
  const extensions = new Set<string>()
  /** Required declarations do not implicitly become optional proposals. */
  const required = new Set<string>()
  /** Only an actual observer enables raw carrier observation. */
  let observing = false
  /** Any selected restriction can disable native binary capability, never enable it. */
  let nativeBinary: false | undefined
  /** Native transfer admission borrows the selected installed integrity policy. */
  let transferRequiresIntegrity = false
  /** Existing later-installation precedence determines the observable protection mode. */
  let observationFacts: IRpcFlowInstallation['observationFacts']
  for (const installed of [...host, ...entries.map(({ installed }) => installed)]) {
    if (seen.has(installed)) continue
    seen.add(installed)
    selected.push(installed)
    for (const name of installed.extensions ?? []) extensions.add(name)
    for (const name of installed.requiredExtensions ?? []) required.add(name)
    observing ||= installed.observe !== undefined
    nativeBinary = installed.nativeBinary === false ? false : nativeBinary
    transferRequiresIntegrity ||= installed.transferRequiresIntegrity === true
    observationFacts = installed.observationFacts ?? observationFacts
  }
  return Object.freeze({
    selected: Object.freeze(selected),
    observers: Object.freeze([...new Set([...host, ...orderCallbacks(entries, 'observe')])]),
    namespaceFactories: Object.freeze([
      ...new Set([...host, ...orderCallbacks(entries, 'namespaceExtensions')])
    ]),
    extensions: Object.freeze([...extensions]),
    required: Object.freeze([...required]),
    observing,
    nativeBinary,
    transferRequiresIntegrity,
    observationFacts
  })
}

/** Publish original namespace factories once at the native registration's publication boundary. */
function namespaceExtensions(
  facts: IFlowFacts,
  namespace: string
): readonly Readonly<Record<string, unknown>>[] {
  /** Factories keep the original receiverless invocation and selected installation order. */
  const values: Readonly<Record<string, unknown>>[] = []
  for (const { namespaceExtensions: create } of facts.namespaceFactories)
    if (create) values.push(create(namespace) as Readonly<Record<string, unknown>>)
  return values
}

/** Warning subscriptions belong only to native host observers, never information-flow Features. */
function assertInterventionEntries(entries: Iterable<IRpcFlowEntry>): void {
  for (const { installed } of entries)
    if (installed.onWarning !== undefined) invalidFlow(HostErrorText.pluginInvalid)
}

/** A group borrows installations and host observers without owning another cleanup or executor. */
class RpcFlowGroup implements IRpcFlowGroup {
  /** The original registry alone owns host observer registration and reporting. */
  readonly #registry: FlowRegistry
  /** These exact selected entries belong to one native transport generation. */
  readonly #installed: readonly IRpcFlowEntry[]
  /** Only a selected shared entry retains this exact wrapper's removal relationship. */
  readonly #entries: ReadonlySet<IRpcFlowEntry>
  /** Native readonly observers never contribute to this selected local intervention fact. */
  readonly local: boolean
  /** Host fact identity changes only when a readonly native registration is added or removed. */
  #host: IFlowFacts | undefined
  /** Negotiation never rescans entries until actual host observer membership changes. */
  #facts: IFlowFacts | undefined

  /** Capture only the original prepared installations; no resource is acquired here. */
  constructor(registry: FlowRegistry, entries: readonly IRpcFlowEntry[], shared: IRpcSharedFlows) {
    this.#registry = registry
    this.#installed = entries
    /** Reject callback phase collisions before the transport can acquire native IO. */
    const host = registry.hostFacts()
    this.#host = host
    this.#facts = compileFacts(host.selected, entries)
    /** Registration-time identity membership distinguishes borrowed shared and native local entries. */
    const borrowed = new Set(shared.entries.values())
    /** Each selected entry participates once; no dependency or Session registry is added here. */
    let hasShared = false
    /** A local Feature's owning removable unit is this native transport registration. */
    let hasLocal = false
    for (const entry of entries) {
      if (borrowed.has(entry)) hasShared = true
      else hasLocal = true
    }
    this.#entries = hasShared ? new Set(entries) : new Set()
    this.local = hasLocal
  }

  /** Cold wrapper deletion is guarded only by namespaces actually borrowing its selected entries. */
  usesShared(shared: IRpcSharedFlows): boolean {
    for (const entry of shared.entries.values()) if (this.#entries.has(entry)) return true
    return false
  }

  /** Scope is already fixed by registration identity; the argument preserves Session's narrow port. */
  facts(_namespace?: string): IFlowFacts {
    /** Host observers remain shared while local and overridden shared Features remain isolated. */
    const host = this.#registry.hostFacts()
    if (this.#host !== host) {
      this.#host = host
      this.#facts = compileFacts(host.selected, this.#installed)
    }
    return this.#facts!
  }

  /** Namespace events visit only this group's selected shared/local instances and host observers. */
  readonly observe = (event: IRpcObservation): void => {
    this.#registry.observeInstallations(this.facts().observers, event)
  }

  /** Extension factories retain this candidate's original selected installations. */
  namespaceExtensions(namespace: string): readonly Readonly<Record<string, unknown>>[] {
    return namespaceExtensions(this.facts(), namespace)
  }
}

/** Native generations own all stages and disposal; this registry owns readonly composition facts. */
export class FlowRegistry {
  /** Readonly host observers retain their existing native registration lifetime. */
  readonly #registrations = new Set<IRpcFlowInstallation<object>>()
  /** A host wrapper lends shared prepared entries; their disposal remains with its native core. */
  #shared: IRpcSharedFlows = emptyShared
  /** Each explicit native carrier owns its own shared setup and withdrawal receipt. */
  readonly #sharedRegistrations = new Set<IRpcSharedFlows>()
  /** Incremental role ownership rejects duplicates without rescanning an installation batch. */
  readonly #sharedRoleOwners = new Map<PropertyKey, IRpcSharedFlows>()
  /** Shared carriers publish caller aliases into one namespace.features table; each has one owner. */
  readonly #sharedAliasOwners = new Map<string, IRpcSharedFlows>()
  /** Shared snapshots are compiled once before transport preparation, not after each carrier. */
  #sharedDirty = false
  /** Shared readonly membership invalidates group facts by changing this cached identity. */
  #hostFacts: IFlowFacts | undefined
  /** Host-wide events deduplicate shared installations independently from namespace count. */
  #allFacts: IFlowFacts | undefined
  /** Transport startup seals the fixed host intervention prefix, not future transport groups. */
  #started = false
  /** Observer failures use the original host diagnostic outlet. */
  readonly #report: (error: unknown) => void
  /** Only the native owner's committed namespace table supplies global namespace routing. */
  readonly #resolveGroup: ((namespace: string) => IRpcFlowGroup | undefined) | undefined
  /** The original options callback receives the same record before native host subscribers. */
  readonly #onWarning: ((warning: IRpcWarning) => void) | undefined

  /** Borrow reporting and committed group lookup without creating a public or pending group map. */
  constructor(
    report: (error: unknown) => void,
    resolveGroup?: (namespace: string) => IRpcFlowGroup | undefined,
    onWarning?: (warning: IRpcWarning) => void
  ) {
    this.#report = report
    this.#resolveGroup = resolveGroup
    this.#onWarning = onWarning
  }

  /** Register a readonly host installation; information-flow stages must use native Features. */
  register(core: IPluginHostCore, installed: IRpcFlowInstallation<object>): void {
    if (Object.values(installed.stages ?? {}).some((stage) => stage !== undefined))
      invalidFlow(HostErrorText.flowFeatureRequired)
    this.#registrations.add(installed)
    this.#invalidateObservers()
    core.onDispose(() => {
      this.#registrations.delete(installed)
      this.#invalidateObservers()
    })
  }

  /** Remember shared setup once; later transports borrow entries without retaining an expired core. */
  registerShared(core: IPluginHostCore, shared: IRpcSharedFlows): void {
    if (shared.entries.size > 0) this.#assertMutable()
    assertInterventionEntries(shared.entries.values())
    for (const role of shared.selection.keys())
      if (this.#sharedRoleOwners.has(role))
        throw tagRpcError(
          new TypeError(HostErrorText.featureCombinationConflict),
          RpcCoreErrorCode.featureCombinationConflict
        )
    for (const alias of Object.keys(shared.controls))
      if (this.#sharedAliasOwners.has(alias))
        throw tagRpcError(
          new TypeError(HostErrorText.namespaceExtensionConflict),
          RpcCoreErrorCode.invalidConfig
        )
    for (const role of shared.selection.keys()) this.#sharedRoleOwners.set(role, shared)
    for (const alias of Object.keys(shared.controls)) this.#sharedAliasOwners.set(alias, shared)
    this.#sharedRegistrations.add(shared)
    this.#sharedDirty = true
    this.#allFacts = undefined
    core.onDispose(() => {
      this.#sharedRegistrations.delete(shared)
      for (const role of shared.selection.keys())
        if (this.#sharedRoleOwners.get(role) === shared) this.#sharedRoleOwners.delete(role)
      for (const alias of Object.keys(shared.controls))
        if (this.#sharedAliasOwners.get(alias) === shared) this.#sharedAliasOwners.delete(alias)
      this.#sharedDirty = true
      this.#allFacts = undefined
    })
  }

  /** Prepare locals and register original stages in this transport's seven native short-name lanes. */
  async prepareTransport(
    core: IPluginHostCore,
    program: RpcTransportFlowProgram,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext
  ): Promise<IRpcFlowGroup> {
    /** Every local setup belongs to this current core; shared setup is never repeated here. */
    /** The complete shared batch is compiled once at its first transport consumer. */
    const shared = this.#sharedSnapshot()
    const entries = await program.prepare(core, rootSignal, context, shared)
    assertInterventionEntries(entries)
    // Seven points form the complete compile-time intervention domain.
    for (const point of Object.values(RpcFlowPoint))
      this.#registerStages(core as IRpcFlowCore, point, entries)
    return new RpcFlowGroup(this, entries, shared)
  }

  /** A failed first native batch may retry before any transport has committed traffic. */
  reopenBeforeStartup(): void {
    this.#started = false
  }

  /** Late transports remain valid; only the fixed host intervention prefix becomes immutable. */
  start(): void {
    this.#started = true
  }

  /** Namespace extensions are resolved only from the native owner's committed registration. */
  namespaceExtensions(namespace: string): readonly Readonly<Record<string, unknown>>[] {
    return namespaceExtensions(this.facts(namespace), namespace)
  }

  /** Namespace control addressing merges shared roots with this transport's original local aliases. */
  controls(local: Readonly<Record<string, object>>): Readonly<Record<string, object>> {
    /**
     * Policy controls form the lowest addressing precedence before shared and transport-local
     * roots.
     */
    const controls: Record<string, object> = Object.create(null)
    return Object.freeze(Object.assign(controls, this.#sharedSnapshot().controls, local))
  }

  /**
   * Native policy removal withdraws only its own output references; late policy admission stays
   * valid.
   */
  registerControls(core: IPluginHostCore, controls: Readonly<Record<string, object>>): void {
    this.registerShared(core, {
      selection: new Map(),
      entries: new Map(),
      controls
    })
  }

  /** Global namespace observations use committed groups; Session observations use their own group. */
  readonly observe = (event: IRpcObservation): void => {
    /** A scoped group includes the same host observers exactly once. */
    const group = event.namespace === undefined ? undefined : this.#resolveGroup?.(event.namespace)
    if (group) group.observe(event)
    else
      this.observeInstallations(
        event.namespace === undefined ? this.facts().observers : this.hostFacts().observers,
        event
      )
  }

  /** Deliver one successful-decision record in order; only handler failures enter reporting. */
  readonly dispatchWarning = (warning: IRpcWarning): void => {
    /** Presence, rather than handler success, suppresses the console fallback. */
    let received = false
    /** A plain call preserves the configured callback's receiverless public signature. */
    const configured = this.#onWarning
    if (configured) {
      received = true
      this.#deliverWarning(() => configured(warning))
    }
    for (const installed of this.#registrations) {
      /** SDK subscriptions are callbacks, independent of their installation record. */
      const receive = installed.onWarning
      if (receive === undefined) continue
      received = true
      this.#deliverWarning(() => receive(warning))
    }
    if (!received) this.#deliverWarning(() => defaultRpcWarning(warning))
  }

  /** Synchronous and late asynchronous handler failures keep their exact original identity. */
  #deliverWarning(deliver: () => unknown): void {
    try {
      containAsyncRejection(deliver(), this.#report)
    } catch (error) {
      this.#report(error)
    }
  }

  /** Isolate observer failures without replacing business continuation or error identity. */
  observeInstallations(
    installations: readonly IRpcFlowInstallation<object>[],
    event: IRpcObservation
  ): void {
    for (const { observe } of installations) {
      try {
        containAsyncRejection(observe?.(event), this.#report)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  /** Groups compare this cache identity instead of rebuilding facts on every message. */
  hostFacts(): IFlowFacts {
    return (this.#hostFacts ??= compileFacts(this.#registrations))
  }

  /** Namespace queries never expose candidate facts through a global namespace lookup. */
  facts(namespace?: string): IFlowFacts {
    if (namespace !== undefined)
      return this.#resolveGroup?.(namespace)?.facts(namespace) ?? this.hostFacts()
    return (this.#allFacts ??= compileFacts(this.#registrations, [
      ...this.#sharedSnapshot().entries.values()
    ]))
  }

  /** Drop borrowed references after native cleanup has removed stages and installation state. */
  close(): void {
    this.#registrations.clear()
    this.#shared = emptyShared
    this.#sharedRegistrations.clear()
    this.#sharedRoleOwners.clear()
    this.#sharedAliasOwners.clear()
    this.#sharedDirty = false
    this.#invalidateObservers()
  }

  /** The fixed nine positions preserve native dependency/install order inside every bucket. */
  #registerStages<K extends RpcFlowPoint>(
    core: IRpcFlowCore,
    point: K,
    entries: readonly IRpcFlowEntry[]
  ): void {
    /** Nine is fixed: plaintext, seven builtin capabilities and wire. No collection is sorted. */
    const buckets = Object.values(flowPositions).map((): IPhasedStage<K>[] => [])
    for (const entry of entries) {
      /** Registration lends the original stage without a namespace filtering continuation. */
      const selected = entry.installed.stages?.[point]
      if (selected === undefined) continue
      /** Only an explicit layer annotation changes a third-party stage's fixed placement. */
      const annotation =
        typeof selected === 'object' &&
        selected !== null &&
        ('layer' in selected || 'stage' in selected)
          ? (selected as Readonly<{ layer: RpcFlowLayer; stage: IRpcFlowStage<K> }>)
          : undefined
      /** Plain stages retain the existing business-plaintext default. */
      const layer = annotation ? annotation.layer : RpcFlowLayer.plaintext
      if (layer !== RpcFlowLayer.plaintext && layer !== RpcFlowLayer.wire)
        invalidFlow(HostErrorText.flowLayerInvalid)
      /** Authenticated builtin identity retains priority over display names and public annotations. */
      const position = flowPositions[entry.builtin ?? layer]
      buckets[position]!.push({
        stage: (annotation ? annotation.stage : selected) as IRpcFlowStage<K>,
        phase: entry.definition.phase ?? 0
      })
    }
    /** Inbound reversal still comes from the genuine native declaration. */
    const reverse = RpcFlowPipelines[point].order === RpcFlowPipelines.handshakeInbound.order
    /** This current transport core sees only its own short point and genuine native stage lease. */
    const pipeline = core.pipeline(point)
    for (let index = 0; index < buckets.length; index += 1) {
      /** Custom plaintext/wire phases are ordered separately from the seven fixed builtin positions. */
      const bucket =
        index === flowPositions.plaintext || index === flowPositions.wire
          ? orderPhases(buckets[index]!)
          : buckets[index]!
      if (reverse) bucket.reverse()
      // The point selects its exact spec; the erased generic map loses that correlation.
      for (const { stage } of bucket)
        pipeline.use(stage as unknown as Parameters<typeof pipeline.use>[0])
    }
  }

  /** Only real readonly registration changes invalidate every group's shared host-fact prefix. */
  #invalidateObservers(): void {
    this.#hostFacts = undefined
    this.#allFacts = undefined
  }

  /** Defer the shared projection until a consumer needs it, keeping each admitted batch linear. */
  #sharedSnapshot(): IRpcSharedFlows {
    if (this.#sharedDirty) {
      this.#shared = combineShared(this.#sharedRegistrations)
      this.#sharedDirty = false
    }
    return this.#shared
  }

  /** Starting traffic freezes existing host interventions without forbidding new native groups. */
  #assertMutable(): void {
    if (this.#started) invalidFlow(HostErrorText.flowStarted)
  }
}
