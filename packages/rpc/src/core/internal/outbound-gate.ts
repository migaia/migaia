import type { IRpcEnvelope } from '../../contract/index.js'
import type { IRpcAbortSignal } from '../typing.js'
import { tagRpcError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcCoreErrorCode } from '../error-code.js'

/** Existing operation signals and a live settlement check supplied by the outbound owner. */
export type IRpcOutboundAdmission = Readonly<{
  queueSignal?: IRpcAbortSignal
  signals: readonly IRpcAbortSignal[]
  assertCanSend(): void
}>

/** Minimal port needed by core; capacity and reporting remain in the optional IPC plugin. */
export type IRpcOutboundGate = Readonly<{
  run(
    envelope: IRpcEnvelope,
    sendNow: () => void | Promise<void>,
    admission?: IRpcOutboundAdmission
  ): Promise<void>
  onEvent(listener: (event: unknown) => void): () => void
  close(reason?: unknown): void
}>

/** Branded gate identity is private to this module, so user transport properties are never read. */
const wrappedGates = new WeakMap<object, IRpcOutboundGate>()
/** Records the gate selected by a native Feature in the same endpoint batch. */
const installedGates = new WeakMap<object, IRpcOutboundGate>()

/** Registers one wrapper identity after the plugin has constructed its complete transport. */
export function registerOutboundGate(transport: object, gate: IRpcOutboundGate): void {
  if (wrappedGates.has(transport))
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcGateDuplicated),
      RpcCoreErrorCode.invalidConfig
    )
  wrappedGates.set(transport, gate)
}

/** Reads only the wrapper's WeakMap brand, never a user-supplied transport property. */
export function readOutboundGate(transport: object): IRpcOutboundGate | undefined {
  return wrappedGates.get(transport)
}

/** Binds the selected native Feature to the endpoint's exact physical transport identity. */
export function installOutboundGate(transport: object, gate: IRpcOutboundGate): void {
  if (installedGates.has(transport))
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcGateDuplicated),
      RpcCoreErrorCode.invalidConfig
    )
  installedGates.set(transport, gate)
}

/** Returns whether the wrapped transport and native Feature chose the same gate instance. */
export function outboundGateMatchesFeature(transport: object): boolean {
  return wrappedGates.get(transport) === installedGates.get(transport)
}
