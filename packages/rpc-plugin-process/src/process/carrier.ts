/**
 * Combines genuine Process byte/message IO with installed queue, flow and stderr features at the
 * SDK carrier boundary. Host retains semantic handshake, pending calls and provider execution.
 */
import { deferred } from '@migaia/utils/promise'
import { inspectThenable, assimilateCapturedThen } from '@migaia/utils/function'
import {
  createRpcByteCarrier,
  createRpcMessageCarrier,
  RpcCarrierObservation,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, tagRpcError } from '@migaia/rpc-contract/errors'
import {
  RpcCarrierPlatform,
  RpcCarrierTopology,
  RpcCarrierEncoding,
  RpcProbeDirection,
  RpcSessionRetirement,
  type IRpcCarrier,
  type IRpcCarrierWriteOptions,
  type IRpcWriteAdmission
} from '@migaia/rpc-contract/interfaces'
import { type IpcFlowControl } from '../features/flow-control.js'
import type { IpcSendQueue } from '../features/send-queue.js'
import { ProcessFeatureName } from '../features/text.js'
import type { IProcessFeatureContext } from '../features/metadata.js'
import type { IProcessFeature } from './plugin/types.js'
import { attachIpcStderr } from './stderr.js'
import {
  createProcessChannelClosedError,
  createProcessCleanupError,
  createProcessError
} from './error.js'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import type { IProcessByteChannel, IProcessMessageChannel, IProcessCommonOptions } from './types.js'

/** One actual native connection owns its installed feature resources and diagnostic labels. */
export type IProcessCarrierOptions = Readonly<{
  id: string
  features?: readonly IProcessFeature[]
  ipc?: IProcessCommonOptions['ipc']
  /** Only actual spawned units lend their original native exit receipt to Session's close budget. */
  terminalReason?: IRpcCarrier['terminalReason']
}>

/** Only the actual Process carrier maps an explicit governor liquidation into its native domain. */
function mapProcessRetirement(kind: RpcSessionRetirement, error: unknown): unknown {
  return kind === RpcSessionRetirement.liquidated
    ? createProcessError(RpcProcessErrorCode.liquidated, error)
    : error
}

/** Translate only an actual native write failure at this Process-owned carrier boundary. */
async function writeProcessFrame(write: () => void | Promise<void>): Promise<void> {
  try {
    await write()
  } catch (cause) {
    throw createProcessChannelClosedError(cause)
  }
}

/** Complete native features surround the actual IO writer without inspecting its encoded payload. */
class ProcessCarrierFeatures {
  /** The original acquired native resource remains the sole physical writer and close owner. */
  readonly #raw: IProcessByteChannel | IProcessMessageChannel
  /** Actual installation facts supply shutdown and the existing diagnostic reporter. */
  readonly #context: IRpcTransportSetupContext
  /** One queue, if selected, borrows exactly the original installed flow. */
  #queue: IpcSendQueue | undefined
  /** The selected admission owner alone maintains capacities and pending-write receipts. */
  #flow: IpcFlowControl | undefined
  /** Installation rollback and shutdown release only resources acquired by this connection. */
  readonly #disposers: (() => void)[] = []
  /** Physical close and all original in-flight writes are joined once. */
  #closing: Promise<void> | undefined

  /** Install flow before queue and log; caller mutation cannot replace selected complete instances. */
  constructor(
    raw: IProcessByteChannel | IProcessMessageChannel,
    context: IRpcTransportSetupContext,
    options: IProcessCarrierOptions
  ) {
    this.#raw = raw
    this.#context = context
    /** One cold selection avoids installing a feature or shared flow more than once. */
    const selected = new Map<string, Extract<IProcessFeature, { kind: string }>>()
    for (const feature of options.features ?? []) {
      if (!('kind' in feature)) continue
      if (selected.has(feature.kind))
        throw tagRpcError(
          new TypeError(RpcCoreErrorText.ipcGateDuplicated),
          RpcCoreErrorCode.invalidConfig
        )
      selected.set(feature.kind, feature)
    }
    /** Feature owner identity remains the concrete transport's actual host-local namespace. */
    const facts: IProcessFeatureContext = {
      owner: context.namespace,
      namespace: context.namespace,
      signal: context.signal,
      report: context.report,
      connectionId: options.ipc?.connectionId ?? options.id,
      sessionId: options.ipc?.sessionId
    }
    try {
      /** Definitions keep their exact identity so a shared flow is never reconstructed. */
      const flow = selected.get(ProcessFeatureName.flowControl)
      /** Queue carries either its explicit shared definition or its own default definition. */
      const queue = selected.get(ProcessFeatureName.sendQueue)
      /** Log borrows the same admission events and has no independent native reader. */
      const log = selected.get(ProcessFeatureName.log)
      if (flow?.kind === ProcessFeatureName.flowControl) {
        /** One installation owns the original lane state. */
        const installed = flow.install(facts)
        this.#flow = installed.value
        this.#disposers.push(installed.dispose)
      }
      if (queue?.kind === ProcessFeatureName.sendQueue) {
        /** The concrete process explicitly lends the exact selected definition/value pair. */
        const installed = queue.install({
          ...facts,
          ...(flow?.kind === ProcessFeatureName.flowControl && this.#flow
            ? { flow: { feature: flow, value: this.#flow } }
            : {})
        })
        this.#queue = installed.value
        this.#flow = installed.value.flow
        this.#disposers.push(installed.dispose)
      }
      if (log?.kind === ProcessFeatureName.log) {
        /** Only this physical connection's original gate publishes its logging records. */
        const installed = log.install({
          ...facts,
          gate: this.#flow,
          onReportError: (error) => context.report(error)
        })
        this.#disposers.push(installed.dispose)
        if (options.ipc)
          this.#disposers.push(attachIpcStderr(installed.value, options.ipc, context.report))
      }
    } catch (error) {
      this.#dispose()
      throw error
    }
  }
  /** The actual selected native feature reserves capacity before frame transformations begin. */
  readonly reserveWrite = (options?: IRpcCarrierWriteOptions): IRpcWriteAdmission | undefined => {
    if (!this.#flow || options?.sendClass === undefined) return undefined
    /** Header-derived facts remain local rather than being recovered from an opaque codec frame. */
    const facts = { sendClass: options.sendClass, trace: options.trace }
    return this.#queue ? this.#queue.reserveWrite(facts) : this.#flow.reserveWrite(facts)
  }
  /** Gate only trusted Session-supplied facts; native bootstrap writes retain their original path. */
  run(write: () => void | Promise<void>, options?: IRpcCarrierWriteOptions): Promise<void> {
    if (!this.#flow || options?.sendClass === undefined) return Promise.resolve(write())
    /** Original write facts and signal are borrowed directly from the actual physical handoff. */
    const facts = { sendClass: options.sendClass, trace: options.trace }
    return this.#queue
      ? this.#queue.run(facts, write, { signal: options.signal, admission: options.admission })
      : this.#flow.run(facts, write, { signal: options.signal, admission: options.admission })
  }
  /** Dispose observers and close queue admission before native physical cleanup settles writes. */
  #dispose(): void {
    for (let index = this.#disposers.length - 1; index >= 0; index--) {
      try {
        this.#disposers[index]()
      } catch (error) {
        this.#context.report(error)
      }
    }
    this.#disposers.length = 0
  }
  /** Native close precedes idle join, so backpressured active writes cannot deadlock shutdown. */
  close(reason?: unknown): Promise<void> {
    if (this.#closing) return this.#closing
    /** Publish before a disposer/reporter can reenter this physical resource's close. */
    const pending = deferred<void>()
    this.#closing = pending.promise
    this.#dispose()
    void this.#release(reason).then(pending.resolve, pending.reject)
    return this.#closing
  }
  /** Physical close settles native writes before the existing flow's idle join. */
  async #release(reason: unknown): Promise<void> {
    /** Preserve native-close failure before any subsequent original drain failure. */
    const errors: unknown[] = []
    try {
      await this.#raw.close(reason)
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#flow?.whenIdle()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw createProcessCleanupError(errors)
  }
}

/** A queued byte write retains only this actual native operation until physical settlement. */
type IProcessByteOperation = Readonly<{
  raw: IProcessByteChannel
  features: ProcessCarrierFeatures
  chunk: Uint8Array
  write?: IRpcCarrierWriteOptions
}>

/** Message handoff borrows the original transfer and options with this connection's one observer. */
type IProcessMessageOperation = Readonly<{
  raw: IProcessMessageChannel
  features: ProcessCarrierFeatures
  observation: RpcCarrierObservation
  value: unknown
  transfer?: readonly ArrayBuffer[]
  write?: IRpcCarrierWriteOptions
}>

/** Native close and error subscriptions share the same Process-domain error presentation. */
function subscribeProcessClose(
  raw: IProcessByteChannel | IProcessMessageChannel,
  listener: (reason?: unknown) => void
) {
  return raw.onClose((cause) => listener(createProcessChannelClosedError(cause)))
}

/** Only a source with this actual error subscription capability enters this operation. */
function subscribeProcessError(raw: IProcessMessageChannel, listener: (error: unknown) => void) {
  return raw.onError!((cause) => listener(createProcessChannelClosedError(cause)))
}

/** Observe the original raw input through its one native callback before the same codec listener. */
function subscribeProcessMessage(
  raw: IProcessMessageChannel,
  observation: RpcCarrierObservation,
  listener: (value: unknown) => void
) {
  /** This exact subscription owns only its original observer and receiver callback. */
  const entry = { observation, listener }
  return raw.onMessage((value) => {
    entry.observation.emit(RpcProbeDirection.inbound, value)
    entry.listener(value)
  })
}

/** Enter the original feature gate once; only its accepted write reaches the native byte owner. */
function runProcessByteWrite(operation: IProcessByteOperation): Promise<void> {
  return operation.features.run(() => writeProcessBytes(operation), operation.write)
}

/** The existing byte IO retains exact chunk/options identities and its actual write-start point. */
function writeProcessBytes(operation: IProcessByteOperation): Promise<void> {
  return writeProcessFrame(() => operation.raw.write(operation.chunk, operation.write))
}

/** A queued message retains its original native operation without an inner closure component. */
function runProcessMessageWrite(operation: IProcessMessageOperation): Promise<void> {
  return operation.features.run(() => writeProcessMessage(operation), operation.write)
}

/** Observe only the actual admitted handoff and remove its already-invoked callback exactly once. */
function writeProcessMessage(operation: IProcessMessageOperation): Promise<void> {
  /** These are the same original callback and remaining options used before this owner move. */
  const { onWriteStart, ...physical } = operation.write ?? {}
  /** Native queue admission has already occurred; only a real asynchronous seal delays send. */
  const started: unknown = onWriteStart?.()
  /** Capturing then once preserves hostile getter and callback primary identities. */
  const inspection = inspectThenable(started)
  if ('error' in inspection) throw inspection.error
  if (inspection.then)
    return assimilateCapturedThen<void>(inspection.then, started).then(() =>
      handoffProcessMessage(operation, physical)
    )
  return handoffProcessMessage(operation, physical)
}

/** The original observation and native send occur together after the existing handoff callback. */
function handoffProcessMessage(
  operation: IProcessMessageOperation,
  physical: IRpcCarrierWriteOptions
): Promise<void> {
  operation.observation.emit(RpcProbeDirection.outbound, operation.value, operation.transfer)
  return writeProcessFrame(() =>
    operation.raw.send(
      operation.value,
      operation.transfer,
      operation.write === undefined ? undefined : physical
    )
  )
}

/** Bind real bytes/messages to the sole SDK codec and retain Process's lack of native transfer. */
export function createProcessCarrier(
  raw: IProcessByteChannel | IProcessMessageChannel,
  context: IRpcTransportSetupContext,
  options: IProcessCarrierOptions
): IRpcCarrier {
  /** Feature execution belongs at the original physical writer, outside opaque codec values. */
  const features = new ProcessCarrierFeatures(raw, context, options)
  try {
    if (raw.kind === 'byte')
      return createRpcByteCarrier({
        id: options.id,
        closingWrites: true,
        mapRetirement: mapProcessRetirement,
        terminalReason: options.terminalReason,
        report: context.report,
        reserveWrite: features.reserveWrite,
        observation: raw.observation,
        io: {
          kind: raw.kind,
          onData: (listener) => raw.onData(listener),
          onClose: (listener) => subscribeProcessClose(raw, listener),
          write: (chunk, write) => runProcessByteWrite({ raw, features, chunk, write }),
          close: (reason) => features.close(reason)
        }
      })
    /** The custom whole-message source lends actual raw values through its original native calls. */
    const observation = new RpcCarrierObservation(
      {
        platform: RpcCarrierPlatform.process,
        topology: RpcCarrierTopology.exclusive,
        encodedType: RpcCarrierEncoding.any
      },
      context.report
    )
    /** One explicit connection keeps raw IO, its installed gate and observer under the same owner. */
    const connection = { raw, features, observation }
    return createRpcMessageCarrier({
      id: options.id,
      closingWrites: true,
      mapRetirement: mapProcessRetirement,
      terminalReason: options.terminalReason,
      report: context.report,
      reserveWrite: features.reserveWrite,
      nativeBinary: false,
      observation,
      io: {
        onMessage: (listener) =>
          subscribeProcessMessage(connection.raw, connection.observation, listener),
        onClose: (listener) => subscribeProcessClose(connection.raw, listener),
        onError: connection.raw.onError
          ? (listener) => subscribeProcessError(connection.raw, listener)
          : undefined,
        send: (value, transfer, write) =>
          runProcessMessageWrite({ ...connection, value, transfer, write }),
        close: (reason) => connection.features.close(reason)
      }
    })
  } catch (primary) {
    void features.close(primary).catch(context.report)
    throw primary
  }
}
