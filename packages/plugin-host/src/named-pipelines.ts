/** Owns every declared pipeline through one registration, runner and execution path. */
import {
  createPipeline,
  MiddlewarePipelineMode,
  MiddlewarePipelineNext,
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
  type IPipelineSpecOptions
} from './pipeline-spec.js'
import { DEFAULT_PIPELINE_KEY, type StageLaneCollection, type StageLanes } from './stage-lanes.js'
import {
  createPluginHostPipelineViolationHandler,
  executePluginHostPipeline,
  registerPluginHostStage,
  type IPluginHostPipelineExecutionPort
} from './pipeline-runtime.js'
import ERROR_TEXT, {
  PluginHostError,
  attachPluginHostIdentity,
  tagPluginHostError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PipelineOrder } from './pipeline-constants.js'
import type { IPluginHostDiagnostic, IPipelineConfig, IPluginHostErrorCode } from './typing.js'
import type { IDataOrderSlotState } from './composition.js'
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
  diagnostic: IPluginHostDiagnostic
}>

/** One admitted declaration contains no running stage or lifetime state. */
type IPipelineDeclaration = Readonly<{
  key: PropertyKey
  options: IPipelineSpecOptions
}>

/** Native input errors preserve their TypeError family and exact issuing Host attribution. */
function pipelineOptionError(
  host: object,
  code: IPluginHostErrorCode,
  message: string,
  cause?: unknown
): TypeError {
  return attachPluginHostIdentity(
    tagPluginHostError(new TypeError(message, cause === undefined ? undefined : { cause }), code),
    host
  )
}

/** The finite supported mode domain is shared by default and named declarations. */
function assertPipelineMode(host: object, mode: unknown): asserts mode is IMiddlewarePipelineMode {
  if (
    mode === MiddlewarePipelineMode.sync ||
    mode === MiddlewarePipelineMode.async ||
    mode === MiddlewarePipelineMode.generator ||
    mode === MiddlewarePipelineMode.asyncGenerator
  )
    return
  throw attachPluginHostIdentity(
    new PluginHostError(PluginHostErrorCode.invalidPipelineMode, ERROR_TEXT.INVALID_PIPELINE_MODE),
    host
  )
}

/** Validate the complete map before any named runner or lane is allocated. */
function pipelineDeclarations(
  host: object,
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

/** One entry owns its runner forms and delegates all lease/index work to the canonical lane. */
class PluginHostPipeline<TDomainCore extends object, TValue> {
  /** Registration and execution borrow the Host's one lifecycle and ordering context. */
  readonly #ports: IPipelinePorts<TValue>
  /** The shared collection supplies the cross-pipeline execution guard. */
  readonly #collection: PluginHostPipelines<TDomainCore, TValue>
  /** This lane alone caches this pipeline's visible revision. */
  readonly #lanes: StageLanes<TValue>
  /** Construction fixes the runner mode for this entry. */
  readonly mode: IMiddlewarePipelineMode
  /** The unique pipeline execution key is sealed with every other entry at Host close. */
  readonly key = {}
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
    use(stage: Function): void
    run(value: TValue, done: (value: TValue) => unknown): unknown
  }>

  /** Construct only after all declarations have passed structural and option admission. */
  constructor(
    collection: PluginHostPipelines<TDomainCore, TValue>,
    ports: IPipelinePorts<TValue>,
    key: PropertyKey,
    options: IPipelineSpecOptions,
    legacy = false
  ) {
    this.#collection = collection
    this.#ports = ports
    this.mode = options.mode ?? MiddlewarePipelineMode.sync
    this.#lanes = ports.lanes.declare(key, options.order === PipelineOrder.reverse)
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
        this.register(stage)
        ports.commit()
      },
      run: (value: TValue, done: (value: TValue) => unknown) => this.run(value, done)
    })
  }

  /** Native installs own their exact occurrence; host-owned stages obey the shared execution guard. */
  register(stage: Function, owner?: IRegistration<TDomainCore, TValue>, kind = this.mode): void {
    this.#ports.assertActive()
    try {
      /** The selected canonical runner validates compatibility before a stage becomes visible. */
      const lifted = this.#runner.lift(stage as never, kind as never)
      registerPluginHostStage({
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
          this.#ports.assertActive()
          return Promise.resolve(done(value)).then(() => undefined)
        } catch (error) {
          return Promise.reject(error)
        }
      }
      this.#ports.assertActive()
      done(value)
      return
    }
    return executePluginHostPipeline(this.#execution, this.#lanes.snapshot(), value, done)
  }

  /** Default synchronous entry preserves its old mixed-stage rejection before any terminal effect. */
  runSync<TResult>(value: TValue, done: (value: TValue) => TResult): TResult | undefined {
    this.#ports.assertActive()
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
      this.#ports.assertActive()
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
    this.#ports.assertActive()
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
      this.#ports.assertActive()
      if (this.#lanes.size === 0)
        return ordinary
          ? (done(value) as Promise<Awaited<TResult> | undefined>)
          : Promise.resolve(done(value))
      const snapshot = this.#lanes.snapshot()
      /** The terminal's own return value; the runner awaits it, so no extra async wrapper. */
      let result: TResult | undefined
      const completion = executePluginHostPipeline(
        execution,
        snapshot,
        value,
        (next) => {
          result = done(next)
          return result as unknown as void
        },
        ordinary ? snapshot.asyncStages : snapshot.stages
      ) as Promise<void>
      return completion.then(() => result as Awaited<TResult> | undefined)
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
  /** Only construction can change the declared set. */
  readonly #entries = new Map<PropertyKey, PluginHostPipeline<TDomainCore, TValue>>()
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

  /** Lookups do not allocate new pipelines or confer execution authority on installing plugins. */
  named(name: string): PluginHostPipeline<TDomainCore, TValue> {
    const entry = this.#entries.get(name)
    if (!entry)
      throw pipelineOptionError(
        this.#ports.host,
        PluginHostErrorCode.pipelineUnknown,
        ERROR_TEXT.PIPELINE_UNKNOWN
      )
    return entry
  }
}
