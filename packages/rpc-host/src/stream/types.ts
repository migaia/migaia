/** Narrow stream ports share call preparation while retaining the one credit/iterator owner. */
import type {
  IRpcEnvelope,
  IRpcCompletion,
  IRpcPortableValue,
  IRpcStreamEvent
} from '@migaia/rpc-contract/protocol'
import type {
  IRpcFlowContext,
  IRpcObservation,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { FeatureScope } from '../feature/scope.js'
import type {
  ICallLocalOptions,
  ICallPreparationCommand,
  ICallSelf,
  ICallTargetRef,
  ICallWriteOptions,
  IPreparedCall
} from '../call/types.js'

/** The Host supplies actual write, global identity and the canonical call header/id allocator. */
export type IStreamChannelOptions = Readonly<{
  /** Borrow the same physical capability check before a lazy iterator reads any caller option. */
  assertTransfer(carrierId: string, options?: object): void
  self(): ICallSelf
  prepare(
    target: ICallTargetRef,
    command: ICallPreparationCommand,
    options?: ICallLocalOptions
  ): IPreparedCall
  send(
    carrierId: string,
    envelope: IRpcEnvelope,
    options?: ICallWriteOptions,
    source?: IRpcTargetSource
  ): void | Promise<void>
  features: Pick<FeatureScope, 'execute'>
  /** Count one original consumer terminal; producers already belong to Dispatcher completion. */
  track?<T>(carrierId: string, promise: Promise<T>): Promise<T>
  /** Readonly facts join the same actual flow observer without granting execution authority. */
  observe?(event: IRpcObservation): void
  report(error: unknown): void
  now?(): number
}>
/** A producer starts only from a real admitted business iterable. */
export type IStreamProducerInput = Readonly<{
  source: IRpcFlowContext
  targetSource?: IRpcTargetSource
  envelope: IRpcEnvelope
  iterable: AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>
  signal: IAbortSignal
  complete(completion: IRpcCompletion): void
}>
/** Consumer terminals are sticky and preserve the original final value or exact failure object. */
export type IStreamTerminal = Readonly<
  { done: true; value?: IRpcPortableValue } | { error: unknown }
>
/** Credit owners borrow only sending, indexing and reporting rather than another transport facade. */
export type IStreamOwner = IStreamChannelOptions &
  Readonly<{
    assertOpen(): void
    finish(
      iterable: AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>,
      reason?: unknown
    ): Promise<void>
    trackConsumer(carrierId: string, consumer: IStreamConsumer): void
    registerConsumer(carrierId: string, id: string, consumer: IStreamConsumer): void
    removeConsumer(carrierId: string, id: string | undefined, consumer: IStreamConsumer): void
    removeProducer(carrierId: string, id: string, producer: IStreamProducer): void
    frame(envelope: IRpcEnvelope, stream: IRpcStreamEvent, reply: boolean): IRpcEnvelope
  }>
/** The table needs lifecycle/receive ports, never the consumer's mutable sequence or pending pull. */
export type IStreamConsumer = Readonly<{
  accept(envelope: IRpcEnvelope): void
  reject(envelope: IRpcEnvelope, reason: unknown): boolean
  close(reason: unknown, force?: boolean): void
}>
/** Producer next/return/write work remains owned until its actual completion Promise settles. */
export type IStreamProducer = Readonly<{
  accept(envelope: IRpcEnvelope): Promise<void>
  reject(envelope: IRpcEnvelope, reason: unknown): boolean
  close(reason: unknown): Promise<void>
}>
