/**
 * Owns declared pipeline groups, lookup and through edges; each lane delegates execution to its
 * runner owner.
 */
import { MiddlewarePipelineMode, MiddlewarePipelineNext } from '@migaia/middleware-pipeline'
import type { IPipelineDefinitions, IPipelineStageHandle } from './pipeline-spec.js'
import { DEFAULT_PIPELINE_KEY } from './stage-lanes.js'
import {
  pipelineDeclarations,
  assertPipelineMode,
  pipelineOptionError
} from './pipeline-declarations.js'
import { PluginHostPipeline } from './pipeline-entry.js'
import type { IPipelinePorts } from './named-pipeline-types.js'
import type { IPipelineConfig } from './host-options-types.js'
import ERROR_TEXT, { PluginHostError, attachPluginHostIdentity } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { isRegistrationRevoked } from './composition.js'
import { readDefinitionDependencies, type IPluginDependency } from './dependency-reader.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IRegistration } from './registry.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import { PluginPipelineThrough, PluginPipelineThroughRemoval } from './pipeline-through.js'
import {
  pipelinePluginScope,
  pipelineUnknownScope,
  pipelineInventory,
  qualifyPipelineName,
  splitPipelineAddress,
  PipelineAccessText
} from './pipeline-text.js'

/**
 * One collection enforces cross-pipeline registration and shares the Host's default execution
 * owner.
 */
export class PluginHostPipelines<TDomainCore extends object, TValue> {
  /** Host declarations are immutable; registration groups use exact generation identities. */
  readonly #entries = new Map<PropertyKey, PluginHostPipeline<TDomainCore, TValue>>()
  /** Private groups survive until their existing native cleanup scope releases them. */
  readonly #groups = new WeakMap<
    IRegistration<TDomainCore, TValue>,
    Map<string, PluginHostPipeline<TDomainCore, TValue>>
  >()
  /** Only batches issued by this Host can lend candidate execution authority. */
  readonly #batches = new WeakMap<object, Map<string, IRegistration<TDomainCore, TValue>>>()
  /** Immutable provider access is indexed once per exact registration, never rebuilt per lookup. */
  readonly #dependencyAccess = new WeakMap<
    IRegistration<TDomainCore, TValue>,
    Readonly<{
      dependencies: readonly IPluginDependency[]
      providers: ReadonlySet<string>
    }>
  >()
  /** Original batch context lets dependency-first candidates share a private group before commit. */
  readonly #contexts = new WeakMap<
    IRegistration<TDomainCore, TValue>,
    IInstallBatchContext<TDomainCore, TValue>
  >()
  /** Through edges share each exact stage removal lifetime, including duplicate edges. */
  readonly #edges = new Map<
    PluginHostPipeline<TDomainCore, TValue>,
    Map<PluginHostPipeline<TDomainCore, TValue>, number>
  >()
  /** Existing Host ports carry lifecycle and shared slot authority. */
  readonly #ports: IPipelinePorts<TValue>
  /** Any active pipeline prevents host-owned mutation of any pipeline's registration snapshot. */
  #depth = 0

  /** Validate all named descriptions before constructing the default or any named runner. */
  constructor(
    ports: IPipelinePorts<TValue>,
    defaultOptions: IPipelineConfig | undefined,
    definitions: IPipelineDefinitions | undefined
  ) {
    this.#ports = ports
    /** All declarations pass admission before any runner or candidate lane is constructed. */
    const declarations = pipelineDeclarations(ports.host, definitions)
    assertPipelineMode(ports.host, defaultOptions?.mode ?? MiddlewarePipelineMode.sync)
    this.#entries.set(
      DEFAULT_PIPELINE_KEY,
      new PluginHostPipeline(this, ports, DEFAULT_PIPELINE_KEY, defaultOptions ?? {}, true)
    )
    for (const declaration of declarations)
      this.#entries.set(
        declaration.key,
        new PluginHostPipeline(this, ports, declaration.key, declaration.options)
      )
  }

  /** Default methods use the same entry class and lifetime path as every named pipeline. */
  get default(): PluginHostPipeline<TDomainCore, TValue> {
    return this.#entries.get(DEFAULT_PIPELINE_KEY)!
  }
  /** Host mutation checks all concurrently active pipeline executions. */
  get depth(): number {
    return this.#depth
  }
  /** Actual executions enter once before canonical runner work begins. */
  enter(): void {
    this.#depth += 1
  }
  /** Canonical finally releases the exact execution's registration guard. */
  leave(): void {
    this.#depth -= 1
  }
  /** Terminal disposal seals each pipeline's distinct execution key in the shared tracker. */
  keys(): readonly object[] {
    return [...this.#entries.values()].map((entry) => entry.key)
  }

  /** Creates one isolated group during the original install transaction, before its Features. */
  prepare(
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): void {
    if (batch) {
      this.#contexts.set(registration, batch)
      /** Original batch identity binds domain-core requests to their exact candidate registration. */
      let issued = this.#batches.get(batch)
      if (!issued) this.#batches.set(batch, (issued = new Map()))
      issued.set(registration.name, registration)
    }
    if (this.#groups.has(registration)) return
    this.#readDependencyAccess(registration)
    /** All declarations pass admission before any runner or candidate lane is constructed. */
    const declarations = pipelineDeclarations(this.#ports.host, registration.plugin.pipelines)
    for (const { key } of declarations)
      if (
        this.#entries.has(key) ||
        this.#entries.has(qualifyPipelineName(registration.name, String(key)))
      )
        throw pipelineOptionError(
          this.#ports.host,
          PluginHostErrorCode.invalidPipelineOption,
          ERROR_TEXT.INVALID_PIPELINE_OPTION
        )
    /** Private lanes are indexed by short name for this exact registration generation. */
    const group = new Map<string, PluginHostPipeline<TDomainCore, TValue>>()
    this.#groups.set(registration, group)
    if (declarations.length === 0) return
    /** Native scope cleanup releases the captured group, including provisional install rollback. */
    this.#ports.ownCleanup(registration, () => this.#releaseGroup(registration, group))
    for (const { key, options } of declarations) {
      /** A unique lane key separates this private group from every other generation. */
      const laneKey = Symbol(qualifyPipelineName(registration.name, String(key)))
      /** Exact lane identity is retained for lookup, through edges and native cleanup. */
      const entry = new PluginHostPipeline(this, this.#ports, laneKey, options, false, registration)
      group.set(String(key), entry)
      this.#entries.set(laneKey, entry)
    }
  }

  /** Resolves one scope without exposing unpublished or retired groups to an external owner. */
  named(
    name: string,
    registration?: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>,
    feature?: string
  ): PluginHostPipeline<TDomainCore, TValue> {
    /** Host declarations take precedence over private short and qualified provider names. */
    const hostEntry = this.#entries.get(name)
    if (hostEntry) return hostEntry
    /** Own short-name lookup still requires the original registration availability guard. */
    const own = registration && this.#groups.get(registration)?.get(name)
    if (own && this.isAvailable(registration)) return own
    /**
     * Qualified lookup parses once, then both access and generation lookup use constant-time
     * indexes.
     */
    const [providerName, short] = splitPipelineAddress(name)
    /**
     * Registration definitions are immutable; the indexed access and diagnostic order share one
     * read.
     */
    const access = registration ? this.#readDependencyAccess(registration) : undefined
    /**
     * A plugin may address its declared providers only; Host owners retain their original
     * authority.
     */
    const permitted = !access || access.providers.has(providerName)
    /** Authorized provider resolution prefers this genuine candidate batch, then committed state. */
    const provider = permitted
      ? ((registration ? batch?.registrations.get(providerName) : undefined) ??
        this.#ports.registrations.get(providerName))
      : undefined
    /** Exact lane identity is retained for lookup, through edges and native cleanup. */
    const entry =
      provider &&
      provider.lifecycle !== PluginHostRegistrationLifecycle.dispose &&
      this.#groups.get(provider)?.get(short)
    if (entry) return entry
    /** Diagnostics scan visible names only on the exceptional unknown-name path. */
    const hostNames: string[] = []
    for (const key of this.#entries.keys()) if (typeof key === 'string') hostNames.push(key)
    /** Own group insertion order remains the declaration order. */
    const ownNames = registration ? [...(this.#groups.get(registration)?.keys() ?? [])] : []
    throw pipelineOptionError(
      this.#ports.host,
      PluginHostErrorCode.pipelineUnknown,
      ERROR_TEXT.PIPELINE_UNKNOWN(
        pipelineUnknownScope(registration?.name, feature),
        name,
        pipelineInventory(hostNames, ownNames, access?.dependencies ?? [])
      )
    )
  }

  /** Captures provider facts once; definitions cannot change during a registration generation. */
  #readDependencyAccess(registration: IRegistration<TDomainCore, TValue>): Readonly<{
    dependencies: readonly IPluginDependency[]
    providers: ReadonlySet<string>
  }> {
    /** Cached admission facts remain paired with the exact generation's immutable definition. */
    let access = this.#dependencyAccess.get(registration)
    if (!access) {
      /** Original traversal defines diagnostic order; the set supplies direct provider admission. */
      const dependencies = readDefinitionDependencies(registration.plugin)
      access = { dependencies, providers: new Set(dependencies.map(({ provider }) => provider)) }
      this.#dependencyAccess.set(registration, access)
    }
    return access
  }

  /** Native scope ownership removes exact group lanes and their originating graph entries once. */
  #releaseGroup(
    registration: IRegistration<TDomainCore, TValue>,
    group: ReadonlyMap<string, PluginHostPipeline<TDomainCore, TValue>>
  ): void {
    /** One collected key set lets the canonical lane collection remove this group in one pass. */
    const keys = new Set<PropertyKey>()
    for (const entry of group.values()) {
      keys.add(entry.laneKey)
      this.#edges.delete(entry)
      this.#entries.delete(entry.laneKey)
    }
    this.#ports.lanes.remove(keys)
    this.#groups.delete(registration)
    this.#dependencyAccess.delete(registration)
  }

  /** Availability follows the original install phase and committed generation identity. */
  isAvailable(registration: IRegistration<TDomainCore, TValue>): boolean {
    /** Original candidate context supplies availability only until publication commits. */
    const batch = this.#contexts.get(registration)
    return (
      !isRegistrationRevoked(registration) &&
      this.#groups.has(registration) &&
      registration.lifecycle !== PluginHostRegistrationLifecycle.dispose &&
      (this.#ports.registrations.get(registration.name) === registration ||
        (batch !== undefined &&
          !batch.committed &&
          batch.registrations.get(registration.name) === registration))
    )
  }

  /** The existing Host lookup can borrow only a genuine construction batch's exact registration. */
  owner(
    name: string,
    request?: import('./define-host.js').IHostCoreConstructionRequest
  ): PluginHostPipeline<TDomainCore, TValue>['owner'] {
    if (!request) return this.named(name).owner
    /** Only the issuing batch can lend its exact native registration to a domain-core request. */
    const registration = this.#batches.get(request.batch)?.get(request.pluginName)
    if (!registration || !this.isAvailable(registration))
      throw pipelineOptionError(
        this.#ports.host,
        PluginHostErrorCode.pipelineUnknown,
        ERROR_TEXT.PIPELINE_UNKNOWN(
          pipelinePluginScope(request.pluginName),
          name,
          PipelineAccessText.issuedConstructionBatch
        )
      )
    return this.named(name, registration, this.#contexts.get(registration)).owner
  }

  /** Registration-only facade borrows lookup and the exact caller's native stage owner. */
  registration(
    name: string,
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>,
    feature?: string
  ): object {
    /**
     * Explicit immutable context keeps the existing two public adapters independent from local
     * variables.
     */
    const context: IRegistrationPipelineContext<TDomainCore, TValue> = {
      owner: this,
      entry: this.named(name, registration, batch, feature),
      registration,
      batch,
      feature
    }
    return Object.freeze({
      use: (stage: Function) => context.entry.register(stage, context.registration),
      through: (target: string) =>
        context.owner.registerThrough(
          context.entry,
          context.owner.named(target, context.registration, context.batch, context.feature),
          context.registration
        )
    })
  }

  /** Admission walks existing edges once; execution uses only the canonical target runner. */
  registerThrough(
    source: PluginHostPipeline<TDomainCore, TValue>,
    target: PluginHostPipeline<TDomainCore, TValue>,
    registration: IRegistration<TDomainCore, TValue>
  ): IPipelineStageHandle {
    if (source.mode !== target.mode)
      throw attachPluginHostIdentity(
        new PluginHostError(
          PluginHostErrorCode.pipelineModeMismatch,
          ERROR_TEXT.PIPELINE_MODE_MISMATCH(source.mode, target.mode)
        ),
        this.#ports.host
      )
    if (
      target.next === MiddlewarePipelineNext.multiple &&
      source.next !== MiddlewarePipelineNext.multiple
    )
      throw pipelineOptionError(
        this.#ports.host,
        PluginHostErrorCode.invalidPipelineOption,
        ERROR_TEXT.INVALID_PIPELINE_OPTION
      )
    /** One cursor walk follows through edges without revisiting an already inspected source. */
    const pending = [target]
    /** Each lane is expanded once, making graph admission linear in reachable lanes and edges. */
    const visited = new Set<PluginHostPipeline<TDomainCore, TValue>>()
    for (const entry of pending) {
      if (entry === source)
        throw pipelineOptionError(
          this.#ports.host,
          PluginHostErrorCode.invalidPipelineOption,
          ERROR_TEXT.INVALID_PIPELINE_OPTION
        )
      if (visited.has(entry)) continue
      visited.add(entry)
      for (const next of this.#edges.get(entry)?.keys() ?? []) pending.push(next)
    }
    /** The bridge owns its target explicitly; native runner invocation stays unchanged. */
    const bridge = new PluginPipelineThrough(target)
    /** Generator sources retain their existing lift mode for the ordinary target bridge. */
    const kind =
      source.mode === MiddlewarePipelineMode.generator ? MiddlewarePipelineMode.sync : source.mode
    /** Native registration owns the exact bridge occurrence, including rollback and removal. */
    const handle = source.register(
      source.mode === MiddlewarePipelineMode.asyncGenerator
        ? (value: TValue) => bridge.forward(value)
        : (value: TValue, next: (value: TValue) => unknown) => target.run(value, next),
      registration,
      kind
    )
    /** Outgoing edge counts share exact stage lifetimes, including duplicate bridges. */
    let targets = this.#edges.get(source)
    if (!targets) this.#edges.set(source, (targets = new Map()))
    targets.set(target, (targets.get(target) ?? 0) + 1)
    /** One named occurrence owner retains idempotency and this exact edge table. */
    const removal = new PluginPipelineThroughRemoval(this.#edges, source, target, handle, targets)
    registration.pipelineDisposers.push(removal.remove)
    return Object.freeze({ remove: removal.remove })
  }
}

/**
 * Registration-only adapters retain one explicit lookup context while the collection owns all
 * mutable state.
 */
type IRegistrationPipelineContext<TDomainCore extends object, TValue> = Readonly<{
  owner: PluginHostPipelines<TDomainCore, TValue>
  entry: PluginHostPipeline<TDomainCore, TValue>
  registration: IRegistration<TDomainCore, TValue>
  batch: IInstallBatchContext<TDomainCore, TValue> | undefined
  feature: string | undefined
}>
