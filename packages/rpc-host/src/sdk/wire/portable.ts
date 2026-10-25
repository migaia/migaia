/** Executing portable walks and native-bearing snapshot proof belong to the actual SDK owner. */
import { createPortableWalker } from '@migaia/serialize'
import {
  rpcNativePortableStrategy,
  raiseRpcPortableViolation,
  type IRpcPortableValue
} from '@migaia/rpc-contract/portable'
import type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'

/** Proof is produced only during the original actual native walk/restore, never by a second scan. */
const binarySnapshots = new WeakSet<object>()

/** Keep original restored backing/container identity available to the carrier's binary branch. */
export function markRpcPortableBinary(value: object): void {
  binarySnapshots.add(value)
}
/** Read only exact SDK-owned proof; public properties cannot manufacture a native backing. */
export function hasRpcPortableBinary(value: unknown): boolean {
  return typeof value === 'object' && value !== null && binarySnapshots.has(value)
}

/** Each held codec owns one executing serialize walker and caller-supplied error presentation maps. */
export class RpcPortableCapture {
  /** Native traversal policy is shared; all actual mutable walker scratch stays outside contract. */
  readonly #walker: ReturnType<typeof createPortableWalker>
  /** Error presentation is supplied by the host/codec rather than a contract-level singleton. */
  readonly #errorMetadata: IRpcErrorWireMetadata | undefined

  /** Reuse the sole serialize walker and pure RPC policy, adding proof at its existing hooks. */
  constructor(errorMetadata?: IRpcErrorWireMetadata) {
    this.#errorMetadata = errorMetadata
    this.#walker = createPortableWalker({
      ...rpcNativePortableStrategy,
      binary: this.#binary,
      finish: this.#finish,
      violation: this.#violation
    })
  }

  /** Snapshot in own-key order, borrowing genuine original native backings/views unchanged. */
  readonly normalize = (value: unknown): IRpcPortableValue =>
    this.#walker.value(value) as IRpcPortableValue

  /** Atomic native leaves need their existing binary hook because finish only visits containers. */
  readonly #binary: typeof rpcNativePortableStrategy.binary = (value, context) => {
    /** The canonical pure policy remains the only native brand/descriptor admission algorithm. */
    const admitted = rpcNativePortableStrategy.binary(value, context)
    if (admitted !== undefined && typeof admitted !== 'string') markRpcPortableBinary(admitted)
    return admitted
  }

  /**
   * Finish receives native descendant evidence from the same walk without traversing children
   * again.
   */
  readonly #finish = (value: unknown, native: boolean): unknown => {
    if (native) markRpcPortableBinary(value as object)
    return Object.freeze(value)
  }

  /** Native Contract error construction receives this codec's actual explicit metadata owner. */
  readonly #violation = (reason: string, cause?: unknown): never =>
    raiseRpcPortableViolation(reason, cause, this.#errorMetadata)
}
