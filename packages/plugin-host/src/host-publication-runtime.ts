/**
 * Owns concrete Host publication and explicit handle/view read ports; registrations and cleanup
 * remain with canonical owners.
 */

import { tagPluginHostError } from './error-text.js'

import { type IInstallBatchContext } from './install-runtime.js'
import { PluginHostErrorCode } from './error-code.js'

import type { IPipelineDefinitions } from './pipeline-spec.js'

import { reportTerminalFailure } from './diagnostic-report.js'

import type { IRegistration } from './registry.js'
import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginHostCompositionSnapshot } from './composition-types.js'

import type { IPluginHostRuntimeContext } from './host-runtime-context.js'
import type { PluginHostRuntimePorts } from './host-runtime-ports.js'
import type { IPluginConfig } from './plugin-lifecycle-types.js'

/** Candidate-aware reads preserve the batch until it commits, then resolve current names. */
export class PluginHostHandlePort<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Explicit Host context holding canonical registrations and config. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Host admission authority retained by handles. */
  readonly #port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  /** Candidate identity, absent for ordinary committed handles. */
  readonly #batch: IInstallBatchContext<TDomainCore, TValue> | undefined
  /** Captures the original batch identity without copying its registries. */
  constructor(
    context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>,
    port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ) {
    this.#context = context
    this.#port = port
    this.#batch = batch
  }
  /** Extension calls retain the public Host receiver. */
  get host() {
    return this.#context.owner.host
  }
  /** Handle reads keep the original Host lifecycle guard. */
  assertActive(): void {
    this.#port.assertActive()
  }
  /** Exact key reads are O(1), selecting unpublished candidates only while their batch is open. */
  lookup(name: string): IRegistration<TDomainCore, TValue> | undefined {
    return (
      (this.#batch && !this.#batch.committed ? this.#batch.registrations.get(name) : undefined) ??
      this.#context.state.registrations.get(name)
    )
  }
  /** Config reads remain name-addressed through the stable Host config facade. */
  readConfig(name: string): unknown {
    return this.#context.configRuntime.getFacade().get(name)
  }
  /** Config updates retain their queued transaction and Promise. */
  updateConfig(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void> {
    return this.#context.configRuntime.getFacade().update(name, recipe)
  }
}

/** Committed view reads have exact-generation guards independent of token capability guards. */
export class PluginHostPublicationPort<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Canonical Host state and config owner. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Original exact-generation guard, bound for publication's receiverless callback use. */
  readonly assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void
  /** Captures Host publication authority without retaining a second registry. */
  constructor(
    context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>,
    port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  ) {
    this.#context = context
    this.assertLive = port.assertLive
  }
  /** Callable views preserve the public Host receiver. */
  get host() {
    return this.#context.owner.host
  }
  /** Reads config through the original path contract. */
  readConfig(path: string): unknown {
    return this.#context.configRuntime.getFacade().get(path)
  }
  /** Updates config through the canonical serialized owner. */
  updateConfig(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void> {
    return this.#context.configRuntime.getFacade().update(name, recipe)
  }
  /** One linear pass reads one committed facade per shared key, independent of member count. */
  readSharedExtensions(): ReadonlyMap<PropertyKey, object> {
    /** Snapshot of shared publications, not a second mutable contribution registry. */
    const shared = new Map<PropertyKey, object>()
    for (const key of this.#context.state.extensionOwners.keys()) {
      /** Exclusive extension keys retain their original exact-registration view. */
      const facade = this.#context.state.readSharedExtension(key)
      if (facade) shared.set(key, facade)
    }
    return shared
  }
}

/** Shared Host descriptors keep canonical reads; composition captures views on demand. */
export class PluginHostPublicationRuntime<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Concrete public Host and its committed publication owner. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Host lifecycle and snapshot authority. */
  readonly #port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  /** Captures the already-created canonical Host authorities. */
  constructor(
    context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>,
    port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  ) {
    this.#context = context
    this.#port = port
  }
  /** Shared slot access retains the original Host admission guard. */
  readonly assertActive = (): void => this.#port.assertActive()
  /** Diagnostic reporting keeps the original terminal-failure policy. */
  readonly report = (error: unknown): void => reportTerminalFailure(error, this.#context.diagnostic)
  /** Captures a frozen committed view only when composition asks for it. */
  readonly captureView = (): IPluginHostCompositionSnapshot => {
    this.#port.assertActive()
    return this.#port.createView()
  }
  /** Adds one immutable getter without replacing the native failure on a non-extensible Host. */
  publish(key: PropertyKey): void {
    if (Object.hasOwn(this.#context.owner.host, key)) return
    try {
      Object.defineProperty(this.#context.owner.host, key, {
        enumerable: true,
        configurable: false,
        get: () => this.#context.state.readSharedExtension(key)
      })
    } catch (error) {
      throw tagPluginHostError(error as TypeError, PluginHostErrorCode.pluginInstallFailed)
    }
  }
}
