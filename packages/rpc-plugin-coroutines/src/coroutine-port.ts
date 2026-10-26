/**
 * Adapts the task-held MessagePort receiver, postMessage transfer and raw observations to SDK
 * carrier IO. The original coroutine task retains physical port closure.
 */
import {
  createRpcMessageCarrier,
  createRpcBackingDigest,
  RpcCarrierObservation
} from '@migaia/rpc-host/sdk'
import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'
import { defaultRpcReporter } from '@migaia/rpc-host'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection,
  type IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import type { ICoroutineMessagePort } from './coroutine-task.js'
import { CoroutineText } from './error-text.js'
import { inspectThenable, assimilateCapturedThen } from '@migaia/utils/function'

/** Native EventTarget receiver adaptation owns activation only; the SDK owns capture and codec IO. */
export class CoroutinePort implements IRpcMessageIO {
  /** This exact native MessagePort supplies its own cold facts and actual raw IO observations. */
  readonly observation: RpcCarrierObservation
  /** The original MessagePort keeps its builtin receiver and transfer authority. */
  readonly #port: ICoroutineMessagePort
  /** The first genuine message listener starts native delivery exactly once. */
  #started = false
  /** Borrow the task's exact physical port; task settlement remains its only physical close owner. */
  constructor(port: ICoroutineMessagePort, report: (error: unknown) => void = defaultRpcReporter) {
    this.#port = port
    this.observation = new RpcCarrierObservation(
      {
        platform: RpcCarrierPlatform.messagePort,
        topology: RpcCarrierTopology.exclusive,
        encodedType: RpcCarrierEncoding.any
      },
      report
    )
  }
  /** Native message identity and the caller's original transfer list stay unchanged. */
  send(
    value: unknown,
    transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): void | Promise<void> {
    /** Original void callbacks keep the native synchronous handoff path. */
    const started: unknown = (0, options?.onWriteStart)?.()
    /** Capture actual asynchronous admission without rereading its then getter. */
    const inspection = inspectThenable(started)
    if ('error' in inspection) throw inspection.error
    if (inspection.then) {
      /** Only a pending seal retains these original native write facts. */
      const operation = { owner: this, value, transfer }
      return assimilateCapturedThen<void>(inspection.then, started).then(() =>
        operation.owner.#sendNative(operation.value, operation.transfer)
      )
    }
    this.#sendNative(value, transfer)
  }
  /** Task-owned ports and exact transfer lists remain the only native physical authority. */
  #sendNative(value: unknown, transfer?: readonly ArrayBuffer[]): void {
    this.observation.emit(RpcProbeDirection.outbound, value, transfer)
    this.#port.postMessage(value, transfer)
  }
  /** Activate delivery only after the actual native listener has been acquired. */
  onMessage(listener: (value: unknown) => void): () => void {
    /** One native event wrapper unwraps data without cloning or parsing. */
    const remove = this.#listen(CoroutineText.message, (event) => {
      /** Native data is read once before readonly observation and delivery share its original value. */
      const data = event.data
      this.observation.emit(RpcProbeDirection.inbound, data)
      listener(data)
    })
    if (!this.#started) {
      this.#started = true
      this.#port.start()
    }
    return remove
  }
  /** Native EOF contains no invented lifecycle reason. */
  onClose(listener: (reason?: unknown) => void): () => void {
    return this.#listen(CoroutineText.close, () => listener())
  }
  /** Preserve the original native deserialization event as the physical error. */
  onError(listener: (error: unknown) => void): () => void {
    return this.#listen(CoroutineText.messageerror, listener)
  }
  /** Exact listener receipts remove their original native receiver without a borrowed-port facade. */
  #listen(type: string, listener: (event: any) => void): () => void {
    this.#port.addEventListener(type, listener)
    /** The remover retains one explicit original acquisition record. */
    const entry = { port: this.#port, type, listener }
    return () => entry.port.removeEventListener(entry.type, entry.listener)
  }
  /** Only the task wrapper closes actual ports after user finally; carrier retirement removes hooks. */
  close(): void {}
}

/** One actual channel uses the shared canonical codec/receiver rather than identity or ACK bridges. */
export function coroutineCarrier(
  port: ICoroutineMessagePort,
  id: string,
  report: (error: unknown) => void
) {
  /** One native IO owner lends the exact same observation capability to its carrier. */
  const io = new CoroutinePort(port, report)
  return createRpcMessageCarrier({
    id,
    closingWrites: true,
    observation: io.observation,
    report,
    nativeBinary: true,
    digest: createRpcBackingDigest(),
    io
  })
}
