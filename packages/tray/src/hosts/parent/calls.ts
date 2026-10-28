/** Own parent business-call admission and target selection; registry counts and RPC owns IO. */
import { createTrayError } from '../../errors.ts'
import { TrayErrorCode } from '../../error-code.ts'
import { TrayCallKind, TrayInstanceState, TrayInternal } from '../constants.ts'
import { readHost } from '../define-host.ts'
import { createRoutedRemote, type ITrayInvocation, type ITraySender } from '../remote.ts'
import { toWire } from '../portable.ts'
import {
  outletOf,
  rpcCallOptions,
  type ITrayRuntimeHost,
  type ITrayRuntimeOutlet
} from '../runtime.ts'
import type { IAnyTrayHost, ITrayCallOptions } from '../typing.ts'
import type { createRoutingRegistry } from '../routing.ts'
import type { ITrayRecord, ITrayRegistry } from './registry.ts'

/** Borrow original parent authorities without creating another admission or lifecycle owner. */
export type ITrayCallsContext = Readonly<{
  host: ITrayRuntimeHost
  registry: ITrayRegistry
  definitions: ReadonlyMap<string, IAnyTrayHost>
  routing: ReturnType<typeof createRoutingRegistry>
  assertActive(): void
  current(record: ITrayRecord): void
}>

/** Parent direct and routed sends share the same original registry accounting boundary. */
export class TrayCalls {
  /** Current parent authorities are borrowed for the entire registry lifetime. */
  readonly #context: ITrayCallsContext

  /** Capture one parent context; no native target is selected during construction. */
  constructor(context: ITrayCallsContext) {
    this.#context = context
  }

  /** Validate host identity now; a kept route selects its current candidate at each operation. */
  routed(policy: string, definition: IAnyTrayHost) {
    this.#context.assertActive()
    /** Branded definition identity must match the parent's original registration. */
    const admitted = readHost(definition)
    if (this.#context.definitions.get(admitted.name) !== admitted)
      throw createTrayError(TrayErrorCode.hostUnknown)
    return createRoutedRemote(admitted.name, new RoutedSender(this.#context, admitted.name, policy))
  }

  /** Capture one original record admission; the registry alone counts each resulting send. */
  send(record: ITrayRecord): ITraySender {
    return {
      request: (input, options) =>
        this.#context.registry.sendCounted(record, TrayCallKind.request, input, options),
      notify: (input, options) =>
        this.#context.registry.sendCounted(record, TrayCallKind.notify, input, options),
      stream: (input, options) =>
        this.#context.registry.sendCounted(record, TrayCallKind.stream, input, options)
    }
  }

  /** Native sending checks the captured admission without introducing a second counter. */
  uncounted(record: ITrayRecord): ITraySender {
    return new NativeSender(this.#context, record)
  }
}

/** One route retains only immutable addressing; candidate selection stays per call or first pull. */
class RoutedSender implements ITraySender {
  /** Admission and policy authority remain borrowed from the original parent. */
  readonly #context: ITrayCallsContext
  /** Host name identifies this route without retaining a native connection generation. */
  readonly #host: string
  /** Registered policy name selects the parent's shared sequence. */
  readonly #policy: string

  /** Capture application addressing without choosing a target or starting work. */
  constructor(context: ITrayCallsContext, host: string, policy: string) {
    this.#context = context
    this.#host = host
    this.#policy = policy
  }

  /** Closing retains precedence over candidate lookup for every kept routed remote. */
  #pick(): ITrayRecord {
    this.#context.assertActive()
    return this.#context.routing.pick(this.#host, this.#policy)
  }

  /** Preserve the original async request boundary and its selected admission. */
  async request(input: ITrayInvocation, options?: ITrayCallOptions): Promise<unknown> {
    return this.#context.registry.sendCounted(this.#pick(), TrayCallKind.request, input, options)
  }

  /** Preserve the original async notify boundary and report only its original send result. */
  async notify(input: ITrayInvocation, options?: ITrayCallOptions): Promise<void> {
    return this.#context.registry.sendCounted(this.#pick(), TrayCallKind.notify, input, options)
  }

  /** Target selection remains lazy until the original first pull; registry owns stream counting. */
  async *stream(
    input: ITrayInvocation,
    options?: ITrayCallOptions
  ): AsyncIterableIterator<unknown> {
    return yield* this.#context.registry.sendCounted(
      this.#pick(),
      TrayCallKind.stream,
      input,
      options
    )
  }
}

/** A native sender retains one admission while RPC receipts own calls already sent to a generation. */
class NativeSender implements ITraySender {
  /** Parent admission and native Host are borrowed without taking their disposal ownership. */
  readonly #context: ITrayCallsContext
  /** Ended admissions cannot be revived by a later record with the same id. */
  readonly #record: ITrayRecord

  /** Capture the admission; readiness is checked only when an operation actually begins. */
  constructor(context: ITrayCallsContext, record: ITrayRecord) {
    this.#context = context
    this.#record = record
  }

  /** Preserve ready sends this turn and the stopped outlet's real rejection as the readiness cause. */
  #ready(input: ITrayInvocation): ITrayRuntimeOutlet | Promise<never> {
    this.#context.current(this.#record)
    /** Current native outlet is read after the original record admission check. */
    const outlet = outletOf(this.#context.host, this.#record.definition, this.#record.id)
    if (this.#record.state !== TrayInstanceState.ready) {
      if (this.#record.state === TrayInstanceState.stopped && outlet)
        return this.#rejectStoppedCall(outlet, input)
      throw createTrayError(TrayErrorCode.instanceNotReady)
    }
    return outlet
  }

  /** Join the stopped outlet's original failure before adding Tray context; never resend. */
  async #rejectStoppedCall(outlet: ITrayRuntimeOutlet, input: ITrayInvocation): Promise<never> {
    try {
      await outlet.send(this.#record.instanceId!, TrayInternal.invoke, toWire(input))
    } catch (error) {
      throw createTrayError(TrayErrorCode.instanceNotReady, error)
    }
    throw createTrayError(TrayErrorCode.instanceNotReady)
  }

  /** Ready requests send synchronously before the original async function returns its Promise. */
  async request(input: ITrayInvocation, options?: ITrayCallOptions): Promise<unknown> {
    /** Only stopped calls return the locally owned rejection instead of sending to a ready target. */
    const outlet = this.#ready(input)
    if (outlet instanceof Promise) return outlet
    return outlet.send(
      this.#record.instanceId!,
      TrayInternal.invoke,
      toWire(input),
      rpcCallOptions(options)
    )
  }

  /** Ready notify joins the same original native send Promise without converting target failures. */
  async notify(input: ITrayInvocation, options?: ITrayCallOptions): Promise<void> {
    /** The stopped rejection remains joined instead of escaping one-way delivery. */
    const outlet = this.#ready(input)
    if (outlet instanceof Promise) return outlet
    await outlet.notify(TrayInternal.invoke, toWire(input), {
      ...rpcCallOptions(options),
      targetId: this.#record.instanceId!
    })
  }

  /** Admission and readiness are checked at first pull, matching the original lazy generator. */
  async *stream(
    input: ITrayInvocation,
    options?: ITrayCallOptions
  ): AsyncIterableIterator<unknown> {
    /** Only stopped calls await; ready streams select their exact generation at this first pull. */
    const outlet = this.#ready(input)
    if (outlet instanceof Promise) return await outlet
    return yield* outlet.streamTo(
      this.#record.instanceId!,
      TrayInternal.stream,
      toWire(input),
      rpcCallOptions(options)
    )
  }
}
