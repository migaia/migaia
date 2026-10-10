import { OperationScope } from './operation-scope.js'
import type { IRpcEnvelope, IRpcRuntimeEnvelope } from '../../contract/index.js'
import type { IRpcAbortSignal } from '../typing.js'
import { tagRpcError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcCoreErrorCode } from '../error-code.js'
import { registerTransportConstructionRollback } from './endpoint-bootstrap.js'

/** Existing operation signals and a live settlement check supplied by the outbound owner. */
export type IRpcOutboundAdmission = Readonly<{
  queueSignal?: IRpcAbortSignal
  signals: readonly IRpcAbortSignal[]
  assertCanSend(): void
}>

/** Core operation records alone may defer a queue signal until the existing limiter really waits. */
export abstract class RpcOutboundAdmission {
  /** This is the original caller lifecycle scope, not a replacement signal or cancellation owner. */
  readonly #scope: OperationScope

  constructor(scope: OperationScope) {
    this.#scope = scope
  }

  /** An actual queue read materializes the same original lifecycle-owned signal. */
  get queueSignal(): IRpcAbortSignal {
    return this.#scope.signal
  }

  /** Untagged extension admissions retain their original signal getter/abort policy even at idle. */
  static queuedSignal(
    admission: IRpcOutboundAdmission | undefined,
    waiting: boolean
  ): IRpcAbortSignal | undefined {
    if (!admission) return undefined
    if (#scope in admission && !waiting) return undefined
    return admission.queueSignal
  }
}

/** Minimal port needed by core; capacity and reporting remain in the optional IPC plugin. */
export type IRpcOutboundGate = Readonly<{
  run(
    envelope: IRpcEnvelope | IRpcRuntimeEnvelope,
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
/** Retains only our own wrapper's claim callbacks so a failed construction can retry it. */
const wrapperClaims = new WeakMap<
  object,
  Readonly<{ gate: IRpcOutboundGate; restore(): void; rollback(): void }>
>()

/** Registers one wrapper identity after the plugin has constructed its complete transport. */
export function registerOutboundGate(
  transport: object,
  gate: IRpcOutboundGate,
  claim: Readonly<{ restore(): void; rollback(): void }>
): void {
  if (wrapperClaims.has(transport))
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcGateDuplicated),
      RpcCoreErrorCode.invalidConfig
    )
  claim.restore()
  wrapperClaims.set(transport, { gate, ...claim })
  wrappedGates.set(transport, gate)
  registerTransportConstructionRollback(transport, () => rollbackOutboundGate(transport))
}

/** Reads only the wrapper's WeakMap brand, never a user-supplied transport property. */
export function readOutboundGate(transport: object): IRpcOutboundGate | undefined {
  const gate = wrappedGates.get(transport)
  if (gate) return gate
  const claim = wrapperClaims.get(transport)
  if (!claim) return undefined
  claim.restore()
  wrappedGates.set(transport, claim.gate)
  return claim.gate
}

/** Tests our own wrapper identity even after a failed endpoint released its active claim. */
export function isOutboundGateWrapper(transport: object): boolean {
  return wrapperClaims.has(transport)
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

/** Drops active construction claims without closing a borrowed wrapper needed for retry. */
export function rollbackOutboundGate(transport: object): void {
  installedGates.delete(transport)
  wrappedGates.delete(transport)
  wrapperClaims.get(transport)?.rollback()
}

/** Releases only this Feature's installation after its kernel scope has closed. */
export function releaseInstalledOutboundGate(transport: object, gate: IRpcOutboundGate): void {
  if (installedGates.get(transport) === gate) installedGates.delete(transport)
}

/** Returns whether the wrapped transport and native Feature chose the same gate instance. */
export function outboundGateMatchesFeature(transport: object): boolean {
  return wrappedGates.get(transport) === installedGates.get(transport)
}
