import { normalizeRpcEnvelope } from '../../contract/v1/normalize.js'
import { normalizeRuntimeEnvelopeLazy } from '../../contract/runtime-api/normalize-lazy.js'
import { normalizePortable } from '../../contract/normalize.js'
import { restoreRpcBinaryLazy } from '../../contract/runtime-api/binary-lazy.js'
import type { IRpcEnvelopeOptions, IRpcProtocol } from '../../contract/types.js'
import type { IRpcEnvelope } from '../../contract/v1/types.js'
import type { IRpcRuntimeEnvelope } from '../../contract/runtime-api/types.js'
import { RpcEnvelopeKind } from '../../contract/wire-constants.js'
import { RpcRuntimeKind } from '../../contract/runtime-api/constants.js'
import { RpcProtocolError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'

/** Complete receiver validation proves only exact immutable data, never endpoint authority. */
const inboundPayloads = new WeakMap<object, IRpcEnvelope | IRpcRuntimeEnvelope>()

/** Retain actual provider payload roots only after the whole canonical operation succeeded. */
function rememberPayload<T extends IRpcEnvelope | IRpcRuntimeEnvelope>(envelope: T): T {
  /** Opaque legacy variation deliberately has no portable payload proof. */
  const payload =
    'data' in envelope
      ? envelope.kind === RpcEnvelopeKind.variation
        ? undefined
        : envelope.data.payload
      : envelope.kind === RpcRuntimeKind.group
        ? envelope.steps
        : 'payload' in envelope
          ? envelope.payload
          : undefined
  if (payload !== null && typeof payload === 'object') inboundPayloads.set(payload, envelope)
  if (envelope.kind === RpcRuntimeKind.group)
    for (const step of envelope.steps)
      if (step.payload !== null && typeof step.payload === 'object')
        inboundPayloads.set(step.payload, envelope)
  return envelope
}

/** Capture a custom method once and preserve its receiver; only the canonical function records. */
export function normalizeInboundRpcEnvelope(
  value: unknown,
  protocol: IRpcProtocol<IRpcEnvelope, string, number>,
  options?: IRpcEnvelopeOptions
): IRpcEnvelope {
  /** The same one-read function decides both execution and canonical ownership. */
  const normalize = protocol.normalize
  /** Reflect.apply retains the original protocol receiver without a second getter read. */
  const envelope = Reflect.apply(normalize, protocol, [value, options]) as IRpcEnvelope
  return normalize === normalizeRpcEnvelope ? rememberPayload(envelope) : envelope
}

/** Preserve the canonical lazy stream branch while recording only its successful final result. */
function retainRuntimeEnvelope(
  envelope: IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope>
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return envelope instanceof Promise ? envelope.then(rememberPayload) : rememberPayload(envelope)
}

/** Text receive retains its original portable grammar and unsupported-binary failure. */
export function normalizeInboundRuntimeEnvelope(
  value: unknown
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return retainRuntimeEnvelope(
    normalizeRuntimeEnvelopeLazy(value, (payload) =>
      normalizePortable(payload, 0, new Set<object>(), () => {
        throw new RpcProtocolError(RpcCoreErrorText.runtimeBinaryInvalid)
      })
    )
  )
}

/** Inline restoration keeps the original subsequent portable validation and records that output. */
export function normalizeInboundRuntimeBinaryEnvelope(
  value: unknown
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return retainRuntimeEnvelope(normalizeRuntimeEnvelopeLazy(value))
}

/** The canonical lazy parser validates all bytes and digests before its exact output is reusable. */
export async function restoreInboundRuntimeBinary(
  ...input: Parameters<typeof restoreRpcBinaryLazy>
): Promise<IRpcRuntimeEnvelope> {
  return rememberPayload(await restoreRpcBinaryLazy(...input))
}

/** Queries receiver data identity without granting insertion or any transport/provider authority. */
export function isInboundNormalizedPayload(value: object): boolean {
  return inboundPayloads.has(value)
}
