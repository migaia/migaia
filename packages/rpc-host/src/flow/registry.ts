/** Registers native stages and retains scoped facts; execution and lifetime remain native-owned. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcObservation } from '@migaia/rpc-contract/interfaces'
import { HostErrorText } from '../host/error-text.js'
import type { IRpcFlowFeature, IRpcFlowInstallation, IRpcFlowSetupContext } from '../sdk/types.js'
import type { IRpcFlowEntry, IRpcSharedFlows } from '../sdk/metadata.js'
import type { RpcTransportFlowProgram } from '../sdk/flow-program.js'
import {
  RpcFlowPoint,
  invalidFlow,
  RpcFlowLayer,
  RpcFlowPipelines,
  type IRpcFlowCore,
  type IRpcFlowStage
} from '../sdk/flow-pipelines.js'

/** Inner-to-outer fixed positions retain canonical dependency order within each native bucket. */
const flowPositions = {
  [RpcFlowLayer.plaintext]: 0,
  schema: 1,
  idempotency: 2,
  limits: 3,
  auth: 4,
  chunk: 5,
  batch: 6,
  [RpcFlowLayer.wire]: 7
} as const

/** No shared wrapper is required for an ordinary native host with only local transport Features. */
const emptyShared: IRpcSharedFlows = Object.freeze({
  selection: new Map<PropertyKey, IRpcFlowFeature<object>>(),
  entries: new Map<object, IRpcFlowEntry>()
})

/** Cached negotiation and observation facts contain only this scope's actual installations. */
type IFlowFacts = Readonly<{
  selected: readonly IRpcFlowInstallation<object>[]
  extensions: readonly string[]
  required: readonly string[]
  observing: boolean
  nativeBinary?: false
  transferRequiresIntegrity: boolean
  observationFacts?: IRpcFlowInstallation['observationFacts']
}>

/** A Session borrows its exact native registration's view, including during candidate startup. */
export type IRpcFlowGroup = Readonly<{
  facts(namespace?: string): IFlowFacts
  observe(event: IRpcObservation): void
  namespaceExtensions(namespace: string): readonly Readonly<Record<string, unknown>>[]
}>

/** Compile immutable scope facts once, deduplicating exact installations without another graph. */
function compileFacts(installations: Iterable<IRpcFlowInstallation<object>>): IFlowFacts {
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
  for (const installed of installations) {
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
  for (const { namespaceExtensions: create } of facts.selected)
    if (create) values.push(create(namespace) as Readonly<Record<string, unknown>>)
  return values
}

/** A group borrows installations and host observers without owning another cleanup or executor. */
class RpcFlowGroup implements IRpcFlowGroup {
  /** The original registry alone owns host observer registration and reporting. */
  readonly #registry: FlowRegistry
  /** These exact selected entries belong to one native transport generation. */
  readonly #installed: readonly IRpcFlowInstallation<object>[]
  /** Host fact identity changes only when a readonly native registration is added or removed. */
  #host: IFlowFacts | undefined
  /** Negotiation never rescans entries until actual host observer membership changes. */
  #facts: IFlowFacts | undefined

  /** Capture only the original prepared installations; no resource is acquired here. */
  constructor(registry: FlowRegistry, entries: readonly IRpcFlowEntry[]) {
    this.#registry = registry
    this.#installed = Object.freeze(entries.map(({ installed }) => installed))
  }

  /** Scope is already fixed by registration identity; the argument preserves Session's narrow port. */
  facts(_namespace?: string): IFlowFacts {
    /** Host observers remain shared while local and overridden shared Features remain isolated. */
    const host = this.#registry.hostFacts()
    if (this.#host !== host) {
      this.#host = host
      this.#facts = compileFacts([...host.selected, ...this.#installed])
    }
    return this.#facts!
  }

  /** Namespace events visit only this group's selected shared/local instances and host observers. */
  readonly observe = (event: IRpcObservation): void => {
    this.#registry.observeInstallations(this.facts().selected, event)
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

  /** Borrow reporting and committed group lookup without creating a public or pending group map. */
  constructor(
    report: (error: unknown) => void,
    resolveGroup?: (namespace: string) => IRpcFlowGroup | undefined
  ) {
    this.#report = report
    this.#resolveGroup = resolveGroup
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
    this.#assertMutable()
    this.#shared = shared
    this.#allFacts = undefined
    core.onDispose(() => {
      if (this.#shared === shared) this.#shared = emptyShared
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
    const entries = await program.prepare(core, rootSignal, context, this.#shared)
    // Seven points form the complete compile-time intervention domain.
    for (const point of Object.values(RpcFlowPoint))
      this.#registerStages(core as IRpcFlowCore, point, entries)
    return new RpcFlowGroup(this, entries)
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

  /** Global namespace observations use committed groups; Session observations use their own group. */
  readonly observe = (event: IRpcObservation): void => {
    /** A scoped group includes the same host observers exactly once. */
    const group = event.namespace === undefined ? undefined : this.#resolveGroup?.(event.namespace)
    if (group) group.observe(event)
    else
      this.observeInstallations(
        event.namespace === undefined ? this.facts().selected : this.hostFacts().selected,
        event
      )
  }

  /** Isolate observer failures without replacing business continuation or error identity. */
  observeInstallations(
    installations: readonly IRpcFlowInstallation<object>[],
    event: IRpcObservation
  ): void {
    for (const installed of installations) {
      try {
        installed.observe?.(event)
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
    return (this.#allFacts ??= compileFacts([
      ...this.#registrations,
      ...[...this.#shared.entries.values()].map(({ installed }) => installed)
    ]))
  }

  /** Drop borrowed references after native cleanup has removed stages and installation state. */
  close(): void {
    this.#registrations.clear()
    this.#shared = emptyShared
    this.#invalidateObservers()
  }

  /** The fixed eight positions preserve native dependency/install order inside every bucket. */
  #registerStages<K extends RpcFlowPoint>(
    core: IRpcFlowCore,
    point: K,
    entries: readonly IRpcFlowEntry[]
  ): void {
    /** Eight is fixed: plaintext, six builtin capabilities and wire. No collection is sorted. */
    const buckets = Object.values(flowPositions).map((): IRpcFlowStage<K>[] => [])
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
      buckets[position]!.push((annotation ? annotation.stage : selected) as IRpcFlowStage<K>)
    }
    /** Inbound reversal still comes from the genuine native declaration. */
    const reverse = RpcFlowPipelines[point].order === RpcFlowPipelines.handshakeInbound.order
    /** This current transport core sees only its own short point and genuine native stage lease. */
    const pipeline = core.pipeline(point)
    for (const bucket of buckets) {
      if (reverse) bucket.reverse()
      // The point selects its exact spec; the erased generic map loses that correlation.
      for (const stage of bucket)
        pipeline.use(stage as unknown as Parameters<typeof pipeline.use>[0])
    }
  }

  /** Only real readonly registration changes invalidate every group's shared host-fact prefix. */
  #invalidateObservers(): void {
    this.#hostFacts = undefined
    this.#allFacts = undefined
  }

  /** Starting traffic freezes existing host interventions without forbidding new native groups. */
  #assertMutable(): void {
    if (this.#started) invalidFlow(HostErrorText.flowStarted)
  }
}
