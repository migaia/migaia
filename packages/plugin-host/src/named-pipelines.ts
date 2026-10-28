/** Owns every declared pipeline through one registration, runner and execution path. */
import {
  createPipeline,
  MiddlewarePipelineMode,
  MiddlewarePipelineNext,
  MiddlewarePipelineGeneratorSignals,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  type IMiddlewarePipeline,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage,
  type IAsyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { IPendingTracker } from '@migaia/lifecycle'
import {
  readPipelineSpec,
  type IPipelineDefinitions,
  type IPipelineSpecOptions,
  type IPipelineStageHandle
} from './pipeline-spec.js'
import { DEFAULT_PIPELINE_KEY, type StageLaneCollection, type StageLanes } from './stage-lanes.js'
import {
  createPluginHostPipelineViolationHandler,
  executePluginHostPipeline,
  registerPluginHostStage,
  ensurePluginHostStageSlot,
  type IPluginHostPipelineExecutionPort
} from './pipeline-runtime.js'
import ERROR_TEXT, {
  PluginHostError,
  attachPluginHostIdentity,
  tagPluginHostError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PipelineOrder } from './pipeline-constants.js'
import type { IPluginHostDiagnostic, IPipelineConfig } from './host-options-types.js'
import type { IPluginHostErrorCode } from './error-code.js'
import { isRegistrationRevoked, type IDataOrderSlotState } from './composition.js'
import { readDefinitionDependencies } from './dependency-reader.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IRegistration } from './registry.js'

/** The Host lends existing lifecycle, pending and ordering owners to every pipeline. */
type IPipelinePorts<TValue> = Readonly<{
  host: object
  signal: INativeAbortSignal
  pending: IPendingTracker
  lanes: StageLaneCollection<TValue>
  slots: Map<string, IDataOrderSlotState>
  allocateSlot(): bigint
  assertActive(): void
  /** Host-owned stage registration advances the original shared publication revision. */
  commit(): void
  /** Committed names remain the sole external publication boundary. */
  /** Reuses the native cleanup descriptor policy after original owner draining. */
  ownCleanup(registration: IRegistration<any, TValue>, cleanup: () => void): void
  registrations: ReadonlyMap<string, IRegistration<any, TValue>>
  diagnostic: IPluginHostDiagnostic
}>

/** One admitted declaration contains no running stage or lifetime state. */
type IPipelineDeclaration = Readonly<{
  key: PropertyKey
  options: IPipelineSpecOptions
}>

/** Native input errors preserve their TypeError family and exact issuing Host attribution. */
function pipelineOptionError(
  host: object | undefined,
  code: IPluginHostErrorCode,
  message: string,
  cause?: unknown
): TypeError {
  const error = tagPluginHostError(
    new TypeError(message, cause === undefined ? undefined : { cause }),
    code
  )
  return host ? attachPluginHostIdentity(error, host) : error
}

/** The finite supported mode domain is shared by default and named declarations. */
function assertPipelineMode(
  host: object | undefined,
  mode: unknown
): asserts mode is IMiddlewarePipelineMode {
  if (
    mode === MiddlewarePipelineMode.sync ||
    mode === MiddlewarePipelineMode.async ||
    mode === MiddlewarePipelineMode.generator ||
    mode === MiddlewarePipelineMode.asyncGenerator
  )
    return
  const error = new PluginHostError(
    PluginHostErrorCode.invalidPipelineMode,
    ERROR_TEXT.INVALID_PIPELINE_MODE
  )
  throw host ? attachPluginHostIdentity(error, host) : error
}

/** Validate the complete map before any named runner or lane is allocated. */
function pipelineDeclarations(
  host: object | undefined,
  definitions: IPipelineDefinitions | undefined
): readonly IPipelineDeclaration[] {
  if (definitions === undefined) return []
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions))
    throw pipelineOptionError(
      host,
      PluginHostErrorCode.invalidPipelineOption,
      ERROR_TEXT.INVALID_PIPELINE_OPTION
    )
  /** Only enumerable own string keys form public names; the default symbol stays private. */
  const declarations: IPipelineDeclaration[] = []
  for (const key of Object.keys(definitions)) {
    /** Descriptors keep invalid accessors out of the configuration snapshot. */
    const descriptor = Object.getOwnPropertyDescriptor(definitions, key)
    /** The factory's weak identity rejects structural copies of declarations. */
    const options =
      descriptor && 'value' in descriptor ? readPipelineSpec(descriptor.value) : undefined
    if (
      !key ||
      !options ||
      (options.order !== undefined &&
        options.order !== PipelineOrder.install &&
        options.order !== PipelineOrder.reverse)
    )
      throw pipelineOptionError(
        host,
        PluginHostErrorCode.invalidPipelineOption,
        ERROR_TEXT.INVALID_PIPELINE_OPTION
      )
    assertPipelineMode(
      host,
      options.mode === undefined ? MiddlewarePipelineMode.sync : options.mode
    )
    if (
      options.next !== undefined &&
      options.next !== MiddlewarePipelineNext.single &&
      options.next !== MiddlewarePipelineNext.multiple
    ) {
      try {
        /**
         * Canonical admission supplies the middleware INVALID_OPTION cause without creating a
         * runner.
         */
        createPipeline({ mode: MiddlewarePipelineMode.sync, next: options.next })
      } catch (cause) {
        throw pipelineOptionError(
          host,
          PluginHostErrorCode.invalidPipelineOption,
          ERROR_TEXT.INVALID_PIPELINE_OPTION,
          cause
        )
      }
    }
    declarations.push({ key, options })
  }
  return declarations
}

/** Captures supported declarations once without constructing runners or Host state. */
export function snapshotPipelineDefinitions(value: unknown): IPipelineDefinitions | undefined {
  if (value === undefined) return undefined
  const declarations = pipelineDeclarations(undefined, value as IPipelineDefinitions)
  const snapshot: Record<string, IPipelineDefinitions[string]> = Object.create(null)
  for (const declaration of declarations)
    snapshot[declaration.key as string] = Object.getOwnPropertyDescriptor(
      value,
      declaration.key
    )!.value
  return Object.freeze(snapshot)
}

/** One entry owns its runner forms and delegates all lease/index work to the canonical lane. */
class PluginHostPipeline<TDomainCore extends object, TValue> {
  /** Registration and execution borrow the Host's one lifecycle and ordering context. */
  readonly #ports: IPipelinePorts<TValue>
  /** The shared collection supplies the cross-pipeline execution guard. */
  readonly #collection: PluginHostPipelines<TDomainCore, TValue>
  /** This lane alone caches this pipeline's visible revision. */
  readonly #lanes: StageLanes<TValue>
  /** Admission checks are separate from the runner so retired in-flight snapshots can drain. */
  readonly #assertAdmission: () => void
  /** Lane identity is private to this exact group generation. */
  readonly laneKey: PropertyKey
  /** Construction fixes the runner mode for this entry. */
  readonly mode: IMiddlewarePipelineMode
  /** The unique pipeline execution key is sealed with every other entry at Host close. */
  readonly key: object
  /** Original next policy controls through compatibility without inspecting runner internals. */
  readonly next: MiddlewarePipelineNext
  /** A private group can expose its own candidate stages without publishing another generation. */
  readonly registration?: IRegistration<TDomainCore, TValue>
  /** One selected runner implements this entry's configured traversal and next policy. */
  readonly #runner: IMiddlewarePipeline<IMiddlewarePipelineMode, TValue>
  /** Legacy sync entry uses the same lane's original synchronous forms. */
  readonly #sync: IMiddlewarePipeline<IMiddlewarePipelineMode, TValue>
  /** Legacy async entry uses the same lane's lifted forms. */
  readonly #async: IMiddlewarePipeline<IMiddlewarePipelineMode, TValue>
  /** Fixed execution ports avoid rebuilding lifecycle callbacks on each run. */
  readonly #execution: IPluginHostPipelineExecutionPort<TValue>
  /** Default sync calls reuse one fixed execution descriptor without per-run allocation. */
  readonly #syncExecution: IPluginHostPipelineExecutionPort<TValue>
  /** Default async calls reuse the existing fixed descriptor and the same pending owner. */
  readonly #asyncExecution: IPluginHostPipelineExecutionPort<TValue>
  /** The Host owner's cached authority is separate from an installing plugin's registration view. */
  readonly owner: Readonly<{
    use(stage: Function): IPipelineStageHandle
    run(value: TValue, done: (value: TValue) => unknown): unknown
  }>

  /** Construct only after all declarations have passed structural and option admission. */
  constructor(
    collection: PluginHostPipelines<TDomainCore, TValue>,
    ports: IPipelinePorts<TValue>,
    key: PropertyKey,
    options: IPipelineSpecOptions,
    legacy = false,
    registration?: IRegistration<TDomainCore, TValue>
  ) {
    this.laneKey = key
    this.#collection = collection
    this.#ports = ports
    this.registration = registration
    this.key = {}
    this.next = options.next ?? MiddlewarePipelineNext.single
    this.mode = options.mode ?? MiddlewarePipelineMode.sync
    this.#lanes = ports.lanes.declare(
      key,
      options.order === PipelineOrder.reverse,
      registration?.pipelineOwnerKey
    )
    if (registration)
      this.#lanes.bindDefinition(
        registration,
        ensurePluginHostStageSlot(
          {
            host: ports.host,
            stageSlots: ports.slots,
            allocateSlot: ports.allocateSlot,
            ensureSlot: (slot) => ports.lanes.ensureSlot(slot)
          },
          registration
        )
      )
    /** A retained owner handle cannot revive a retired registration group. */
    this.#assertAdmission = (): void => {
      ports.assertActive()
      if (registration && !collection.isAvailable(registration))
        throw pipelineOptionError(
          ports.host,
          PluginHostErrorCode.pipelineUnknown,
          ERROR_TEXT.PIPELINE_UNKNOWN(
            `plugin ${registration.name}`,
            String(key),
            'current registration only'
          )
        )
    }
    /** All runner forms keep the original Host cancellation and failure-combination policy. */
    const common = {
      onViolation: createPluginHostPipelineViolationHandler(ports.host, ports.diagnostic),
      assertActive: ports.assertActive,
      signal: ports.signal,
      next: options.next,
      combineStageAndDownstreamError: (stageError: unknown, downstreamError: unknown) =>
        tagPluginHostError(
          new AggregateError(
            [stageError, downstreamError],
            ERROR_TEXT.PIPELINE_STAGE_AND_DOWNSTREAM_FAILED
          ),
          PluginHostErrorCode.pipelineFailed
        )
    }
    this.#runner = createPipeline<TValue, IMiddlewarePipelineMode>({ ...common, mode: this.mode })
    this.#sync =
      !legacy || this.mode === MiddlewarePipelineMode.sync
        ? this.#runner
        : createPipeline<TValue, IMiddlewarePipelineMode>({
            ...common,
            mode: MiddlewarePipelineMode.sync
          })
    this.#async =
      !legacy || this.mode === MiddlewarePipelineMode.async
        ? this.#runner
        : createPipeline<TValue, IMiddlewarePipelineMode>({
            ...common,
            mode: MiddlewarePipelineMode.async
          })
    this.#execution = {
      mode: this.mode,
      runner: this.#runner,
      assertActive: ports.assertActive,
      retainLease: (snapshot) => this.#lanes.retainLeases(this.key, snapshot),
      enter: () => collection.enter(),
      leave: () => collection.leave(),
      pending: ports.pending
    }
    this.#syncExecution = {
      ...this.#execution,
      mode: MiddlewarePipelineMode.sync,
      runner: this.#sync
    }
    this.#asyncExecution = {
      ...this.#execution,
      mode: MiddlewarePipelineMode.async,
      runner: this.#async
    }
    this.owner = Object.freeze({
      use: (stage: Function) => {
        const handle = this.register(stage)
        ports.commit()
        return handle
      },
      run: (value: TValue, done: (value: TValue) => unknown) => this.run(value, done)
    })
  }

  /** Native installs own their exact occurrence; host-owned stages obey the shared execution guard. */
  register(
    stage: Function,
    owner?: IRegistration<TDomainCore, TValue>,
    kind = this.mode
  ): IPipelineStageHandle {
    this.#assertAdmission()
    try {
      /** The selected canonical runner validates compatibility before a stage becomes visible. */
      const lifted = this.#runner.lift(stage as never, kind as never)
      const detach = registerPluginHostStage({
        host: this.#ports.host,
        depth: this.#collection.depth,
        stage: lifted,
        forms: {
          syncStage:
            kind === MiddlewarePipelineMode.sync
              ? (stage as ISyncMiddlewareStage<TValue>)
              : undefined,
          asyncStage:
            kind === MiddlewarePipelineMode.sync || kind === MiddlewarePipelineMode.async
              ? ((this.mode === MiddlewarePipelineMode.async
                  ? lifted
                  : this.#async.lift(
                      stage as never,
                      kind as never
                    )) as IAsyncMiddlewareStage<TValue>)
              : undefined
        },
        owner,
        lanes: this.#lanes,
        stageSlots: this.#ports.slots,
        allocateSlot: this.#ports.allocateSlot,
        ensureSlot: (slot) => this.#ports.lanes.ensureSlot(slot)
      })
      if (owner && this.registration === owner) this.#lanes.bindOwner(owner)
      return Object.freeze({ remove: detach })
    } catch (error) {
      if (
        error instanceof TypeError &&
        Reflect.get(error, 'code') === MiddlewarePipelineErrorCode.invalidOption &&
        Reflect.get(error, 'source') === MIDDLEWARE_PIPELINE_SOURCE
      )
        throw attachPluginHostIdentity(
          new PluginHostError(
            PluginHostErrorCode.pipelineModeMismatch,
            ERROR_TEXT.PIPELINE_MODE_MISMATCH(this.mode, kind),
            { cause: error }
          ),
          this.#ports.host
        )
      throw error instanceof PluginHostError
        ? attachPluginHostIdentity(error, this.#ports.host)
        : error
    }
  }

  /** Legacy explicit entries retain their existing generator-host refusal. */
  #ordinary(mode: IMiddlewarePipelineMode): void {
    if (
      this.mode === MiddlewarePipelineMode.generator ||
      this.mode === MiddlewarePipelineMode.asyncGenerator
    )
      throw attachPluginHostIdentity(
        new PluginHostError(
          PluginHostErrorCode.pipelineModeMismatch,
          ERROR_TEXT.PIPELINE_ENTRY_MODE_MISMATCH(this.mode, mode)
        ),
        this.#ports.host
      )
  }

  /** A selected-mode run shares exactly the same snapshot and lease execution path as default runs. */
  run(value: TValue, done: (value: TValue) => unknown): unknown {
    return this.mode === MiddlewarePipelineMode.async ||
      this.mode === MiddlewarePipelineMode.asyncGenerator
      ? this.#runAsync(value, done, this.#execution)
      : this.#runSync(value, done, this.#execution)
  }

  /** Legacy selected-mode execution preserves void results and its original asynchronous errors. */
  runVoid(value: TValue, done: (value: TValue) => void): void | Promise<void> {
    if (this.#lanes.size === 0) {
      if (
        this.mode === MiddlewarePipelineMode.async ||
        this.mode === MiddlewarePipelineMode.asyncGenerator
      ) {
        try {
          this.#assertAdmission()
          return Promise.resolve(done(value)).then(() => undefined)
        } catch (error) {
          return Promise.reject(error)
        }
      }
      this.#assertAdmission()
      done(value)
      return
    }
    return executePluginHostPipeline(this.#execution, this.#lanes.snapshot(), value, done)
  }

  /** Default synchronous entry preserves its old mixed-stage rejection before any terminal effect. */
  runSync<TResult>(value: TValue, done: (value: TValue) => TResult): TResult | undefined {
    this.#assertAdmission()
    this.#ordinary(MiddlewarePipelineMode.sync)
    if (this.#lanes.asyncStageCount > 0)
      throw attachPluginHostIdentity(
        new PluginHostError(
          PluginHostErrorCode.asyncStageInSyncEntry,
          ERROR_TEXT.ASYNC_STAGE_IN_SYNC_ENTRY
        ),
        this.#ports.host
      )
    return this.#runSync(value, done, this.#syncExecution, true)
  }

  /** Default async entry preserves empty-lane Promise identity and the original generator guard. */
  runAsync<TResult>(
    value: TValue,
    done: (value: TValue) => Promise<TResult>
  ): Promise<TResult | undefined> {
    try {
      this.#assertAdmission()
      this.#ordinary(MiddlewarePipelineMode.async)
      return this.#runAsync(value, done, this.#asyncExecution, true)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Empty lanes enter no runner/snapshot/lease; nonempty execution captures terminal output once. */
  #runSync<TResult>(
    value: TValue,
    done: (value: TValue) => TResult,
    execution: IPluginHostPipelineExecutionPort<TValue>,
    ordinary = false
  ): TResult | undefined {
    this.#assertAdmission()
    if (this.#lanes.size === 0) return done(value)
    const snapshot = this.#lanes.snapshot()
    let result: TResult | undefined
    executePluginHostPipeline(
      execution,
      snapshot,
      value,
      (next) => {
        result = done(next)
      },
      ordinary ? snapshot.syncStages : snapshot.stages
    )
    return result
  }

  /** Async terminal rejection and onion cleanup stay inside the canonical pending/lease lifetime. */
  #runAsync<TResult>(
    value: TValue,
    done: (value: TValue) => TResult,
    execution: IPluginHostPipelineExecutionPort<TValue>,
    ordinary = false
  ): Promise<Awaited<TResult> | undefined> {
    try {
      this.#assertAdmission()
      if (this.#lanes.size === 0)
        return ordinary
          ? (done(value) as Promise<Awaited<TResult> | undefined>)
          : Promise.resolve(done(value))
      const snapshot = this.#lanes.snapshot()
      /** The last terminal invocation owns its result even when earlier work settles later. */
      let result: { value?: Awaited<TResult> } | undefined
      return executePluginHostPipeline(
        execution,
        snapshot,
        value,
        (next) => {
          /** Only fulfillment is projected; the runner retains each original rejection. */
          const terminal: { value?: Awaited<TResult> } = {}
          result = terminal
          return Promise.resolve(done(next)).then((value) => {
            terminal.value = value
            return value
          })
        },
        ordinary ? snapshot.asyncStages : snapshot.stages,
        () => result?.value
      ) as Promise<Awaited<TResult> | undefined>
    } catch (error) {
      return Promise.reject(error)
    }
  }
}

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
      let issued = this.#batches.get(batch)
      if (!issued) this.#batches.set(batch, (issued = new Map()))
      issued.set(registration.name, registration)
    }
    if (this.#groups.has(registration)) return
    const declarations = pipelineDeclarations(this.#ports.host, registration.plugin.pipelines)
    for (const { key } of declarations)
      if (this.#entries.has(key) || this.#entries.has(`${registration.name}.${String(key)}`))
        throw pipelineOptionError(
          this.#ports.host,
          PluginHostErrorCode.invalidPipelineOption,
          ERROR_TEXT.INVALID_PIPELINE_OPTION
        )
    const group = new Map<string, PluginHostPipeline<TDomainCore, TValue>>()
    this.#groups.set(registration, group)
    if (declarations.length === 0) return
    /** The existing scope runs after owner lease draining on success and during rollback on failure. */
    const cleanup = (): void => {
      const keys = new Set<PropertyKey>()
      for (const entry of group.values()) {
        keys.add(entry.laneKey)
        this.#edges.delete(entry)
        this.#entries.delete(entry.laneKey)
      }
      this.#ports.lanes.remove(keys)
      this.#groups.delete(registration)
    }
    this.#ports.ownCleanup(registration, cleanup)
    for (const { key, options } of declarations) {
      const laneKey = Symbol(`${registration.name}.${String(key)}`)
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
    const hostEntry = this.#entries.get(name)
    if (hostEntry) return hostEntry
    const own = registration && this.#groups.get(registration)?.get(name)
    if (own && this.isAvailable(registration)) return own
    const dot = name.indexOf('.')
    const providerName = dot < 0 ? '' : name.slice(0, dot)
    const short = dot < 0 ? '' : name.slice(dot + 1)
    const dependencies = registration ? readDefinitionDependencies(registration.plugin) : []
    const permitted =
      !registration || dependencies.some(({ provider }) => provider === providerName)
    const provider = permitted
      ? ((registration ? batch?.registrations.get(providerName) : undefined) ??
        this.#ports.registrations.get(providerName))
      : undefined
    const entry =
      provider && provider.lifecycle !== 'dispose' && this.#groups.get(provider)?.get(short)
    if (entry) return entry
    const hostNames = [...this.#entries.keys()].filter(
      (key): key is string => typeof key === 'string'
    )
    const ownNames = registration ? [...(this.#groups.get(registration)?.keys() ?? [])] : []
    throw pipelineOptionError(
      this.#ports.host,
      PluginHostErrorCode.pipelineUnknown,
      ERROR_TEXT.PIPELINE_UNKNOWN(
        feature
          ? `feature ${registration?.name}.${feature}`
          : registration
            ? `plugin ${registration.name}`
            : 'Host',
        name,
        `host [${hostNames.join(', ')}]; own [${ownNames.join(', ')}]; dependencies [${dependencies.map(({ provider }) => `${provider}.*`).join(', ')}]`
      )
    )
  }

  /** Availability follows the original install phase and committed generation identity. */
  isAvailable(registration: IRegistration<TDomainCore, TValue>): boolean {
    const batch = this.#contexts.get(registration)
    return (
      !isRegistrationRevoked(registration) &&
      this.#groups.has(registration) &&
      registration.lifecycle !== 'dispose' &&
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
    const registration = this.#batches.get(request.batch)?.get(request.pluginName)
    if (!registration || !this.isAvailable(registration))
      throw pipelineOptionError(
        this.#ports.host,
        PluginHostErrorCode.pipelineUnknown,
        ERROR_TEXT.PIPELINE_UNKNOWN(
          `plugin ${request.pluginName}`,
          name,
          'issued construction batch only'
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
    const entry = this.named(name, registration, batch, feature)
    return Object.freeze({
      use: (stage: Function) => entry.register(stage, registration),
      through: (target: string) =>
        this.#through(entry, this.named(target, registration, batch, feature), registration)
    })
  }

  /** Admission walks existing edges once; execution uses only the canonical target runner. */
  #through(
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
    const pending = [target]
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
    /** Generator traversal has no next callback; its one submitted terminal value continues y. */
    const bridge =
      source.mode === MiddlewarePipelineMode.asyncGenerator
        ? async function* (value: TValue) {
            let forwarded = false
            let result: TValue | undefined
            await target.run(value, (next) => {
              forwarded = true
              result = next
            })
            if (!forwarded) return
            return result === undefined ? MiddlewarePipelineGeneratorSignals.undefined : result
          }
        : (value: TValue, next: (value: TValue) => unknown) => target.run(value, next)
    const kind =
      source.mode === MiddlewarePipelineMode.generator ? MiddlewarePipelineMode.sync : source.mode
    const handle = source.register(bridge, registration, kind)
    let targets = this.#edges.get(source)
    if (!targets) this.#edges.set(source, (targets = new Map()))
    targets.set(target, (targets.get(target) ?? 0) + 1)
    let alive = true
    const remove = (): void => {
      if (!alive) return
      alive = false
      handle.remove()
      const remaining = targets!.get(target)! - 1
      if (remaining) targets!.set(target, remaining)
      else targets!.delete(target)
      if (targets!.size === 0) this.#edges.delete(source)
    }
    registration.pipelineDisposers.push(remove)
    return Object.freeze({ remove })
  }
}
