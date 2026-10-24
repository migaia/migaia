import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import {
  createRpcAbortError,
  createRpcError,
  createRpcTimeoutError,
  isLocalRpcError,
  localRpcErrorCode,
  RpcAbortError,
  RpcCoreErrorCode
} from '../../errors.js'
import {
  checkRpcStreamInitialSequence,
  checkRpcStreamSequence,
  checkRpcStreamProgress,
  checkRpcStreamConsumerCredit,
  checkRpcStreamProducerCredit,
  checkRpcRuntimeStreamFinish
} from '@migaia/rpc-contract/stream'
import { normalizePortable } from '@migaia/rpc-contract'
import {
  createOutboundEnvelope,
  retainForwardOptions,
  readForwardRoute
} from '../outbound-envelope.js'
import {
  retainProviderPreflight,
  retainProviderFailureRoute,
  readProviderStreamAdmission,
  type ProviderRegistry,
  type IProviderSessionPolicy
} from '../provider.js'
import {
  normalizeStreamPayload,
  RpcEnvelopeKind,
  RpcRouteProfile,
  RpcStreamEvent,
  type IRpcEnvelope,
  type IRpcPortableValue,
  type IRpcStreamPayload
} from '@migaia/rpc-contract'
import { deserializeRpcError, serializeRpcError } from '../error-wire-metadata.js'

import { RpcCoreErrorText } from '../../error-text.js'
import { RpcStreamErrorText } from './error-text.js'
import { EndpointOwnerKey, type IEndpointKernelHost } from '../../endpoint-kernel.js'
import type {
  IRpcStreamCapabilityPort,
  IRpcStreamRun,
  IRpcStreamRuntime
} from '../../features/stream.js'
import type { IPreparedEndpoint } from '../endpoint-bootstrap.js'
import { allocateRpcId } from '../id.js'
import { OperationScope } from '../operation-scope.js'
import type { IRpcFrameAdmission, IRpcOutboundOperationsPort } from '../plugin-shared-keys.js'
import { tupleKey } from '../safe-value.js'
import { resolveAbortReason } from '../async-control.js'
import { authenticationReplyReceiverId } from '../authentication-replay.js'
import type { IEndpointTimer } from '../time-port.js'
import type { IRpcContext } from '../../typing.js'
import { RpcStreamLimit } from '@migaia/rpc-contract'
import type { IProviderRuntimeStream } from '../provider.js'
import type { RpcOutboundAttachment, IRpcRuntimeSendOptions } from '../outbound-attachment.js'
import type { IInboundIdentityAdmission } from '../inbound-identity.js'
import type { IRpcRuntimeEnvelope, IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type { IRpcRuntimeTask } from '@migaia/rpc-contract/runtime'
import {
  RpcRuntimeKind,
  RpcRuntimeOperation,
  RpcRuntimeProfile,
  RpcRuntimeCancel,
  RpcRuntimeFinish,
  RpcRuntimeField
} from '@migaia/rpc-contract/framing/v1'

/** Only the exact opt-in consumer retains its existing lazy open/ready operation for a relay. */
const runtimeStreamReady = new WeakMap<
  AsyncIterableIterator<IRpcPortableValue>,
  () => Promise<void>
>()

/** Keep the existing managed facade's preparation tied to its sole original downstream consumer. */
export function retainRuntimeStreamPreparation<T extends AsyncIterableIterator<IRpcPortableValue>>(
  facade: T,
  prepare: () => Promise<void>
): T {
  runtimeStreamReady.set(facade, prepare)
  return facade
}

/** Prepare the same downstream consumer without issuing a pull or creating another iterator. */
export function prepareRuntimeStreamConsumer(
  iterator: AsyncIterableIterator<IRpcPortableValue>
): Promise<void> {
  /** Descriptor copies cannot prepare the original consumer's private stream resource. */
  const prepare = runtimeStreamReady.get(iterator)
  if (!prepare)
    throw createRpcError(
      RpcCoreErrorCode.capabilityUnsupported,
      RpcCoreErrorText.capabilityUnsupported
    )
  return prepare()
}

/** Opt-in metadata stays on the original consumer, including its one final settlement. */
type IRuntimeConsumer = {
  readonly task: IRpcRuntimeTask
  readonly options: IRpcRuntimeSendOptions
  /** The original native binding retains this consumer until its existing terminal selection. */
  releaseAdmission?: () => void
  /** Retains the actual original receiver-preparation promise, independently of physical completion. */
  prepared?: Promise<IRpcRuntimeEnvelope>
  envelope?: IRpcRuntimeEnvelope
  finishing?: Promise<IteratorResult<IRpcPortableValue>>
  resolveFinal?: (result: IteratorResult<IRpcPortableValue>) => void
  rejectFinal?: (error: unknown) => void
}

/** One pending caller pull; the enclosing state owns settlement and its sequence. */
type IConsumerPull = {
  readonly resolve: (result: IteratorResult<IRpcPortableValue>) => void
  readonly reject: (reason: unknown) => void
}

/** Caller state is keyed by the selected target and the initial request id. */
type IConsumerState = {
  /** Only an opted-in stream retains generation identity and final-return settlement. */
  runtime?: IRuntimeConsumer
  /** Only an originally admitted open reply can select the exact source-less stream receiver. */
  receiverId?: string
  readonly id: string
  readonly targetId: string
  readonly method: string
  readonly scope: OperationScope
  readonly timeoutMs: number | undefined
  readonly ready: Promise<void>
  readonly resolveReady: () => void
  readonly rejectReady: (reason: unknown) => void
  openSend?: Promise<void>
  timer?: IEndpointTimer
  removeAbort?: () => void
  seq: number
  pending?: IConsumerPull
  pullAdmission?: AbortController
  terminal?:
    | { readonly done: true; readonly value?: IRpcPortableValue }
    | { readonly error: unknown }
}

/** A sent cancel retains only its sequence and cleanup result until peer acknowledgement. */
type IPendingCancel = {
  /** A disconnected routed session releases only its own outstanding cancel acknowledgement. */
  readonly targetId: string
  readonly seq: number
  readonly resolve: (cleanupError?: unknown) => void
  settled?: boolean
}

/** Producer state is keyed by admitted sender and id, never by method alone. */
type IProducerState = {
  /** Original native quota/drain cleanup stays attached to this producer's existing lifetime. */
  nativeSettlement?: (succeeded: boolean) => void
  /** The admitted session's result projection borrows this producer's exact original context. */
  readonly nativeResult?: Readonly<{
    project: NonNullable<IProviderSessionPolicy['streamResult']>
    context: IRpcContext
  }>
  /** Only actual iterator.done establishes successful native policy settlement. */
  nativeSucceeded?: boolean
  /** The final executor supplies admission/start/seal authority to this same iterator owner. */
  readonly runtime?: IProviderRuntimeStream
  /** Finish switches this original single-credit loop to discard, never another producer. */
  discard?: boolean
  /** The admitted request's signed reply identity survives terminal removal from the producer Map. */
  readonly receiverId?: string
  /** The admitted immutable node route accompanies failures from later iterator pulls. */
  readonly route?: readonly string[]
  /** Protected stream admission waits until all next/return/write work actually finishes. */
  readonly lifetime?: {
    /** Counts only operations already started for this exact producer, independent of Map deletion. */
    pending: number
    /** Completes at terminal with no remaining operation, retaining the stream-open replay entry. */
    readonly settled: Promise<void>
    /** Promise resolution is idempotent and never aborts or recreates the stream. */
    readonly resolve: () => void
  }
  readonly id: string
  readonly senderId: string
  readonly iterator: AsyncIterator<IRpcPortableValue> | Iterator<IRpcPortableValue>
  readonly scope: OperationScope
  timer?: IEndpointTimer
  itemAdmission?: AbortController
  seq: number
  busy: boolean
  terminal: boolean
}

/** The one optional stream owner attached to a composed endpoint kernel. */
export class RpcStreamOwner implements IRpcStreamRuntime {
  /** One lazy iterator owns its original operation state and serial next tail. */
  static readonly #ConsumerIterator = class {
    /** The canonical stream feature retains registries, transport and endpoint lifetime. */
    // eslint-disable-next-line no-unused-private-class-members -- Consumer methods read canonical private feature operations below.
    readonly #owner: RpcStreamOwner
    /** Target identity remains fixed before the first lazy open. */
    readonly #targetId: string
    /** Provider method is admitted only when the original iterator starts. */
    readonly #method: string
    /** Original payload is retained without copying or eager normalization. */
    readonly #params: unknown
    /** Caller options keep their original object identity and lazy reads. */
    readonly #options: IRpcRuntimeSendOptions | undefined
    /** Opt-in generation retains the exact accepted provider identity. */
    readonly #generation: IRpcRuntimeGeneration | undefined
    /** The one actual consumer is absent until its original first start. */
    #state: IConsumerState | undefined
    /** Sticky failure/return before opening prevents a later queued next from starting. */
    #unopenedTerminal: IConsumerState['terminal']
    /** The original Promise chain serializes caller next operations only. */
    #tail = Promise.resolve<unknown>(undefined)
    /** Public shape stays a frozen own-method plain object with its original iterator identity. */
    readonly value: AsyncIterableIterator<IRpcPortableValue>

    /** Capture lazy inputs and publish the original ready seam without opening a stream. */
    constructor(
      owner: RpcStreamOwner,
      targetId: string,
      method: string,
      params: unknown,
      options?: IRpcRuntimeSendOptions,
      generation?: IRpcRuntimeGeneration
    ) {
      this.#owner = owner
      this.#targetId = targetId
      this.#method = method
      this.#params = params
      this.#options = options
      this.#generation = generation
      /** Each own callback delegates to this same iterator's actual state, never another tail. */
      const iterator = {
        next: this.#next,
        return: (value?: IRpcPortableValue) => this.#close(value),
        throw: (reason?: unknown) => this.#close(reason, true),
        [Symbol.asyncIterator]() {
          return this
        }
      }
      if (generation) runtimeStreamReady.set(iterator, this.#ready)
      this.value = Object.freeze(iterator)
    }

    /** Append one original next operation and return its exact task Promise. */
    readonly #next = (): Promise<IteratorResult<IRpcPortableValue>> => {
      /**
       * This exact queued next Promise is returned to the caller and retained by the original
       * serial tail.
       */
      const task = this.#tail.then(async () => {
        if (this.#unopenedTerminal) return this.#terminalResult(this.#unopenedTerminal)
        if (!this.#state) {
          try {
            this.#state = this.#start(
              this.#targetId,
              this.#method,
              this.#params,
              this.#options,
              this.#generation
            )
          } catch (error) {
            this.#unopenedTerminal = { error }
            throw error
          }
        }
        return this.#pull(this.#state)
      })
      this.#tail = task.then(
        () => undefined,
        () => undefined
      )
      return task
    }
    /** Return or throw preserves the original cleanup aggregation and runtime final Promise. */
    async #close(value?: unknown, thrown = false): Promise<IteratorResult<IRpcPortableValue>> {
      if (!this.#state) this.#unopenedTerminal = { done: true }
      if (this.#state?.runtime) {
        /**
         * Ordinary return after local terminal keeps legacy cleanup semantics; next keeps its
         * error.
         */
        if (
          !thrown &&
          this.#state.terminal &&
          this.#state.runtime.options.cancel !== RpcRuntimeCancel
        )
          return { done: true, value: value as IRpcPortableValue }
        try {
          /** Return observes the same actual producer terminal, including concurrent callers. */
          const result = await this.#finishRuntimeConsumer(this.#state, thrown ? value : undefined)
          if (thrown) throw value
          return result
        } catch (error) {
          if (thrown && error !== value)
            throw new AggregateError([value, error], RpcStreamErrorText.cleanupFailed)
          throw error
        }
      }
      /** Retain iterator cleanup failure separately so a thrown primary value remains reachable. */
      const cleanup = this.#state
        ? await this.#owner.#cancelConsumer(this.#state, { done: true }, thrown ? value : undefined)
        : undefined
      if (cleanup !== undefined) {
        if (thrown) throw new AggregateError([value, cleanup], RpcStreamErrorText.cleanupFailed)
        throw cleanup
      }
      if (thrown) throw value
      return { done: true, value: value as IRpcPortableValue }
    }

    /** Ready observes the same actual consumer and preserves the cached original ready Promise. */
    readonly #ready = (): Promise<void> => {
      if (!this.#state) {
        try {
          this.#state = this.#start(
            this.#targetId,
            this.#method,
            this.#params,
            this.#options,
            this.#generation
          )
        } catch (error) {
          this.#unopenedTerminal = { error }
          throw error
        }
      }
      return this.#state.ready
    }

    /** Allocate the sole operation scope and issue the initial request through outbound. */
    #start(
      targetId: string,
      method: string,
      params: unknown,
      options?: IRpcRuntimeSendOptions,
      generation?: IRpcRuntimeGeneration
    ): IConsumerState {
      if (this.#owner.#capability && !this.#owner.#capability.supports(targetId))
        throw createRpcError(
          RpcCoreErrorCode.capabilityConflict,
          RpcStreamErrorText.capabilityMissing
        )
      if (options?.signal?.aborted) throw readStreamAbortReason(options.signal)
      /** The original stream identity keys this consumer or producer admission only. */
      const id = allocateRpcId(
        this.#owner.#outbound.defaultGenerate
          ? {
              ...this.#owner.#prepared.options.uuid,
              generate: this.#owner.#outbound.defaultGenerate
            }
          : (this.#owner.#prepared.options.uuid ?? {}),
        'task',
        this.#owner.#prepared.id,
        targetId,
        (candidate) => this.#owner.#consumers.has(tupleKey(targetId, candidate))
      )
      /** The original scope fences this operation lifetime and its inherited cancellation. */
      const scope = new OperationScope(
        this.#owner.#kernel.generation,
        options?.timeoutMs,
        this.#owner.#kernel.closingSignal,
        () => this.#owner.#kernel.time.now()
      )
      /** The single original ready Promise resolves only after the matching open frame. */
      let resolveReady!: () => void
      /** The single original ready Promise retains its exact terminal failure identity. */
      let rejectReady!: (reason: unknown) => void
      /** Publish one original open acknowledgement Promise for this exact consumer lifetime. */
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      /** This existing operation context remains the sole owner of sequence and terminal facts. */
      const state: IConsumerState = {
        id,
        targetId,
        method,
        scope,
        timeoutMs: options?.timeoutMs === false ? undefined : options?.timeoutMs,
        ready,
        resolveReady,
        rejectReady,
        seq: 0
      }
      if (generation) {
        /** The existing outbound replay registry supplies the sole bounded task reservation. */
        const outbound = this.#owner.#runtimeOutbound()
        /** Validation occurs before publishing the original consumer state. */
        let reserved: ReturnType<RpcOutboundAttachment['reserveRuntimeStream']>
        try {
          reserved = outbound.reserveRuntimeStream(id, generation, method, options ?? {})
        } catch (error) {
          scope.abort(error)
          throw error
        }
        state.runtime = { task: reserved.task, options: options ?? {} }
        state.runtime.prepared = outbound
          .prepareRuntimeStreamOpen(
            id,
            targetId,
            reserved.task,
            reserved.options,
            params as IRpcPortableValue | undefined,
            readForwardRoute(options)
          )
          .then((envelope) => {
            state.runtime!.envelope = envelope
            return envelope
          })
        state.openSend = state.runtime.prepared.then((envelope) => {
          return outbound.sendRuntimeFrame(
            envelope,
            {
              queueSignal: scope.signal,
              assertCanSend: () => scope.assertActive(this.#owner.#kernel.generation)
            },
            undefined,
            state.runtime!.options
          )
        })
      }
      this.#owner.#consumers.set(tupleKey(targetId, id), state)
      if (state.runtime) {
        /** Shared Host targets select their own native drain; standalone endpoints retain one owner. */
        const registry = this.#owner.#kernel.readOwner(EndpointOwnerKey.providerRegistry) as
          | ProviderRegistry
          | undefined
        state.runtime.releaseAdmission = registry?.sessionPolicy
          ? registry.sessionPolicy(targetId)?.enterStreamConsumer?.()
          : this.#owner.#runtimeConsumerAdmission?.()
      }
      state.openSend ??= Promise.resolve().then(() =>
        this.#owner.#outbound.send(
          retainForwardOptions(options, {
            kind: 'stream-open',
            id,
            targetId,
            method,
            data: params,
            timeoutMs: options?.timeoutMs === false ? undefined : options?.timeoutMs,
            operation: {
              signal: scope.signal,
              remaining: () => scope.remaining(options?.timeoutMs)
            }
          })
        )
      )
      void state.openSend.catch((error) => {
        if (!state.terminal)
          this.#owner.#finishConsumer(state, { error: this.#owner.#sendFailureReason(error) })
      })
      if (options?.timeoutMs !== undefined && options.timeoutMs !== false) {
        state.timer = this.#owner.#kernel.time.setTimeout(() => {
          void this.#owner.#cancelConsumer(state, { error: createRpcTimeoutError() })
        }, options.timeoutMs)
      }
      if (options?.signal) {
        /** Remove only this consumer abort listener when its original lifetime retires. */
        const onAbort = (): void => {
          void this.#owner.#cancelConsumer(state, { error: readStreamAbortReason(options.signal!) })
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        state.removeAbort = () => options.signal!.removeEventListener('abort', onAbort)
      }
      return state
    }

    /** Send exactly one pull for each awaited caller next and settle it from the matching frame. */
    async #pull(state: IConsumerState): Promise<IteratorResult<IRpcPortableValue>> {
      if (state.terminal) return this.#terminalResult(state.terminal, state.runtime !== undefined)
      await state.ready
      if (state.terminal) return this.#terminalResult(state.terminal, state.runtime !== undefined)
      return new Promise<IteratorResult<IRpcPortableValue>>((resolve, reject) => {
        state.pending = { resolve, reject }
        /** This exact credit keeps its own abort admission across reentrant physical sends. */
        const admission = new AbortController()
        state.pullAdmission = admission
        /** Snapshot only the original held credit so later reentry cannot consume or clear it. */
        const seq = state.seq
        void this.#owner.#sendFrame(
          state.targetId,
          state.id,
          {
            event: RpcStreamEvent.pull,
            seq: state.seq
          },
          {
            queueSignal: admission.signal,
            assertCanSend: () => {
              this.#owner.#kernel.assertActive()
              if (state.terminal || !state.pending || state.seq !== seq) throw createRpcAbortError()
            }
          },
          state.receiverId,
          state.runtime?.envelope
        ).catch((error) => {
          if (state.terminal) return
          void this.#owner.#cancelConsumer(
            state,
            { error: this.#owner.#sendFailureReason(error) },
            error
          )
        })
      })
    }

    /** Return sticky terminal completion or throw the original terminal error instance. */
    #terminalResult(
      terminal: NonNullable<IConsumerState['terminal']>,
      retainValue = false
    ): IteratorResult<IRpcPortableValue> {
      if ('error' in terminal) throw terminal.error
      return { done: true, value: retainValue ? terminal.value : undefined }
    }

    /** One original consumer final promise merges repeated return and concurrent next/finish. */
    #finishRuntimeConsumer(
      state: IConsumerState,
      reason?: unknown
    ): Promise<IteratorResult<IRpcPortableValue>> {
      /** This method is entered only by a genuinely selected runtime profile. */
      const runtime = state.runtime!
      if (runtime.finishing) return runtime.finishing
      runtime.finishing = new Promise((resolve, reject) => {
        runtime.resolveFinal = resolve
        runtime.rejectFinal = reject
      })
      if (state.terminal) {
        if ('error' in state.terminal) runtime.rejectFinal!(state.terminal.error)
        else runtime.resolveFinal!({ done: true, value: state.terminal.value })
      } else {
        void runtime.prepared
          ?.then(() =>
            this.#owner.#sendRuntimeIntent(
              state,
              reason === undefined
                ? undefined
                : serializeRpcError(reason, {
                    report: (failure) => this.#owner.#report(failure.error)
                  }),
              runtime.options.cancel === RpcRuntimeCancel
            )
          )
          .catch((error: unknown) => this.#owner.#finishConsumer(state, { error }))
      }
      return runtime.finishing
    }
  }

  /** One producer control record owns its original finish/cancel/timer continuations. */
  static readonly #ProducerControl = class {
    /** The single feature retains transport and producer registration ownership. */
    // eslint-disable-next-line no-unused-private-class-members -- Nested owner reads canonical private feature operations below.
    readonly #owner: RpcStreamOwner
    /** Original producer state is the sole iterator, sequence and admission context. */
    readonly #state: IProducerState
    /** Capture the admitted producer without allocating another lifecycle or queue. */
    constructor(owner: RpcStreamOwner, state: IProducerState) {
      this.#owner = owner
      this.#state = state
    }
    /** Bind the final executor's two controls before installing the original legacy deadline. */
    attach(request: Extract<IRpcEnvelope, { kind: 'request' }>): void {
      this.#state.runtime?.bindCancel(this.#cancel)
      this.#state.runtime?.bindControl(this.#control)
      if (!this.#state.runtime && request.data.route.timeoutMs !== undefined)
        this.#state.timer = this.#owner.#kernel.time.setTimeout(
          this.#expire,
          request.data.route.timeoutMs
        )
    }
    /** Cancellation uses the actual producer's current credit and original error serializer. */
    readonly #cancel = (reason?: unknown): Promise<void> =>
      this.#owner.#receiveProducer(
        this.#state.senderId,
        this.#state.id,
        {
          event: RpcStreamEvent.cancel,
          seq: this.#state.seq,
          ...(reason === undefined
            ? {}
            : {
                reason: serializeRpcError(reason, {
                  report: (failure) => this.#owner.#report(failure.error)
                })
              })
        },
        true
      )

    /** Finish changes only the same single-credit loop to discard; pull preserves its permission. */
    readonly #control: Parameters<IProviderRuntimeStream['bindControl']>[0] = (payload) => {
      /** The original final executor remains the only start and finish permission owner. */
      const runtime = this.#state.runtime!
      if (payload.event === RpcRuntimeFinish) {
        /** Validate the actual finish against the original admitted start options. */
        const error = checkRpcRuntimeStreamFinish(runtime.envelope.options)
        if (error) throw error
        if (this.#state.discard || this.#state.terminal) return Promise.resolve()
        this.#state.discard = true
        if (runtime.finishStream)
          return runtime
            .finishStream(
              payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
            )
            .then(this.#driveDiscard)
        return this.#state.busy || this.#state.itemAdmission !== undefined
          ? Promise.resolve()
          : this.#pullDiscard()
      }
      if (payload.event === RpcStreamEvent.pull && !this.#state.discard)
        return this.#owner.#receiveProducer(this.#state.senderId, this.#state.id, payload, true)
      return Promise.resolve()
    }
    /** A relay finish cannot create a second credit while an item write or next already owns it. */
    readonly #driveDiscard = (): void | Promise<void> =>
      this.#state.busy || this.#state.itemAdmission !== undefined || this.#state.terminal
        ? undefined
        : this.#pullDiscard()
    /** Discard reuses the original current sequence and ordinary producer receiver. */
    #pullDiscard(): Promise<void> {
      return this.#owner.#receiveProducer(
        this.#state.senderId,
        this.#state.id,
        { event: RpcStreamEvent.pull, seq: this.#state.seq },
        true
      )
    }
    /** Legacy timeout retains its outstanding return work after terminal Map removal. */
    readonly #expire = (): void => {
      if (this.#state.terminal) return
      if (this.#state.lifetime) this.#state.lifetime.pending += 1
      this.#owner.#finishProducer(this.#state, createRpcTimeoutError())
      void Promise.resolve()
        .then(() => this.#state.iterator.return?.())
        .catch((error) => this.#owner.#report(error))
        .finally(() => {
          if (this.#state.lifetime) this.#state.lifetime.pending -= 1
          this.#owner.#settleProducer(this.#state)
        })
    }
  }

  /** Compose the two original native admission releases without mutable factory captures. */
  static readonly #ProducerAdmissionSettlement = class {
    /** Session cleanup must run first and cannot suppress the prior native release. */
    readonly #release: (succeeded: boolean) => void
    /** The first native owner retains its original callback identity and receiver-free invocation. */
    readonly #prior: IProducerState['nativeSettlement']
    /** Capture already acquired original receipts only. */
    constructor(release: (succeeded: boolean) => void, prior: IProducerState['nativeSettlement']) {
      this.#release = release
      this.#prior = prior
    }
    /** Report the same outcome in original session-then-native finally order. */
    readonly settle = (succeeded: boolean): void => {
      /** Local callback selection preserves the original receiver-free call. */
      const release = this.#release
      /** Native cleanup remains mandatory if the session cleanup throws. */
      const prior = this.#prior
      try {
        release(succeeded)
      } finally {
        prior?.(succeeded)
      }
    }
  }

  /** One physical item admission owns its exact held credit and commit callback. */
  static readonly #ProducerItemDelivery = class {
    /** Existing kernel alone decides endpoint generation and active state. */
    readonly #kernel: IEndpointKernelHost
    /** This is the same producer context indexed by the original feature Map. */
    readonly #state: IProducerState
    /** A physical item write keeps its own original abort admission. */
    readonly admission: AbortController
    /** The held sequence cannot be confused with a reentrant later credit. */
    readonly seq: number
    /** Legacy transports commit on completion; native batch gates commit at invocation. */
    #started = false
    /** Keep original allocate, publish admission, then read sequence order. */
    constructor(kernel: IEndpointKernelHost, state: IProducerState) {
      this.#kernel = kernel
      this.#state = state
      this.admission = new AbortController()
      state.itemAdmission = this.admission
      this.seq = state.seq
    }
    /** The caller distinguishes physical invocation from legacy completion. */
    get started(): boolean {
      return this.#started
    }
    /** Commit this held credit once at the original physical gate. */
    readonly commit = (): void => {
      this.#started = true
      this.#state.seq = this.seq + 1
      this.#state.busy = false
    }
    /** Reentry cannot send a retired or already consumed credit. */
    readonly assertCanSend = (): void => {
      this.#kernel.assertActive()
      if (this.#state.terminal || this.#state.seq !== this.seq) throw createRpcAbortError()
    }
  }

  /** One scheduler yield owns its timer, abort listener and the original completion Promise. */
  static readonly #DataTurn = class {
    /** Reuse the endpoint's injected scheduler; no extra queue or clock is introduced. */
    readonly #time: IEndpointKernelHost['time']
    /** Original producer scope is the only cancellation source for this yield. */
    readonly #scope: OperationScope
    /** The existing timer receipt is cleared only by its paired abort callback. */
    #timer!: IEndpointTimer
    /** Resolve the one original yield Promise from either timer or abort. */
    #resolve!: () => void
    /** Every yield returns its exact original Promise without a wrapper or duplicate tail. */
    readonly promise: Promise<void>
    /** Install callbacks before returning exactly as the original Promise executor did. */
    constructor(time: IEndpointKernelHost['time'], scope: OperationScope) {
      this.#time = time
      this.#scope = scope
      this.promise = new Promise((resolve) => {
        this.#resolve = resolve
        this.#timer = time.setTimeout(this.#elapsed, 0)
        if (scope.signal.aborted) this.#abort()
        else scope.signal.addEventListener('abort', this.#abort, { once: true })
      })
    }
    /** A normal turn removes only its own abort listener before settlement. */
    readonly #elapsed = (): void => {
      this.#scope.signal.removeEventListener('abort', this.#abort)
      this.#resolve()
    }
    /** Scope retirement clears the same timer and settles the same Promise. */
    readonly #abort = (): void => {
      this.#time.clearTimeout(this.#timer)
      this.#resolve()
    }
  }

  /** Canonical endpoint state and time owner. */
  readonly #kernel: IEndpointKernelHost
  /** Construction snapshot used only for id allocation and local identity. */
  readonly #prepared: IPreparedEndpoint<string>
  /** All stream frames use the existing outbound operation. */
  readonly #outbound: IRpcOutboundOperationsPort
  /** Shared provider namespace registration port. */
  readonly #registerStream: (
    method: string,
    handler: (
      message: unknown,
      createContext: (signal: INativeAbortSignal) => IRpcContext
    ) => void | Promise<void>
  ) => () => void
  /** Connection capability decision supplied by the channel owner. */
  readonly #capability: IRpcStreamCapabilityPort | undefined
  /** Caller-owned streams, isolated by target and id. */
  readonly #consumers = new Map<string, IConsumerState>()
  /** Producer-owned streams, isolated by admitted sender and id. */
  readonly #producers = new Map<string, IProducerState>()
  /** Cancelled caller keys remain admitted until their terminal peer notification. */
  readonly #pendingCancels = new Map<string, IPendingCancel>()
  /** Bounded early cancels prevent delayed requests from starting orphan work. */
  readonly #earlyCancels = new Map<string, { senderId: string; seq: number }>()
  /** A peer that exceeded its early-cancel budget cannot start an orphan producer. */
  readonly #earlyCancelOverflow = new Set<string>()
  /** Provider registrations released on feature disposal. */
  readonly #registrations = new Set<() => void>()
  /** Kernel route release is idempotent and belongs to this feature. */
  readonly #releaseRoute: () => void
  /** This optional callback uses the outbound owner's existing transport subscription. */
  readonly #releaseTransportFailure: (() => void) | undefined
  /** Prevents new streams during reverse feature disposal. */
  #closed = false
  /** Native assembly joins runtime consumer lifetime to its existing physical generation drain. */
  // eslint-disable-next-line no-unused-private-class-members -- ConsumerIterator.#start reads this canonical admission callback.
  #runtimeConsumerAdmission: (() => () => void) | undefined

  /** Installs the stream route and reuses the provider and outbound feature ports. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    outbound: IRpcOutboundOperationsPort,
    registerStream: (
      method: string,
      handler: (
        message: unknown,
        createContext: (signal: INativeAbortSignal) => IRpcContext
      ) => void | Promise<void>
    ) => () => void,
    capability?: IRpcStreamCapabilityPort
  ) {
    this.#kernel = kernel
    this.#prepared = prepared
    this.#outbound = outbound
    this.#registerStream = registerStream
    this.#capability = capability
    /** The existing consumer Map is the sole logical client stream count; producers are excluded. */
    kernel.registerOwner(EndpointOwnerKey.streamConsumerRegistry, this.#consumers)
    kernel.registerOwner(EndpointOwnerKey.streamOwner, this)
    this.#releaseTransportFailure = outbound.onTransportFailure?.((error) =>
      this.#transportFailed(error)
    )
    this.#releaseRoute = kernel.registerRoute(RpcEnvelopeKind.stream, (message) =>
      this.#receive(message)
    )
  }

  /** Lazily opens one remote stream; no request is sent before the first next. */
  open(
    targetId: string,
    method: string,
    params: unknown,
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number | false }>
  ): AsyncIterableIterator<IRpcPortableValue> {
    return this.#open(targetId, method, params, options)
  }

  /** New profile uses the same lazy consumer and iterator with actual accepted generation facts. */
  openRuntime(
    targetId: string,
    method: string,
    params: unknown,
    generation: IRpcRuntimeGeneration,
    options: IRpcRuntimeSendOptions
  ): AsyncIterableIterator<IRpcPortableValue> {
    return this.#open(targetId, method, params, options, generation)
  }

  /** Both profiles share the original consumer tail and lifecycle; metadata exists only on opt-in. */
  #open(
    targetId: string,
    method: string,
    params: unknown,
    options?: IRpcRuntimeSendOptions,
    generation?: IRpcRuntimeGeneration
  ): AsyncIterableIterator<IRpcPortableValue> {
    this.#kernel.assertActive()
    if (this.#closed) throw createRpcAbortError()
    return new RpcStreamOwner.#ConsumerIterator(this, targetId, method, params, options, generation)
      .value
  }

  /** Claim a provider method in the ordinary namespace and release it idempotently. */
  provide(method: string, run: IRpcStreamRun): () => void {
    if (this.#closed) throw createRpcAbortError()
    /** The original native/session receipt remains paired with its acquired lifetime. */
    const release = this.#registerStream(
      method,
      retainProviderPreflight(
        run,
        (message: unknown, createContext: (signal: INativeAbortSignal) => IRpcContext) =>
          this.#acceptRequest(message, run, createContext)
      )
    )
    this.#registrations.add(release)
    return () => {
      release()
      this.#registrations.delete(release)
    }
  }

  /** Stop the optional route and settle only this feature's live streams. */
  async dispose(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#releaseRoute()
    this.#releaseTransportFailure?.()
    for (const release of this.#registrations) release()
    this.#registrations.clear()
    for (const state of this.#consumers.values())
      this.#finishConsumer(state, { error: createRpcAbortError() })
    for (const state of this.#producers.values()) {
      if (state.lifetime) state.lifetime.pending += 1
      this.#finishProducer(state, createRpcAbortError())
      try {
        await state.iterator.return?.()
      } catch (error) {
        this.#report(error)
      } finally {
        if (state.lifetime) state.lifetime.pending -= 1
        this.#settleProducer(state)
      }
    }
    this.#producers.clear()
    for (const key of this.#pendingCancels.keys()) this.#resolveCancel(key)
    this.#earlyCancels.clear()
    this.#earlyCancelOverflow.clear()
  }

  /** Internal native assembly observes the original consumer without wrapping its iterator. */
  setRuntimeConsumerAdmission(admit: () => () => void): void {
    this.#runtimeConsumerAdmission = admit
  }

  /** Only a top-level overload proves no physical frame was sent. */
  #sendFailureReason(error: unknown): unknown {
    if (localRpcErrorCode(error) === RpcCoreErrorCode.overloaded) return error
    return createRpcError(
      RpcCoreErrorCode.streamResultUnknown,
      RpcStreamErrorText.resultUnknown,
      error
    )
  }

  /** Select one terminal result and release its scope without affecting other streams. */
  #finishConsumer(state: IConsumerState, terminal: NonNullable<IConsumerState['terminal']>): void {
    if (state.terminal) return
    state.terminal = terminal
    if (state.timer) this.#kernel.time.clearTimeout(state.timer)
    state.removeAbort?.()
    state.scope.abort('error' in terminal ? terminal.error : undefined)
    state.pullAdmission?.abort()
    this.#consumers.delete(tupleKey(state.targetId, state.id))
    if (state.runtime) {
      this.#runtimeOutbound().releaseRuntimeStream(state.id)
      state.runtime.releaseAdmission?.()
      if ('error' in terminal) state.runtime.rejectFinal?.(terminal.error)
      else state.runtime.resolveFinal?.({ done: true, value: terminal.value })
    }
    if ('error' in terminal) {
      state.rejectReady(terminal.error)
      state.pending?.reject(terminal.error)
    } else {
      state.resolveReady()
      state.pending?.resolve({ done: true, value: terminal.value })
    }
    state.pending = undefined
  }

  /** Settle locally first, then send at most one cancel after stream-open physically settles. */
  #cancelConsumer(
    state: IConsumerState,
    terminal: NonNullable<IConsumerState['terminal']>,
    reason?: unknown
  ): Promise<unknown> {
    if (state.runtime) {
      if (state.terminal) return Promise.resolve(undefined)
      /** Only selected before-start intent keeps its consumer for the final provider's decision. */
      if (state.runtime.options.cancel !== RpcRuntimeCancel) this.#finishConsumer(state, terminal)
      /** The same prepared task emits cancellation even after ordinary local settlement. */
      void state.runtime.prepared
        ?.then(() =>
          this.#sendRuntimeIntent(
            state,
            serializeRpcError(
              RpcRuntimeField.error in terminal ? terminal.error : createRpcAbortError(),
              {
                report: (failure) => this.#report(failure.error)
              }
            ),
            false
          )
        )
        .catch((error: unknown) => {
          if (!state.terminal) this.#finishConsumer(state, { error })
          else this.#report(error)
        })
      return Promise.resolve(undefined)
    }
    if (state.terminal) return Promise.resolve(undefined)
    /** This original tuple identifies only the admitted request or stream in its existing registry. */
    const key = tupleKey(state.targetId, state.id)
    /** Keep the original cancel acknowledgement until the matching peer terminal arrives. */
    const acknowledgement = new Promise<unknown>((resolve) => {
      this.#pendingCancels.set(key, { targetId: state.targetId, seq: state.seq, resolve })
    })
    this.#finishConsumer(state, terminal)
    void state.openSend?.then(
      () => {
        /** The original validated control frame selects only its matching stream operation. */
        const payload: IRpcStreamPayload = {
          event: RpcStreamEvent.cancel,
          seq: state.seq,
          ...(reason === undefined
            ? {}
            : {
                reason: serializeRpcError(reason, {
                  report: (failure) => this.#report(failure.error)
                })
              })
        }
        void this.#sendFrame(state.targetId, state.id, payload, undefined, state.receiverId).catch(
          (error) => {
            this.#report(error)
            this.#resolveCancel(key, error)
          }
        )
      },
      () => this.#resolveCancel(key)
    )
    return acknowledgement
  }

  /** Exact opt-in consumer control uses the original accepted task and physical-hop receiver. */
  #sendRuntimeIntent(
    state: IConsumerState,
    reason: import('@migaia/rpc-contract').IRpcSerializedError | undefined,
    finish: boolean
  ): Promise<void> {
    /** Open preparation completes before this original control is emitted. */
    const source = state.runtime!.envelope!
    return this.#runtimeOutbound().sendRuntimeFrame({
      profile: RpcRuntimeProfile,
      kind: RpcRuntimeKind.control,
      id: state.id,
      route: { ...source.route, sentAt: this.#kernel.time.timestamp() },
      task: source.task,
      ...(finish
        ? {
            operation: RpcRuntimeOperation.stream,
            stream: {
              event: RpcRuntimeFinish,
              seq: state.seq,
              ...(reason === undefined ? {} : { reason })
            }
          }
        : { operation: RpcRuntimeOperation.cancel, ...(reason === undefined ? {} : { reason }) })
    })
  }

  /** Canonical stream state borrows the existing outbound owner; it allocates no second sender. */
  #runtimeOutbound(): RpcOutboundAttachment {
    return this.#kernel.readOwner(EndpointOwnerKey.outboundAttachment) as RpcOutboundAttachment
  }

  /**
   * Authentication and complete task identity fence replies before they enter the original
   * consumer.
   */
  receiveRuntimeControl(envelope: IRpcRuntimeEnvelope, admission: IInboundIdentityAdmission): void {
    if (
      envelope.kind !== RpcRuntimeKind.control ||
      envelope.operation !== RpcRuntimeOperation.stream
    )
      return
    /** The original consumer Map is the only correlation directory for this credit protocol. */
    const state = this.#consumers.get(tupleKey(envelope.route.senderId, envelope.id))
    if (
      !state?.runtime ||
      !this.#runtimeOutbound().runtimeReplyMatches(envelope, state.runtime.task, admission)
    )
      return
    this.#receiveConsumer(
      envelope.route.senderId,
      envelope.id,
      envelope.stream as IRpcStreamPayload,
      authenticationReplyReceiverId(envelope),
      true
    )
  }

  /** Release a pending cancellation exactly once after peer notification or send rejection. */
  #resolveCancel(key: string, cleanupError?: unknown, keepForLateCancelled = false): void {
    /** The current waiting consumer operation is settled once by its matching peer frame. */
    const pending = this.#pendingCancels.get(key)
    if (!pending) return
    if (!keepForLateCancelled) this.#pendingCancels.delete(key)
    if (!pending.settled) {
      pending.settled = true
      pending.resolve(cleanupError)
    }
  }

  /** Build a protocol 1.1 frame using the canonical envelope and outbound owners. */
  #sendFrame(
    targetId: string,
    id: string,
    payload: IRpcStreamPayload,
    admission?: IRpcFrameAdmission,
    receiverId?: string,
    runtime?: IProviderRuntimeStream | IRpcRuntimeEnvelope
  ): Promise<void> {
    /** Portable validation completes before this stream value reaches the consumer. */
    const normalized = runtime
      ? normalizeStreamPayload(payload, (value) =>
          normalizePortable(value, 0, new Set<object>(), true)
        )
      : normalizeStreamPayload(payload)
    if (runtime) {
      /** The protected task is copied from accepted state, never reconstructed from business data. */
      const source = 'seal' in runtime ? runtime.envelope : runtime
      return Promise.resolve().then(async () => {
        if (
          'seal' in runtime &&
          (normalized.event === RpcStreamEvent.end ||
            normalized.event === RpcStreamEvent.fail ||
            normalized.event === RpcStreamEvent.cancelled)
        )
          await runtime.seal(
            normalized.event === RpcStreamEvent.end
              ? {
                  ok: true,
                  ...(normalized.value === undefined ? {} : { result: normalized.value })
                }
              : {
                  ok: false,
                  error:
                    normalized.error ??
                    serializeRpcError(createRpcAbortError(), {
                      report: (failure) => this.#report(failure.error)
                    })
                }
          )
        await this.#runtimeOutbound().sendRuntimeFrame(
          {
            profile: RpcRuntimeProfile,
            kind: RpcRuntimeKind.control,
            id,
            route: {
              ...source.route,
              senderId: this.#prepared.id,
              targetId,
              receiverId: receiverId ?? targetId,
              sentAt: this.#kernel.time.timestamp()
            },
            task: source.task,
            operation: RpcRuntimeOperation.stream,
            stream: normalized
          } as IRpcRuntimeEnvelope,
          admission
        )
      })
    }
    /** The canonical frame retains the original stream identity and transport provenance. */
    const message = createOutboundEnvelope({
      kind: 'stream',
      id,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'stream',
          applicationVersion: this.#prepared.options.contract?.version ?? '1.0',
          senderId: this.#prepared.id,
          targetId,
          ...(receiverId === undefined ? {} : { receiverId }),
          sentAt: this.#kernel.time.timestamp()
        },
        payload: normalized
      }
    })
    return this.#outbound.send({
      kind: 'frame',
      message,
      admission: admission ?? { assertCanSend: () => this.#kernel.assertActive() }
    })
  }

  /** Validate one admitted stream event and dispatch it to the peer-isolated role state. */
  async #receive(message: unknown): Promise<void> {
    /** Inspect only the received envelope record before routing its existing stream operation. */
    const record = message as { envelope?: IRpcEnvelope }
    /** Use the original accepted runtime task rather than minting another stream identity. */
    const envelope = record.envelope
    if (envelope?.kind !== 'stream' || envelope.data.route.targetId !== this.#prepared.id) return
    /** The admitted sender selects only its own producer state and reply destination. */
    const senderId = envelope.data.route.senderId
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        createRpcError(RpcCoreErrorCode.protocolInvalid, RpcStreamErrorText.capabilityMissing)
      )
      return
    }
    /** The original validated control frame selects only its matching stream operation. */
    let payload: IRpcStreamPayload
    try {
      payload = normalizeStreamPayload(envelope.data.payload)
    } catch (error) {
      this.#report(error)
      /**
       * This original tuple identifies only the admitted request or stream in its existing
       * registry.
       */
      const key = tupleKey(senderId, envelope.id)
      /** The original consumer Map is the only authority for caller sequence and terminal state. */
      const consumer = this.#consumers.get(key)
      if (consumer) void this.#cancelConsumer(consumer, { error }, error)
      /** The original producer Map is the only authority for provider credit and terminal state. */
      const producer = this.#producers.get(key)
      if (producer) {
        this.#finishProducer(producer, error)
        void Promise.resolve()
          .then(() => producer.iterator.return?.())
          .catch((cleanupError) => this.#report(cleanupError))
          .then(() =>
            this.#sendFailure(
              senderId,
              envelope.id,
              producer.seq,
              error,
              undefined,
              producer.receiverId
            )
          )
      }
      return
    }
    if (payload.event === RpcStreamEvent.pull || payload.event === RpcStreamEvent.cancel)
      await this.#receiveProducer(senderId, envelope.id, payload)
    else
      this.#receiveConsumer(senderId, envelope.id, payload, authenticationReplyReceiverId(envelope))
  }

  /** Drive the consumer's one pending credit or terminal notification. */
  #receiveConsumer(
    senderId: string,
    id: string,
    payload: IRpcStreamPayload,
    receiverId?: string,
    runtimeControl = false
  ): void {
    /** This original tuple identifies only the admitted request or stream in its existing registry. */
    const key = tupleKey(senderId, id)
    /** This existing operation context remains the sole owner of sequence and terminal facts. */
    const state = this.#consumers.get(key)
    if (state?.runtime && !runtimeControl) return
    if (!state) {
      /** The current waiting consumer operation is settled once by its matching peer frame. */
      const pending = this.#pendingCancels.get(key)
      if (pending) {
        if (payload.event === RpcStreamEvent.cancelled) {
          /** The protocol owner checks this actual pending exchange before Core settles it. */
          const error = checkRpcStreamSequence(payload, pending)
          if (error) {
            this.#report(error)
            return
          }
        }
        if (
          payload.event === RpcStreamEvent.cancelled ||
          payload.event === RpcStreamEvent.end ||
          payload.event === RpcStreamEvent.fail
        )
          this.#resolveCancel(
            key,
            payload.error === undefined ? undefined : deserializeRpcError(payload.error),
            payload.event !== RpcStreamEvent.cancelled
          )
      } else if (payload.event === RpcStreamEvent.cancelled) {
        /** An actual missing exchange cannot acknowledge a cancellation. */
        const error = checkRpcStreamSequence(payload, undefined)
        if (error) this.#report(error)
      }
      return
    }
    if (payload.event === RpcStreamEvent.open) {
      /** Open grammar belongs to the protocol; cancellation remains with this consumer. */
      const error = checkRpcStreamInitialSequence(payload)
      if (error) {
        this.#invalid(state, error)
        return
      }
      if (receiverId !== undefined) state.receiverId = receiverId
      if (state.runtime?.options.cancel === RpcRuntimeCancel) {
        if (state.timer) this.#kernel.time.clearTimeout(state.timer)
        state.timer = undefined
        state.removeAbort?.()
        state.removeAbort = undefined
      }
      state.resolveReady()
      return
    }
    if (state.runtime) {
      if (payload.event === RpcStreamEvent.cancelled) {
        if (
          state.runtime.finishing &&
          state.runtime.options.cancel !== RpcRuntimeCancel &&
          payload.error === undefined
        ) {
          this.#finishConsumer(state, { done: true })
          return
        }
        this.#finishConsumer(state, {
          error:
            payload.error === undefined ? createRpcAbortError() : deserializeRpcError(payload.error)
        })
        return
      }
      if (
        (state.runtime.finishing || !state.pending) &&
        (payload.event === RpcStreamEvent.end || payload.event === RpcStreamEvent.fail)
      ) {
        /** Terminal progress may skip discarded items but never retreat. */
        const error = checkRpcStreamProgress(payload, state)
        if (error) {
          this.#invalid(state, error)
          return
        }
        this.#finishConsumer(
          state,
          payload.event === RpcStreamEvent.fail
            ? { error: deserializeRpcError(payload.error!) }
            : { done: true, ...(payload.value === undefined ? {} : { value: payload.value }) }
        )
        return
      }
      if (state.runtime.finishing && payload.event === RpcStreamEvent.item) {
        /** The held sequence owns this finishing item. */
        const error = checkRpcStreamSequence(payload, state)
        if (error) {
          this.#invalid(state, error)
          return
        }
        state.seq += 1
        return
      }
    }
    if (payload.event === RpcStreamEvent.fail && !state.pending && payload.seq === 0) {
      this.#finishConsumer(state, { error: deserializeRpcError(payload.error!) })
      return
    }
    if (
      payload.event === RpcStreamEvent.item ||
      payload.event === RpcStreamEvent.end ||
      payload.event === RpcStreamEvent.fail
    ) {
      /** The protocol checks the same short-circuit credit fields exactly once. */
      const error = checkRpcStreamConsumerCredit(payload, state)
      if (error) {
        this.#invalid(state, error)
        return
      }
      if (payload.event === RpcStreamEvent.item) {
        state.pullAdmission?.abort()
        state.pullAdmission = undefined
        state.seq += 1
        state.pending!.resolve({ done: false, value: payload.value! })
        state.pending = undefined
        return
      }
      if (payload.event === RpcStreamEvent.fail) {
        /** Retain the original validation or transport failure for reporting and terminal cleanup. */
        const error = deserializeRpcError(payload.error!)
        this.#finishConsumer(state, { error })
      } else
        this.#finishConsumer(state, {
          done: true,
          ...(Object.hasOwn(payload, 'value') ? { value: payload.value } : {})
        })
    }
  }

  /** Report a wrong credit once and terminate only its caller state. */
  #invalid(state: IConsumerState, error: Error): void {
    this.#report(error)
    void this.#cancelConsumer(state, { error }, error)
  }

  /** Hand off one admitted ordinary request to the registered stream producer. */
  async #acceptRequest(
    message: unknown,
    run: IRpcStreamRun,
    createContext: (signal: INativeAbortSignal) => IRpcContext
  ): Promise<void> {
    /** Only the final executor can attach this opt-in start/seal/control provenance. */
    const runtime = (message as { runtime?: IProviderRuntimeStream }).runtime
    /** The original admitted envelope supplies this hop identity and elapsed request budget. */
    const request = (message as { envelope?: IRpcEnvelope }).envelope
    if (request?.kind !== 'request') return
    /** The admitted sender selects only its own producer state and reply destination. */
    const senderId = request.data.route.senderId
    /** Original identity admission precedes this proof read; logical names cannot select replies. */
    const receiverId = runtime?.replyReceiverId ?? authenticationReplyReceiverId(request)
    /** Only refusal awaits; admitted iterator construction still starts in the same turn. */
    const admitted = this.#admitProducerRequest(message, request, runtime, receiverId, senderId)
    if (typeof admitted !== 'string') {
      await admitted
      return
    }
    /** This original tuple identifies only the admitted request or stream in its existing registry. */
    const key = admitted
    /** The original scope fences this operation lifetime and its inherited cancellation. */
    const scope = new OperationScope(
      this.#kernel.generation,
      runtime ? undefined : request.data.route.timeoutMs,
      runtime?.forwarded
        ? this.#kernel.closingSignal
        : (runtime?.signal ?? this.#kernel.closingSignal),
      () => this.#kernel.time.now()
    )
    /** This existing operation context remains the sole owner of sequence and terminal facts. */
    let state: IProducerState
    /** Relay open uses the same provider context that constructed this original iterator. */
    let context: IRpcContext
    /** New-profile construction acquires native policy before any downstream relay can begin. */
    let nativeSettlement: IProducerState['nativeSettlement']
    try {
      context = createContext(runtime?.forwarded ? runtime.signal : scope.signal)
      if (runtime) nativeSettlement = readProviderStreamAdmission(run)?.(context)
      /** The verified session enters its original governor on this same producer lifetime. */
      const session = (
        this.#kernel.readOwner(EndpointOwnerKey.providerRegistry) as ProviderRegistry | undefined
      )?.sessionPolicy?.(context.senderId)
      /** Policy selection is captured before the iterator is invoked or its first pull can yield. */
      const projectResult = session?.streamResult
      const enterSession = session?.enterStream
      if (enterSession) {
        /** Existing native rollback remains primary if the selected connection refuses entry. */
        const prior = nativeSettlement
        /** The original native/session receipt remains paired with its acquired lifetime. */
        let release: (succeeded: boolean) => void
        try {
          release = enterSession(context)
        } catch (error) {
          prior?.(false)
          nativeSettlement = undefined
          throw error
        }
        nativeSettlement = new RpcStreamOwner.#ProducerAdmissionSettlement(release, prior).settle
      }
      /** Invoke the registered producer once before selecting its original iterator. */
      const iterable = run(request.data.payload, { signal: scope.signal, context }) as unknown
      /** Read the original iterable protocol methods without replacing their receiver. */
      const source = iterable as {
        [Symbol.asyncIterator]?: () => AsyncIterator<IRpcPortableValue>
        [Symbol.iterator]?: () => Iterator<IRpcPortableValue>
      } | null
      if (
        typeof iterable !== 'object' ||
        iterable === null ||
        (typeof source?.[Symbol.asyncIterator] !== 'function' &&
          typeof source?.[Symbol.iterator] !== 'function')
      )
        throw createRpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.iterableInvalid)
      /** The original producer iterator alone owns next and return side effects. */
      const iterator =
        typeof source[Symbol.asyncIterator] === 'function'
          ? source[Symbol.asyncIterator]!()
          : source[Symbol.iterator]!()
      /** Legacy streams allocate no added lifetime state or Promise. */
      let lifetime: IProducerState['lifetime']
      if ((message as { activeLifetime?: boolean }).activeLifetime) {
        /** Resolving this producer's settlement cannot release any later same-ID admission. */
        let resolve!: () => void
        /** Open-frame work counts before a timer or cancel can mark the producer terminal. */
        const settled = new Promise<void>((done) => {
          resolve = done
        })
        lifetime = { pending: 1, settled, resolve }
      }
      state = {
        ...(nativeSettlement === undefined ? {} : { nativeSettlement }),
        ...(projectResult === undefined
          ? {}
          : { nativeResult: { project: projectResult, context } }),
        ...(runtime === undefined ? {} : { runtime }),
        ...(receiverId === undefined ? {} : { receiverId }),
        route: request.data.route.forwardRoute,
        lifetime,
        id: request.id,
        senderId,
        iterator,
        scope,
        seq: 0,
        busy: false,
        terminal: false
      }
      this.#producers.set(key, state)
      new RpcStreamOwner.#ProducerControl(this, state).attach(request)
    } catch (error) {
      nativeSettlement?.(false)
      scope.abort()
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        error,
        request.data.route.forwardRoute,
        receiverId,
        runtime
      )
      return
    }
    try {
      if (runtime?.prepareStream) await runtime.prepareStream(context)
      try {
        await this.#sendFrame(
          senderId,
          request.id,
          { event: RpcStreamEvent.open, seq: 0 },
          undefined,
          receiverId,
          runtime
        )
      } catch (error) {
        /** Only a physical open-write failure makes delivery uncertain; C's terminal is exact. */
        throw this.#sendFailureReason(error)
      }
    } catch (error) {
      /** Keep the original primary failure while cleanup and terminal delivery complete. */
      const failure = error
      this.#finishProducer(state, failure)
      try {
        await state.iterator.return?.()
      } catch (cleanupError) {
        this.#report(cleanupError)
      }
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        failure,
        undefined,
        state.receiverId,
        state.runtime
      )
    } finally {
      if (state.lifetime) state.lifetime.pending -= 1
      this.#settleProducer(state)
    }
    if (state.lifetime) await state.lifetime.settled
  }

  /** Refuse replay, missing capability or producer limits before allocating an iterator scope. */
  #admitProducerRequest(
    message: unknown,
    request: Extract<IRpcEnvelope, { kind: 'request' }>,
    runtime: IProviderRuntimeStream | undefined,
    receiverId: string | undefined,
    senderId: string
  ): string | void | Promise<void> {
    if ((message as { preflightError?: unknown }).preflightError !== undefined) {
      return this.#sendFailure(
        senderId,
        request.id,
        0,
        (message as { preflightError: unknown }).preflightError,
        undefined,
        receiverId,
        runtime
      )
    }
    if ((message as { replayRejected?: boolean }).replayRejected) {
      return this.#sendFailure(
        senderId,
        request.id,
        0,
        createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.requestReplayLedgerIsFull),
        undefined,
        receiverId,
        runtime
      )
    }
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        createRpcError(RpcCoreErrorCode.protocolInvalid, RpcStreamErrorText.capabilityMissing)
      )
    }
    /** This original tuple identifies only the admitted request or stream in its existing registry. */
    const key = tupleKey(senderId, request.id)
    /**
     * An already accepted cancellation prevents this delayed request from starting an orphan
     * producer.
     */
    const early = runtime ? undefined : this.#earlyCancels.get(key)
    if (early) {
      this.#earlyCancels.delete(key)
      return this.#sendFrame(
        senderId,
        request.id,
        {
          event: RpcStreamEvent.cancelled,
          seq: early.seq
        },
        undefined,
        receiverId
      )
    }
    if (!runtime && this.#earlyCancelOverflow.has(senderId)) {
      return this.#sendFailure(
        senderId,
        request.id,
        0,
        createRpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded),
        undefined,
        receiverId,
        runtime
      )
    }
    if (this.#producers.has(key)) return
    /** Count only this sender existing producers before admitting another stream. */
    let peerOpen = 0
    for (const state of this.#producers.values()) if (state.senderId === senderId) peerOpen += 1
    if (peerOpen >= RpcStreamLimit.maxOpenStreamsPerPeer) {
      return this.#sendFailure(
        senderId,
        request.id,
        0,
        createRpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded),
        undefined,
        receiverId,
        runtime
      )
    }
    return key
  }

  /** Grant one producer credit and send exactly its result, never prefetching. */
  async #receiveProducer(
    senderId: string,
    id: string,
    payload: IRpcStreamPayload,
    runtimeControl = false
  ): Promise<void> {
    /** Keep cleanup ownership even after a terminal step removes the publicly indexed state. */
    const state = this.#producers.get(tupleKey(senderId, id))
    if (state?.runtime && !runtimeControl) return
    if (!state?.lifetime) return this.#receiveProducerStep(senderId, id, payload)
    state.lifetime.pending += 1
    try {
      await this.#receiveProducerStep(senderId, id, payload)
    } finally {
      state.lifetime.pending -= 1
      this.#settleProducer(state)
    }
  }

  /**
   * Executes one original producer step; final lifetime tracking never serializes independent
   * credits.
   */
  async #receiveProducerStep(
    senderId: string,
    id: string,
    payload: IRpcStreamPayload
  ): Promise<void> {
    /** This original tuple identifies only the admitted request or stream in its existing registry. */
    const key = tupleKey(senderId, id)
    /** This existing operation context remains the sole owner of sequence and terminal facts. */
    const state = this.#producers.get(key)
    if (!state) {
      this.#retainEarlyCancel(senderId, key, payload)
      return
    }
    if (state.terminal) return
    if (payload.event === RpcStreamEvent.cancel) return this.#cancelProducerStep(state, payload)
    /** A producer cannot reuse a busy pull or skip its held sequence. */
    const creditError = checkRpcStreamProducerCredit(payload, state)
    if (creditError) return this.#rejectProducerCredit(state, creditError)
    while (!state.terminal) {
      state.busy = true
      /** Observe exactly one original provider or iterator result before terminal selection. */
      let result: IteratorResult<IRpcPortableValue>
      try {
        result = await state.iterator.next()
      } catch (error) {
        this.#finishProducer(state, error)
        /** Keep the original primary failure while cleanup and terminal delivery complete. */
        let failure = error
        try {
          await state.iterator.return?.()
        } catch (cleanupError) {
          /** A runtime relay can observe the same terminal twice; preserve its original code/cause. */
          if (!state.runtime || cleanupError !== error)
            failure = new AggregateError([error, cleanupError], RpcStreamErrorText.cleanupFailed)
        }
        await this.#sendFailure(
          senderId,
          id,
          state.seq,
          failure,
          state.route,
          state.receiverId,
          state.runtime
        )
        state.busy = false
        return
      }
      if (state.terminal) return
      /** Validate this exact yielded or final value before discard or physical delivery. */
      let outboundPayload: IRpcStreamPayload
      try {
        outboundPayload = this.#producerPayload(state, result)
      } catch (error) {
        /** Keep the original primary failure while cleanup and terminal delivery complete. */
        const failure = createRpcError(
          RpcCoreErrorCode.payloadInvalid,
          RpcStreamErrorText.valueInvalid,
          error
        )
        this.#report(failure)
        this.#finishProducer(state, failure)
        try {
          await state.iterator.return?.()
        } catch (cleanupError) {
          this.#report(cleanupError)
        }
        await this.#sendFailure(
          senderId,
          id,
          state.seq,
          failure,
          undefined,
          state.receiverId,
          state.runtime
        )
        state.busy = false
        return
      }
      /** A finish keeps this same outstanding next credit and discards validated yields in place. */
      if (state.discard && !result.done) {
        state.seq += 1
        continue
      }
      if (result.done) {
        if (state.nativeSettlement) state.nativeSucceeded = true
        this.#finishProducer(state)
        try {
          await this.#sendFrame(
            senderId,
            id,
            outboundPayload,
            undefined,
            state.receiverId,
            state.runtime
          )
        } catch (error) {
          this.#report(error)
        }
        state.busy = false
        return
      }
      /** This original item credit owns its gate callbacks and physical admission. */
      const delivery = new RpcStreamOwner.#ProducerItemDelivery(this.#kernel, state)
      /** This exact credit keeps its own abort admission across reentrant physical sends. */
      const admission = delivery.admission
      /** Snapshot only the original held credit so later reentry cannot consume or clear it. */
      const seq = delivery.seq
      try {
        await this.#yieldDataTurn(state)
        await this.#sendFrame(
          senderId,
          id,
          outboundPayload,
          {
            queueSignal: admission.signal,
            assertCanSend: delivery.assertCanSend,
            onStarted: delivery.commit
          },
          state.receiverId,
          state.runtime
        )
        if (!delivery.started) delivery.commit()
      } catch (error) {
        if (state.terminal) return
        /** Keep the original primary failure while cleanup and terminal delivery complete. */
        const failure = this.#sendFailureReason(error)
        this.#finishProducer(state, failure)
        try {
          await state.iterator.return?.()
        } catch (cleanupError) {
          this.#report(cleanupError)
        }
        await this.#sendFailure(
          senderId,
          id,
          seq,
          failure,
          undefined,
          state.receiverId,
          state.runtime
        )
      }
      admission.abort()
      /** Earlier physical completion must not clear a subsequent credit's active admission. */
      if (state.itemAdmission === admission) {
        state.itemAdmission = undefined
      }
      /** A later pull may already own next; only this unchanged idle credit can drive discard. */
      if (!state.discard || state.busy || state.seq !== seq + 1) return
    }
  }

  /**
   * Build and validate exactly one yielded item or final value before any discard or physical
   * write.
   */
  #producerPayload(
    state: IProducerState,
    result: IteratorResult<IRpcPortableValue>
  ): IRpcStreamPayload {
    /** The native session projects the one terminal value without wrapping or pulling the iterator. */
    const value =
      result.done && state.nativeResult
        ? (0, state.nativeResult.project)(result.value, state.nativeResult.context)
        : result.value
    /** Validate this exact yielded or projected final value before discard or physical delivery. */
    const outboundPayload: IRpcStreamPayload = {
      event: result.done ? RpcStreamEvent.end : RpcStreamEvent.item,
      seq: state.seq,
      ...(result.done ? (value === undefined ? {} : { value }) : { value })
    }
    if (state.runtime)
      normalizeStreamPayload(outboundPayload, (value) =>
        normalizePortable(value, 0, new Set<object>(), true)
      )
    else normalizeStreamPayload(outboundPayload)
    return outboundPayload
  }

  /** Keep only the original bounded early-cancel intent when its request has not arrived. */
  #retainEarlyCancel(senderId: string, key: string, payload: IRpcStreamPayload): void {
    if (payload.event === RpcStreamEvent.cancel && !this.#earlyCancelOverflow.has(senderId)) {
      if (!this.#earlyCancels.has(key)) {
        /** Count only this sender retained early cancels against the original fixed budget. */
        let peerCancels = 0
        for (const early of this.#earlyCancels.values())
          if (early.senderId === senderId) peerCancels += 1
        if (peerCancels >= RpcStreamLimit.maxOpenStreamsPerPeer) {
          this.#earlyCancelOverflow.add(senderId)
          return
        }
      }
      this.#earlyCancels.set(key, { senderId, seq: payload.seq })
    }
  }

  /** Complete iterator cancellation before its exact peer acknowledgement. */
  async #cancelProducerStep(state: IProducerState, payload: IRpcStreamPayload): Promise<void> {
    /** The admitted sender selects only its own producer state and reply destination. */
    const senderId = state.senderId
    /** The original stream identity keys this consumer or producer admission only. */
    const id = state.id
    state.terminal = true
    state.scope.abort(
      payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
    )
    /** Retain the original iterator return failure for the same cancellation acknowledgement. */
    let cleanupError: unknown
    try {
      await state.iterator.return?.()
    } catch (error) {
      cleanupError = error
    }
    this.#producers.delete(tupleKey(senderId, id))
    await this.#sendFrame(
      senderId,
      id,
      {
        event: RpcStreamEvent.cancelled,
        seq: payload.seq,
        ...(cleanupError === undefined
          ? {}
          : {
              error: serializeRpcError(cleanupError, {
                report: (failure) => this.#report(failure.error)
              })
            })
      },
      undefined,
      state.receiverId,
      state.runtime
    )
  }

  /** Invalid credit terminates only this original producer and reports its cleanup failure. */
  async #rejectProducerCredit(state: IProducerState, error: Error): Promise<void> {
    /** The admitted sender selects only its own producer state and reply destination. */
    const senderId = state.senderId
    /** The original stream identity keys this consumer or producer admission only. */
    const id = state.id
    this.#report(error)
    this.#finishProducer(state, error)
    try {
      await state.iterator.return?.()
    } catch (cleanupError) {
      this.#report(cleanupError)
    }
    await this.#sendFailure(
      senderId,
      id,
      state.seq,
      error,
      undefined,
      state.receiverId,
      state.runtime
    )
  }

  /** Release one producer state before any terminal notification can reenter it. */
  #finishProducer(state: IProducerState, reason?: unknown): void {
    state.terminal = true
    this.#producers.delete(tupleKey(state.senderId, state.id))
    if (state.timer) this.#kernel.time.clearTimeout(state.timer)
    state.itemAdmission?.abort()
    state.scope.abort(reason)
    this.#settleProducer(state)
  }

  /** Resolves the admitted stream lifetime only when terminal cleanup and sends have all settled. */
  #settleProducer(state: IProducerState): void {
    if (state.terminal && (!state.lifetime || state.lifetime.pending === 0)) {
      /** Clear before callback execution so reentrant cleanup cannot release the owner twice. */
      const release = state.nativeSettlement
      state.nativeSettlement = undefined
      release?.(state.nativeSucceeded === true)
      state.lifetime?.resolve()
    }
  }

  /** Yield the endpoint scheduler once without leaving a pull suspended on disposal. */
  #yieldDataTurn(state: IProducerState): Promise<void> {
    return new RpcStreamOwner.#DataTurn(this.#kernel.time, state.scope).promise
  }

  /** Send a serialized failure while keeping the producer's original error graph reachable. */
  async #sendFailure(
    targetId: string,
    id: string,
    seq: number,
    error: unknown,
    route?: readonly string[],
    receiverId?: string,
    runtime?: IProviderRuntimeStream
  ): Promise<void> {
    /** The original terminal envelope supplies the exact portable outcome and error graph. */
    const wire = serializeRpcError(retainProviderFailureRoute(error, route), {
      report: (failure) => this.#report(failure.error)
    })
    try {
      await this.#sendFrame(
        targetId,
        id,
        { event: RpcStreamEvent.fail, seq, error: wire },
        undefined,
        receiverId,
        runtime
      )
    } catch (sendError) {
      this.#report(sendError)
    }
  }

  /** Forward an admitted stream failure through the existing endpoint diagnostic channel. */
  #report(error: unknown): void {
    this.#outbound.send({
      kind: 'report',
      error,
      code: (error as { readonly code?: string })?.code ?? RpcCoreErrorCode.protocolInvalid
    })
  }

  /** A connection failure terminates all live streams without replaying delivered items. */
  #transportFailed(cause: unknown, targetId?: string): void {
    /** Retain the original validation or transport failure for reporting and terminal cleanup. */
    const error = isLocalRpcError(cause, RpcAbortError)
      ? cause
      : createRpcError(
          RpcCoreErrorCode.streamResultUnknown,
          RpcStreamErrorText.resultUnknown,
          cause
        )
    for (const state of this.#consumers.values()) {
      if (targetId === undefined || state.targetId === targetId)
        this.#finishConsumer(state, { error })
    }
    for (const [key, state] of this.#pendingCancels) {
      if (targetId === undefined || state.targetId === targetId) this.#resolveCancel(key, error)
    }
    for (const state of this.#producers.values()) {
      if (targetId !== undefined && state.senderId !== targetId) continue
      if (state.lifetime) {
        state.lifetime.pending += 1
        this.#finishProducer(state, error)
        void Promise.resolve()
          .then(() => state.iterator.return?.())
          .catch((failure) => this.#report(failure))
          .finally(() => {
            state.lifetime!.pending -= 1
            this.#settleProducer(state)
          })
      } else {
        state.terminal = true
        state.scope.abort(error)
        void Promise.resolve(state.iterator.return?.()).catch((failure) => this.#report(failure))
      }
      this.#producers.delete(tupleKey(state.senderId, state.id))
    }
    if (targetId === undefined) {
      this.#producers.clear()
      this.#earlyCancels.clear()
      this.#earlyCancelOverflow.clear()
    } else {
      for (const [key, state] of this.#earlyCancels) {
        if (state.senderId === targetId) this.#earlyCancels.delete(key)
      }
      this.#earlyCancelOverflow.delete(targetId)
    }
  }

  /** The host's original session owner retires one peer through the existing stream cleanup path. */
  retireTarget(targetId: string, reason: unknown): void {
    this.#transportFailed(reason, targetId)
  }
}

/** This is the stream runtime's sole direct signal-reason read for later guarded replacement. */
function readStreamAbortReason(signal: IAbortSignal): unknown {
  return resolveAbortReason(signal)
}
