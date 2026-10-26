/** Capture keyed invocation bodies through the sole SDK binary owner and stringify in own-key order. */
import type { IRpcEnvelope, IRpcStep } from '@migaia/rpc-contract/protocol'
import { RpcWireKind } from '@migaia/rpc-contract/protocol'
import { captureRpcBinary } from '../../sdk/wire/binary-capture.js'
import { encodeBytes, finishRpcBinaryCapture } from '../../sdk/wire/binary.js'
import { BinaryShape, RPC_BINARY_MAX_BYTES } from '../../sdk/wire/binary-shape.js'
import { RpcBinaryStorage } from '../../sdk/wire/binary-constants.js'
import { createRpcBackingDigest } from '../../sdk/carrier/digest.js'
import { hostErrorWireMetadata } from '../../host/error-wire-metadata.js'

/** Only actual provider-bearing operations claim keys; lookup has its separate read-only path. */
export type IIdempotentEnvelope = Extract<IRpcEnvelope, { kind: 'call' | 'group' }>

/** Preserve the original method/payload tuple layout without correlation, clocks or sorting. */
function invocationSteps(envelope: IIdempotentEnvelope): readonly IRpcStep[] {
  return envelope.kind === RpcWireKind.group
    ? envelope.steps
    : [
        {
          method: envelope.task.method!,
          ...(envelope.payload === undefined ? {} : { payload: envelope.payload })
        }
      ]
}

/** Synchronous ordinary claims stay synchronous; only actual complete-backing hashing can suspend. */
export function invocationFingerprint(envelope: IIdempotentEnvelope): string | Promise<string> {
  /** Native cryptography is the same executing dependency used by the physical SDK codec. */
  const digest = createRpcBackingDigest()
  /** This one capture produces ordinary snapshots and native tags without another binary scan. */
  const options = {
    storage: digest ? RpcBinaryStorage.native : RpcBinaryStorage.inline,
    digest,
    transferRequiresIntegrity: true,
    errorMetadata: hostErrorWireMetadata
  }
  /** No ordinary request is visited here unless it actually selected an idempotency key. */
  const capture = captureRpcBinary(
    envelope,
    options.storage,
    RPC_BINARY_MAX_BYTES,
    digest,
    undefined,
    encodeBytes,
    hostErrorWireMetadata,
    undefined,
    options.transferRequiresIntegrity
  )
  if (!capture.hasBinary)
    return JSON.stringify([
      envelope.task.mode,
      invocationSteps(capture.semanticEnvelope as IIdempotentEnvelope)
    ])
  /** This operation record keeps mode stable without rereading the caller graph after hashing. */
  const operation = { mode: envelope.task.mode }
  return finishRpcBinaryCapture(
    capture,
    options,
    new BinaryShape(RPC_BINARY_MAX_BYTES, hostErrorWireMetadata)
  ).then((prepared) =>
    JSON.stringify([
      operation.mode,
      invocationSteps(prepared.manifest.envelope as IIdempotentEnvelope),
      prepared.manifest.backings
    ])
  )
}
