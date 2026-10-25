/** Registers native stages and retains negotiation/observation facts, never an RPC executor. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcObservation } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.js'
import type { IRpcFlowDefinition, IRpcFlowInstallation } from '../sdk/types.js'
import type { IRpcFlowEntry } from '../sdk/metadata.js'
import {
  RpcFlowPoint,
  RpcFlowLayer,
  rpcHostPipelines,
  rpcFlowPipelineKey,
  type IRpcFlowCore,
  type IRpcFlowStage
} from '../sdk/flow-pipelines.js'

/** Inner-to-outer fixed positions are private; display names cannot grant builtin placement. */
const builtinPositions = {
  schema: 1,
  idempotency: 2,
  limits: 3,
  auth: 4,
  chunk: 5,
  batch: 6
} as const
/** Plaintext and wire surround the six fixed builtin positions. */
const bucketCount = 8

/** Every rejected declaration keeps the same native TypeError and package configuration code. */
function invalidFlow(message: string): never {
  throw tagRpcError(new TypeError(message), RpcCoreErrorCode.invalidConfig)
}

/** Cached namespace facts contain no stage order, snapshots, or execution continuations. */
type IFlowFacts = Readonly<{
  extensions: readonly string[]
  required: readonly string[]
  observing: boolean
  transferRequiresIntegrity: boolean
  observationFacts?: IRpcFlowInstallation['observationFacts']
}>

/** The native install generation owns all stages; this registry owns only their associated facts. */
export class FlowRegistry {
  /** Exact installations retain their namespace/observer facts until native rollback or removal. */
  readonly #registrations = new Map<IRpcFlowInstallation<object>, Set<string> | undefined>()
  /** Negotiation reads one cached membership projection per actual namespace. */
  readonly #scopes = new Map<string, IFlowFacts>()
  /** First transport startup freezes the declared intervention prefix. */
  #started = false
  /** Failed readonly observers report to the host's original diagnostic outlet. */
  readonly #report: (error: unknown) => void

  /** Borrow reporting without acquiring a carrier, graph, or pipeline executor. */
  constructor(report: (error: unknown) => void) {
    this.#report = report
  }

  /** The cold transport inventory alone determines which genuine native lanes may exist. */
  declarations(
    ...options: Parameters<typeof rpcHostPipelines>
  ): ReturnType<typeof rpcHostPipelines> {
    return rpcHostPipelines(...options)
  }

  /** Register directly on the installing core; native generation rollback removes every stage. */
  register(
    core: IPluginHostCore,
    definition: IRpcFlowDefinition<object>,
    installed: IRpcFlowInstallation<object>
  ): void {
    this.#assertMutable()
    if (Object.values(installed.stages ?? {}).some((stage) => stage !== undefined))
      invalidFlow(HostErrorText.flowFeatureRequired)
    this.#remember(
      core,
      installed,
      definition.namespaces === undefined ? undefined : new Set(definition.namespaces)
    )
  }

  /**
   * Register original functions in each native group; the wrapper's one generation owns all of
   * them.
   */
  registerFeatures(
    core: IPluginHostCore,
    groups: ReadonlyMap<string, readonly IRpcFlowEntry[]>
  ): void {
    this.#assertMutable()
    for (const [namespace, entries] of groups) {
      for (const { installed } of entries) {
        /** Shared host instances have one observation record across all their selected groups. */
        if (!this.#registrations.has(installed)) this.#remember(core, installed, new Set())
        this.#registrations.get(installed)?.add(namespace)
      }
      // Exactly seven points belong to each declaration group, independent of feature count.
      for (const point of Object.values(RpcFlowPoint))
        this.#registerStages(core as IRpcFlowCore, namespace, point, entries)
    }
    this.#scopes.clear()
  }

  /** A failed first native batch may retry before any transport has committed traffic. */
  reopenBeforeStartup(): void {
    this.#started = false
    this.#scopes.clear()
  }

  /** Freeze registration at the original startup boundary without compiling an execution chain. */
  start(): void {
    this.#started = true
  }

  /** Propose only installed handlers for this namespace. */
  extensions(namespace: string): readonly string[] {
    return this.#scope(namespace).extensions
  }

  /** Session owns negotiation against this cached installed requirement set. */
  requiredExtensions(namespace: string): readonly string[] {
    return this.#scope(namespace).required
  }

  /** Namespace publication borrows the original installation factories in native install order. */
  namespaceExtensions(namespace: string): readonly Readonly<Record<string, unknown>>[] {
    /** Each selected installation produces its own public extension surface once at publication. */
    const values: Readonly<Record<string, unknown>>[] = []
    for (const installed of this.#selected(namespace)) {
      /** Factories remain with their genuine installation and never obtain mutable host tables. */
      const create = installed.namespaceExtensions
      if (create) values.push(create(namespace) as Readonly<Record<string, unknown>>)
    }
    return values
  }

  /** Isolate observer failures without changing any business continuation or result. */
  readonly observe = (event: IRpcObservation): void => {
    for (const installed of this.#selected(event.namespace)) {
      try {
        installed.observe?.(event)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  /** Session subscribes only when a genuine selected observation installation exists. */
  observing(namespace: string): boolean {
    return this.#scope(namespace).observing
  }

  /** Protection facts originate from the installed owner rather than decoded peer data. */
  observationFacts(namespace: string): IRpcFlowInstallation['observationFacts'] {
    return this.#scope(namespace).observationFacts
  }

  /** Transfer preflight borrows the selected installation's cold integrity requirement. */
  transferRequiresIntegrity(namespace: string): boolean {
    return this.#scope(namespace).transferRequiresIntegrity
  }

  /** Drop installation references after native cleanup has removed its own stages. */
  close(): void {
    this.#registrations.clear()
    this.#scopes.clear()
  }

  /** The fixed eight positions preserve canonical dependency/install order inside every bucket. */
  #registerStages<K extends RpcFlowPoint>(
    core: IRpcFlowCore,
    namespace: string,
    point: K,
    entries: readonly IRpcFlowEntry[]
  ): void {
    /** Eight is a compile-time bound: plaintext, six builtins, wire. No collection is sorted. */
    const buckets: IRpcFlowStage<K>[][] = Array.from({ length: bucketCount }, () => [])
    for (const entry of entries) {
      /** This point selects the original stage without introducing a filtering continuation. */
      const selected = entry.installed.stages?.[point]
      if (selected === undefined) continue
      /**
       * Plain functions use plaintext; explicit layer metadata is admitted once before
       * registration.
       */
      const annotation =
        typeof selected === 'object' &&
        selected !== null &&
        ('layer' in selected || 'stage' in selected)
          ? (selected as Readonly<{ layer: RpcFlowLayer; stage: IRpcFlowStage<K> }>)
          : undefined
      /** Canonical native stage objects retain the same plaintext admission as plain functions. */
      const layer = annotation ? annotation.layer : RpcFlowLayer.plaintext
      if (layer !== RpcFlowLayer.plaintext && layer !== RpcFlowLayer.wire)
        invalidFlow(HostErrorText.flowLayerInvalid)
      /** Private builtin identity fixes placement even when another definition copies its name. */
      const position =
        entry.builtin === undefined
          ? layer === RpcFlowLayer.wire
            ? bucketCount - 1
            : 0
          : builtinPositions[entry.builtin]
      buckets[position]!.push((annotation ? annotation.stage : selected) as IRpcFlowStage<K>)
    }
    /** Inbound native snapshots reverse all entries, so each bucket is registered in reverse too. */
    const reverse =
      point !== RpcFlowPoint.handshakeOutbound &&
      point !== RpcFlowPoint.envelopeOutbound &&
      point !== RpcFlowPoint.frameOutbound
    /** All entries use the same genuine native install core and pipeline registration path. */
    const pipeline = core.pipeline(rpcFlowPipelineKey(point, namespace))
    for (const bucket of buckets) {
      if (reverse) bucket.reverse()
      // The point/key pair selects the same spec; TS erases this correlation in the string map.
      for (const stage of bucket)
        pipeline.use(stage as unknown as Parameters<typeof pipeline.use>[0])
    }
  }

  /** Native cleanup removes only this exact installation's facts; execution leases stay native. */
  #remember(
    core: IPluginHostCore,
    installed: IRpcFlowInstallation<object>,
    namespaces?: Set<string>
  ): void {
    this.#registrations.set(installed, namespaces)
    this.#scopes.clear()
    core.onDispose(() => {
      this.#registrations.delete(installed)
      this.#scopes.clear()
    })
  }

  /** Transport startup seals the one cold registration prefix for every group. */
  #assertMutable(): void {
    if (this.#started) invalidFlow(HostErrorText.flowStarted)
  }

  /** Observation and negotiation share one selected installation view, deduplicated by identity. */
  *#selected(namespace?: string): IterableIterator<IRpcFlowInstallation<object>> {
    for (const [installed, namespaces] of this.#registrations)
      if (namespace === undefined || !namespaces || namespaces.has(namespace)) yield installed
  }

  /** Collect only negotiation/observation membership; native snapshots never enter this cache. */
  #scope(namespace: string): IFlowFacts {
    /** Existing namespace facts are invalidated only when real installation membership changes. */
    const existing = this.#scopes.get(namespace)
    if (existing) return existing
    /** Extension membership is linear in actual installed declarations and deduplicated once. */
    const extensions = new Set<string>()
    /** Required extension membership remains distinct from optional proposals. */
    const required = new Set<string>()
    /** Only a genuine selected observer can enable raw-carrier observation. */
    let observing = false
    /** Integrity requirements combine across the namespace's actual selected installations. */
    let transferRequiresIntegrity = false
    /** A later selected installation retains the original protection-fact precedence. */
    let observationFacts: IRpcFlowInstallation['observationFacts']
    for (const installed of this.#selected(namespace)) {
      for (const name of installed.extensions ?? []) extensions.add(name)
      for (const name of installed.requiredExtensions ?? []) required.add(name)
      observing ||= installed.observe !== undefined
      transferRequiresIntegrity ||= installed.transferRequiresIntegrity === true
      observationFacts = installed.observationFacts ?? observationFacts
    }
    /** The cache publishes only immutable lists and readonly installation facts. */
    const facts = {
      extensions: [...extensions],
      required: [...required],
      observing,
      transferRequiresIntegrity,
      observationFacts
    }
    this.#scopes.set(namespace, facts)
    return facts
  }
}
