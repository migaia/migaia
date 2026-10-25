/** A logical entry projects real native resources; it owns no physical codec or receiver. */
import type {
  IRpcOriginBinding,
  IRpcOriginHandle,
  IRpcSessionView,
  IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError, createRpcLifecycleError } from '../host/error-owner.js'

/** The native scheduler supplies all lifetime Promises and real control implementations. */
export class OriginSession {
  /** Only a borrowed resource binding is retained; scheduling stays in the concrete feature. */
  readonly #binding: IRpcOriginBinding
  /** Table retirement withdraws the existing logical identity without another lifecycle registry. */
  readonly #retire: (error: unknown) => void
  /** The original native close Promise is exposed unchanged. */
  readonly handle: IRpcOriginHandle

  /** Publish only after native acquisition, then observe its one original shutdown completion. */
  constructor(
    binding: IRpcOriginBinding,
    publish: (view: IRpcSessionView) => void,
    retire: (error: unknown) => void,
    report: (error: unknown) => void
  ) {
    this.#binding = binding
    this.#retire = retire
    this.handle = Object.freeze({
      ready: Promise.resolve(binding.view),
      closed: binding.closed,
      close: this.close,
      update: publish
    })
    void binding.closed.then(
      () => retire(createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)),
      (error) => {
        retire(error)
        report(error)
      }
    )
  }

  /** Physical capability admission precedes scheduling without reading transfer getters. */
  assertTransfer(options?: object): void {
    this.#binding.assertTransfer(options)
  }
  /** Calls must select their true physical target before constructing headers or pending records. */
  send(_frame: IRpcSemanticFrame, _options?: IRpcCarrierWriteOptions): Promise<void> {
    return Promise.reject(
      createRpcError(
        RpcCoreErrorCode.targetUnknown,
        RpcCoreErrorText.unknownTarget(this.#binding.id)
      )
    )
  }
  /** Native controls borrow existing private Session control exchanges. */
  ping(options?: Parameters<IRpcOriginBinding['ping']>[0]): Promise<void> {
    return this.#binding.ping(options)
  }
  /** Drain consumes the native owner's existing remaining budget. */
  drain(remainingMs: number): Promise<void> {
    return this.#binding.drain(remainingMs)
  }
  /** The same local provider update reaches each real private Session once. */
  announceDirectory(): Promise<void> {
    return this.#binding.announceDirectory()
  }
  /** Join the original native drain without retiring already reserved logical work. */
  quiesce(reason?: unknown): Promise<void> {
    return this.#binding.close(reason)
  }
  /** Stop publication synchronously while preserving the scheduler's original shared close Promise. */
  readonly close = (reason?: unknown): Promise<void> => {
    this.#retire(reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    return this.quiesce(reason)
  }
}
