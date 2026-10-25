/** One acquired native member supplies its own exact media and generation to work owners. */
import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcCarrier,
  IRpcCarrierWriteOptions,
  IRpcLocalSourceFacts,
  IRpcConnectionContext,
  IRpcPrivateSession,
  IRpcSessionSelection,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import type {
  IRpcNativePoolMember,
  IRpcNativePoolEvents,
  IRpcTransportSetupContext,
  IRpcNativeFeatureContext
} from '@migaia/rpc-host/sdk'
import { RpcPoolErrorCode } from '@migaia/rpc-contract/error-code'
import { tagPoolError } from './error.js'
import { RpcPoolText } from './text.js'

/** One source collaborator follows the same native resource across generation replacement. */
export class PoolMedia implements IRpcTargetSource {
  /** Original native acquisition, supervision and Session authority are borrowed unchanged. */
  readonly #context: IRpcNativeFeatureContext
  /** Native directory publication refreshes the sole logical target projection. */
  readonly #changed: (media: PoolMedia) => void
  /** The original source is assigned after its actual initial readiness commits. */
  #member: IRpcNativePoolMember | undefined
  /** Borrow the attached handle for replies during native readiness publication. */
  #handle: IRpcPrivateSession | undefined
  /** Final native removal updates only the owning collection's existing query indexes. */
  readonly #removed: (media: PoolMedia) => void
  /** Capture ownership ports without acquiring a physical resource. */
  constructor(
    context: IRpcNativeFeatureContext,
    changed: (media: PoolMedia) => void,
    removed: (media: PoolMedia) => void
  ) {
    this.#context = context
    this.#changed = changed
    this.#removed = removed
  }
  /** Existing constructors receive the native context with only private Session attachment. */
  async open(events: IRpcNativePoolEvents): Promise<void> {
    const context: IRpcTransportSetupContext = {
      ...this.#context,
      attach: this.#attach,
      detach: (handle, reason) => handle.close(reason),
      ping: (handle, options) => (handle as IRpcPrivateSession).ping(options),
      drain: (handle, remainingMs) => (handle as IRpcPrivateSession).drain(remainingMs)
    }
    this.#member = await this.#context.openMember!(context, {
      ...events,
      changed: this.#announce,
      native: (record, event, current) => {
        events.native(record, event, current)
        this.#announce()
      }
    })
  }
  /** Queries reuse the exact native record, including ownership and cold samplers. */
  get record(): IRpcNativePoolMember['record'] {
    return this.#member!.record
  }
  /** Only a bound native record can refresh its original query/projection indexes. */
  readonly #announce = (): void => {
    if (this.#member) this.#changed(this)
  }

  /** Initial Session publication can precede the native generation pointer's commit. */
  readonly #attach = (
    carrier: IRpcCarrier,
    facts?: IRpcLocalSourceFacts,
    connection?: IRpcConnectionContext
  ): IRpcPrivateSession => {
    this.#handle = this.#context.openPrivateSession(
      carrier,
      facts,
      this,
      this.#announce,
      connection
    )
    return this.#handle
  }
  /** Native preparation decides future readiness; the pool adds no restart or retry policy. */
  async ready(signal?: IAbortSignal): Promise<IRpcSessionSelection> {
    const handle = await this.#member!.ready(signal)
    const selected = handle.current()
    if (!selected) throw this.#closed()
    return selected
  }
  /** Refresh follows this same resource, independently of other available scheduler slots. */
  current(_carrierId: string): IRpcSessionSelection | undefined {
    return (this.#member?.current() ?? this.#handle)?.current()
  }
  /** Exact ids prevent a late cancellation from being redirected to a successor generation. */
  send(
    carrierId: string,
    frame: IRpcSemanticFrame,
    options?: IRpcCarrierWriteOptions
  ): Promise<void> {
    return this.#handle?.carrierId === carrierId
      ? this.#handle.send(frame, options)
      : Promise.reject(this.#closed())
  }
  /** Synchronous native capability admission does not inspect a transfer getter. */
  assertTransfer(_carrierId: string, options?: object): void {
    this.#handle?.assertTransfer(options)
  }
  /** Only the original native supervisor supplies retry authority. */
  nativeGeneration(_carrierId: string): IRpcNativePoolMember['native'] | undefined {
    return this.#member?.native
  }
  /** The existing host drain tracker retains the actual business completion Promise unchanged. */
  track<T>(carrierId: string, promise: Promise<T>): Promise<T> {
    return this.#handle?.carrierId === carrierId ? this.#handle.track(promise) : promise
  }
  /** Controls borrow the current genuine Session exchange. */
  get handle(): IRpcPrivateSession | undefined {
    return this.#member?.current() ?? this.#handle
  }
  /** Return the original native close Promise, with passive query removal on either result. */
  close(): Promise<void> {
    const closing = this.#member!.close()
    void closing.then(
      () => this.#removed(this),
      () => this.#removed(this)
    )
    return closing
  }
  /** Missing current media retains the original registered pool lifecycle failure. */
  #closed(): Error {
    return tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
  }
}
