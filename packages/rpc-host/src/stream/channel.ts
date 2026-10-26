/** Sole stream credit/iterator runtime; no carrier facade, optional policy or second call table. */
import {
  RpcWireKind,
  RpcCallMode,
  RpcWireStreamFinish,
  type IRpcEnvelope,
  type IRpcPortableValue,
  type IRpcCompletion,
  type IRpcStreamEvent
} from '@migaia/rpc-contract/protocol'
import { RpcStreamEvent } from '@migaia/rpc-contract'
import { RpcCoreErrorCode, RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcAbortError, RpcCoreErrorText, createContractError } from '@migaia/rpc-contract/errors'
import type { IRpcFlowContext, IRpcTargetSource } from '@migaia/rpc-contract/interfaces'
import { deferred, type IDeferred, type IAbortSignal } from '@migaia/utils/promise'
import { createRpcError, createRpcLifecycleError, isLocalRpcError } from '../host/error-owner.js'
import type { ICallLocalOptions, ICallTargetRef } from '../call/types.js'
import { StreamConsumer } from './consumer.js'
import { StreamProducer } from './producer.js'
import { RpcStreamErrorText } from './error-text.js'
import type {
  IStreamChannelOptions,
  IStreamAdmissionFailure,
  IStreamConsumer,
  IStreamOwner,
  IStreamProducer
} from './types.js'
export type { IStreamChannelOptions } from './types.js'

/** One physical source owns only its own stream states; retiring k streams is O(k). */
export class StreamChannel {
  /** Actual IO, Feature selection and shared id/header preparation belong to root collaborators. */
  readonly #ports: IStreamChannelOptions
  /** Consumers wait on the original selected direct binding and correlation id. */
  readonly #consumers = new Map<string, Map<string, IStreamConsumer>>()
  /** Producers own only original business iterators received on this exact physical source. */
  readonly #producers = new Map<string, Map<string, IStreamProducer>>()
  /** Pending Feature execution before preparation must still be retired with its source. */
  readonly #activeConsumers = new Map<string, Set<IStreamConsumer>>()
  /** Removed terminal producers remain owned while outstanding next/return/write work is settling. */
  readonly #activeProducers = new Map<string, Set<IStreamProducer>>()
  /** Closing admission is independent from actual pending iterator cleanup. */
  #closed = false
  /** Exact original iterator objects alone may expose the existing relay ready/finish seam. */
  readonly #iterators = new WeakMap<object, StreamConsumer>()
  /** Repeated host close returns one original cleanup Promise. */
  #closing: IDeferred<void> | undefined
  /** Narrow delegates capture this named owner, never payload-bearing closure state. */
  readonly #owner: IStreamOwner

  /** Wire explicit actual-owner ports once; native transports never obtain a request facade. */
  constructor(ports: IStreamChannelOptions) {
    this.#ports = ports
    this.#owner = {
      ...ports,
      assertOpen: (keepalive) => this.#assertOpen(keepalive),
      finish: (iterable, reason) => this.finish(iterable, reason),
      trackConsumer: (carrierId, consumer) =>
        this.#track(this.#activeConsumers, carrierId, consumer),
      registerConsumer: (carrierId, id, consumer) =>
        this.#register(this.#consumers, carrierId, id, consumer),
      removeConsumer: (carrierId, id, consumer) => this.#removeConsumer(carrierId, id, consumer),
      removeProducer: (carrierId, id, producer) =>
        this.#remove(this.#producers, carrierId, id, producer),
      frame: (envelope, stream, reply) => this.#frame(envelope, stream, reply)
    }
  }

  /** Return the same lazy plain iterator without allocating an id or opening a producer. */
  open(
    target: ICallTargetRef,
    method: string,
    payload?: IRpcPortableValue,
    options?: ICallLocalOptions,
    admission?: IStreamAdmissionFailure
  ): AsyncIterableIterator<IRpcPortableValue> {
    /** Only an iterator created during actual closing may retain this local admission. */
    const closing = this.#ports.canKeepalive?.(target.carrierId, target.source) === true
    /** An ordinary stream cannot enter an asynchronous feature while its Session is closing. */
    const keepalive = options?.keepalive === true && closing
    if (closing && !keepalive) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    this.#assertOpen(keepalive)
    if (target.source && !target.origin) target.source.assertTransfer(target.carrierId, options)
    else this.#ports.assertTransfer(target.carrierId, options)
    /** Relay metadata is attached only to this original public iterator, never a copyable token. */
    const consumer = new StreamConsumer(
      this.#owner,
      target,
      method,
      payload,
      options,
      admission,
      keepalive
    )
    this.#iterators.set(consumer.value, consumer)
    return consumer.value
  }

  /** A relay waits for the original downstream open before announcing its own upstream start. */
  prepare(iterable: AsyncIterable<IRpcPortableValue>): Promise<void> {
    return this.#iterators.get(iterable)?.ready() ?? Promise.resolve()
  }

  /** Relay finish reuses the same downstream consumer/credit and its actual final result. */
  async finish(
    iterable: AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>,
    reason?: unknown
  ): Promise<void> {
    await this.#iterators.get(iterable)?.finish(reason)
  }

  /** Start one actual business iterable and retain completion through every original cleanup task. */
  async provide(
    source: IRpcFlowContext,
    envelope: IRpcEnvelope,
    iterable: AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>,
    signal: IAbortSignal,
    complete: (completion: IRpcCompletion) => void,
    targetSource?: IRpcTargetSource,
    completion?: IRpcCompletion
  ): Promise<void> {
    if (this.#closing) this.#assertOpen()
    /** Iterator factory runs once before open; failed construction stays under Dispatcher reporting. */
    const producer = new StreamProducer(this.#owner, {
      source,
      envelope,
      iterable,
      signal,
      complete,
      targetSource,
      completion
    })
    this.#register(this.#producers, source.carrierId, envelope.id, producer)
    this.#track(this.#activeProducers, source.carrierId, producer)
    try {
      await producer.start()
    } finally {
      this.#untrack(this.#activeProducers, source.carrierId, producer)
    }
  }

  /** Source-key and task checks precede all credit transitions; data frames never scan directories. */
  accept(carrierId: string, envelope: IRpcEnvelope): boolean {
    if (envelope.task.mode !== RpcCallMode.stream) return false
    if (envelope.kind !== RpcWireKind.stream && envelope.kind !== RpcWireKind.error) return false
    /** A consumer terminal/item cannot drive an unrelated local producer with the same id. */
    const consumer = this.#consumers.get(carrierId)?.get(envelope.id)
    if (
      consumer &&
      (envelope.kind === RpcWireKind.error ||
        (envelope.stream.event !== RpcStreamEvent.pull &&
          envelope.stream.event !== RpcWireStreamFinish))
    ) {
      consumer.accept(envelope)
      return true
    }
    /** Original pull/finish demand runs only the selected producer's own credit state machine. */
    const producer = this.#producers.get(carrierId)?.get(envelope.id)
    if (!producer) {
      if (envelope.kind === RpcWireKind.error) return false
      /** An unclaimed stream event violates this owner's state, not the root envelope contract. */
      this.#ports.report(createContractError(RpcContractErrorCode.invalidStream))
      return true
    }
    void producer.accept(envelope).catch(this.#ports.report)
    return true
  }

  /** A correlated local hook failure preserves the exact original error and unrelated stream work. */
  reject(carrierId: string, envelope: IRpcEnvelope, reason: unknown): boolean {
    if (envelope.task.mode !== RpcCallMode.stream) return false
    return (
      this.#consumers.get(carrierId)?.get(envelope.id)?.reject(envelope, reason) ||
      this.#producers.get(carrierId)?.get(envelope.id)?.reject(envelope, reason) ||
      false
    )
  }

  /** Retire only streams owned by this physical source; late work cannot retarget its successor. */
  async retire(carrierId: string, reason: unknown, physicalFailure = false): Promise<void> {
    /** Actual physical loss keeps one unknown-result error; minted local abort retains its family. */
    const terminal =
      physicalFailure && !isLocalRpcError(reason, RpcAbortError)
        ? createRpcError(
            RpcCoreErrorCode.streamResultUnknown,
            RpcStreamErrorText.resultUnknown,
            reason
          )
        : reason
    /** Snapshot source membership once because each terminal removes itself reentrantly. */
    const consumers = this.#activeConsumers.get(carrierId)
    /** Producer cleanup can still be running after its credit table entry was removed. */
    const producers = this.#activeProducers.get(carrierId)
    this.#activeConsumers.delete(carrierId)
    this.#activeProducers.delete(carrierId)
    this.#consumers.delete(carrierId)
    this.#producers.delete(carrierId)
    if (consumers) for (const consumer of consumers) consumer.close(terminal, true)
    if (producers) await Promise.all(Array.from(producers, (producer) => producer.close(terminal)))
  }

  /** Seal new lazy opens while already admitted native-origin streams finish unchanged. */
  seal(): void {
    this.#closed = true
  }

  /**
   * Stop new opens immediately and preserve the original Promise through all actual iterator
   * cleanup.
   */
  close(reason: unknown): Promise<void> {
    if (this.#closing) return this.#closing.promise
    this.seal()
    this.#closing = deferred<void>()
    /** Cold shutdown takes each source once, independent from unrelated source cardinality. */
    const sources = new Set([...this.#activeConsumers.keys(), ...this.#activeProducers.keys()])
    void Promise.all(Array.from(sources, (source) => this.retire(source, reason))).then(
      () => this.#closing!.resolve(),
      (error) => this.#closing!.reject(error)
    )
    return this.#closing.promise
  }

  /** Shared primitive index operations keep pending lookup/removal independent from host peer count. */
  #register<T>(index: Map<string, Map<string, T>>, carrierId: string, id: string, value: T): void {
    /** One source creates one inner id index on demand. */
    let entries = index.get(carrierId)
    if (!entries) {
      entries = new Map()
      index.set(carrierId, entries)
    }
    entries.set(id, value)
  }

  /** Identity removal cannot erase a later same-id admission. */
  #remove<T>(index: Map<string, Map<string, T>>, carrierId: string, id: string, value: T): void {
    /** A missing/retired source is already terminal and needs no replacement scan. */
    const entries = index.get(carrierId)
    if (entries?.get(id) !== value) return
    entries.delete(id)
    if (entries.size === 0) index.delete(carrierId)
  }

  /** Active membership covers original cleanup work after credit table removal. */
  #track<T>(index: Map<string, Set<T>>, carrierId: string, value: T): void {
    /** One source owns one actual lifecycle set, not a second protocol table. */
    let entries = index.get(carrierId)
    if (!entries) {
      entries = new Set()
      index.set(carrierId, entries)
    }
    entries.add(value)
  }

  /** Actual terminal completion removes only its own original source membership. */
  #untrack<T>(index: Map<string, Set<T>>, carrierId: string, value: T): void {
    /** Source retirement may have already detached this exact set. */
    const entries = index.get(carrierId)
    entries?.delete(value)
    if (entries?.size === 0) index.delete(carrierId)
  }

  /** A consumer terminal releases both pending lookup and pre-preparation lifecycle ownership. */
  #removeConsumer(carrierId: string, id: string | undefined, value: IStreamConsumer): void {
    if (id !== undefined) this.#remove(this.#consumers, carrierId, id, value)
    this.#untrack(this.#activeConsumers, carrierId, value)
  }

  /**
   * Stream response/credit construction reuses the original task/id and changes only immediate
   * route.
   */
  #frame(envelope: IRpcEnvelope, stream: IRpcStreamEvent, reply: boolean): IRpcEnvelope {
    /** Root remains the only local identity owner across all carriers. */
    const self = this.#ports.self()
    return {
      profile: envelope.profile,
      kind: RpcWireKind.stream,
      id: envelope.id,
      task: envelope.task,
      route: {
        ...envelope.route,
        ...(reply
          ? {
              senderId: self.instanceId,
              receiverId: envelope.route.senderId,
              targetId: envelope.route.senderId
            }
          : {}),
        sentAt: Date.now()
      },
      stream
    }
  }

  /** Closed owners never revive lazy iterators into new provider operations. */
  #assertOpen(keepalive = false): void {
    if (this.#closed && (!keepalive || this.#closing))
      throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
  }
}
