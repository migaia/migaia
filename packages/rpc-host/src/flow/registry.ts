/** Registers native stages and retains negotiation/observation facts, never an RPC executor. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcObservation } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.js'
import type { IRpcFlowDefinition, IRpcFlowInstallation } from '../sdk/types.js'
import { RpcFlowPoint, type IRpcFlowCore, type IRpcFlowStage } from '../sdk/flow-pipelines.js'

/** Each genuine installation retains its one precomputed namespace membership index. */
type IFlowRegistration = Readonly<{
  installed: IRpcFlowInstallation<object>
  namespaces?: ReadonlySet<string>
}>

/** Cached namespace facts contain no stage order, snapshots, or execution continuations. */
type IFlowFacts = Readonly<{
  extensions: readonly string[]
  required: readonly string[]
  observing: boolean
  observationFacts?: IRpcFlowInstallation['observationFacts']
}>

/** The native install generation owns all stages; this registry owns only their associated facts. */
export class FlowRegistry {
  /** Exact installations retain their namespace/observer facts until native rollback or removal. */
  readonly #registrations = new Map<IRpcFlowInstallation<object>, IFlowRegistration>()
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

  /** Register directly on the installing core; native generation rollback removes every stage. */
  register(
    core: IPluginHostCore,
    definition: IRpcFlowDefinition<object>,
    installed: IRpcFlowInstallation<object>
  ): void {
    if (this.#started)
      throw tagRpcError(new TypeError(HostErrorText.flowStarted), RpcCoreErrorCode.invalidConfig)
    /** Namespace filtering is constructed once and uses constant-time membership during execution. */
    const namespaces =
      definition.namespaces === undefined ? undefined : new Set(definition.namespaces)
    core.onDispose(() => {
      this.#registrations.delete(installed)
      this.#scopes.clear()
    })
    this.#registrations.set(installed, { installed, namespaces })
    this.#scopes.clear()
    /** Exactly seven keys are fixed by RpcFlowPoint; the native owner controls order and execution. */
    for (const name of Object.values(RpcFlowPoint)) {
      this.#registerStage(core as IRpcFlowCore, name, installed, namespaces)
    }
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
    for (const registration of this.#registrations.values())
      if (!registration.namespaces || registration.namespaces.has(namespace)) {
        /** Factories remain with their genuine installation and never obtain mutable host tables. */
        const create = registration.installed.namespaceExtensions
        if (create) values.push(create(namespace) as Readonly<Record<string, unknown>>)
      }
    return values
  }

  /** Isolate observer failures without changing any business continuation or result. */
  readonly observe = (event: IRpcObservation): void => {
    for (const registration of this.#registrations.values()) {
      if (
        event.namespace !== undefined &&
        registration.namespaces &&
        !registration.namespaces.has(event.namespace)
      )
        continue
      try {
        registration.installed.observe?.(event)
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

  /** Drop installation references after native cleanup has removed its own stages. */
  close(): void {
    this.#registrations.clear()
    this.#scopes.clear()
  }

  /** A scope filter delegates to the same native continuation; it has no runner or recursion. */
  #registerStage<K extends RpcFlowPoint>(
    core: IRpcFlowCore,
    name: K,
    installed: IRpcFlowInstallation<object>,
    namespaces: ReadonlySet<string> | undefined
  ): void {
    /** This fixed key indexes the same native spec and stage; TS loses that mapped correlation. */
    const stage = installed.stages?.[name] as IRpcFlowStage<K> | undefined
    if (!stage) return
    if (!namespaces) {
      core.pipeline(name).use(stage)
      return
    }
    core
      .pipeline(name)
      .use((payload, next) =>
        namespaces.has(payload.context.namespace) ? stage(payload, next) : next(payload)
      )
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
    /** A later selected installation retains the original protection-fact precedence. */
    let observationFacts: IRpcFlowInstallation['observationFacts']
    for (const registration of this.#registrations.values()) {
      if (registration.namespaces && !registration.namespaces.has(namespace)) continue
      for (const name of registration.installed.extensions ?? []) extensions.add(name)
      for (const name of registration.installed.requiredExtensions ?? []) required.add(name)
      observing ||= registration.installed.observe !== undefined
      observationFacts = registration.installed.observationFacts ?? observationFacts
    }
    /** The cache publishes only immutable lists and readonly installation facts. */
    const facts = {
      extensions: [...extensions],
      required: [...required],
      observing,
      observationFacts
    }
    this.#scopes.set(namespace, facts)
    return facts
  }
}
