/**
 * Owns one pipeline lane and its runner forms; leases, pending work and depth remain with shared
 * owners.
 */
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
import type { StageLanes } from './stage-lanes.ts'
import type { IPipelineSpecOptions, IPipelineStageHandle } from './pipeline-spec.ts'
import type { IPipelinePorts, IPipelineCollectionPort } from './named-pipeline-types.ts'
import {
  createPluginHostPipelineViolationHandler,
  executePluginHostPipeline,
  registerPluginHostStage,
  ensurePluginHostStageSlot,
  type IPluginHostPipelineExecutionPort
} from './pipeline-runtime.ts'
import ERROR_TEXT, { PluginHostError, attachPluginHostIdentity } from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { PipelineOrder } from './pipeline-constants.ts'
import { pipelineOptionError } from './pipeline-declarations.ts'
import { PluginPipelineAsyncTerminal, combinePipelineFailures } from './pipeline-execution.ts'
import { pipelinePluginScope, PipelineAccessText } from './pipeline-text.ts'
import type { IRegistration } from './registry.ts'

/** One entry owns its runner forms and delegates all lease/index work to the canonical lane. */
export class PluginHostPipeline<TDomainCore extends object, TValue> {
  /** Registration and execution borrow the Host's one lifecycle and ordering context. */
  readonly #ports: IPipelinePorts<TValue>
  /** The shared collection supplies the cross-pipeline execution guard. */
  readonly #collection: IPipelineCollectionPort<TDomainCore, TValue>
  /** This lane alone caches this pipeline's visible revision. */
  readonly #lanes: StageLanes<TValue>
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
    collection: IPipelineCollectionPort<TDomainCore, TValue>,
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
            allocateSlot: () => ports.allocateSlot(),
            ensureSlot: (slot) => ports.lanes.ensureSlot(slot)
          },
          registration
        )
      )
    /** All runner forms keep the original Host cancellation and failure-combination policy. */
    const common = {
      onViolation: createPluginHostPipelineViolationHandler(ports.host, ports.diagnostic),
      assertActive: () => ports.assertActive(),
      signal: ports.signal,
      next: options.next,
      combineStageAndDownstreamError: combinePipelineFailures
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
      assertActive: () => this.#ports.assertActive(),
      retainLease: (snapshot) => this.#lanes.retainLeases(this.key, snapshot),
      enter: () => this.#collection.enter(),
      leave: () => this.#collection.leave(),
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
      use: (stage: Function) => this.#use(stage),
      run: (value: TValue, done: (value: TValue) => unknown) => this.run(value, done)
    })
  }

  /** A retained owner handle cannot revive its retired registration group. */
  #assertAdmission(): void {
    this.#ports.assertActive()
    if (this.registration && !this.#collection.isAvailable(this.registration))
      throw pipelineOptionError(
        this.#ports.host,
        PluginHostErrorCode.pipelineUnknown,
        ERROR_TEXT.PIPELINE_UNKNOWN(
          pipelinePluginScope(this.registration.name),
          String(this.laneKey),
          PipelineAccessText.currentRegistration
        )
      )
  }

  /** Host-owned registration commits the same shared publication revision after stage admission. */
  #use(stage: Function): IPipelineStageHandle {
    /** Stage handle retains the original exact-occurrence remover. */
    const handle = this.register(stage)
    this.#ports.commit()
    return handle
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
      /**
       * The canonical lane returns the exact stage occurrence remover used by explicit and native
       * cleanup.
       */
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
        allocateSlot: () => this.#ports.allocateSlot(),
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
    /**
     * This invocation retains the current immutable lane snapshot and its existing generation
     * leases.
     */
    const snapshot = this.#lanes.snapshot()
    /** A synchronous terminal writes the returned result; short-circuit leaves it undefined. */
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
      /**
       * This invocation retains the current immutable lane snapshot and its existing generation
       * leases.
       */
      const snapshot = this.#lanes.snapshot()
      /** A named result owner preserves last-terminal-wins without nested callback control flow. */
      const terminal = new PluginPipelineAsyncTerminal(done)
      return executePluginHostPipeline(
        execution,
        snapshot,
        value,
        (next) => terminal.accept(next),
        ordinary ? snapshot.asyncStages : snapshot.stages,
        () => terminal.result
      ) as Promise<Awaited<TResult> | undefined>
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
