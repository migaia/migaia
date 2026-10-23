import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { type IRpcTransport } from '../../../rpc-host/dist/core/index.js'
import type { IProcessCommonOptions } from '../../../rpc-plugin-process/dist/process/types.js'
import { RpcPlatform } from '@migaia/rpc-host/plugin'
import {
  createRuntimeMessageConnection,
  type IRuntimeByteDiagnostics
} from '@migaia/rpc-host/plugin'
import { captureProcessTask } from '../../../rpc-plugin-process/test/protocol.ts'
import type { IRuntimeMessageIO } from '../../../rpc-host/dist/runtime-adapter/byte/types.js'
import type { IRuntimePeerOptions } from '@migaia/rpc-host/plugin'
import { createProcessListenerPeer } from '../../../rpc-plugin-process/test/protocol.ts'
import {
  bindRuntimeByteWire,
  bindRuntimeMessageTransport
} from '../../../rpc-host/dist/runtime-adapter/byte/carrier.js'
import { attachIpcConnection as attachGenericIpcConnection } from '../../../rpc-host/dist/runtime-adapter/byte/ipc-connection.js'
import {
  createRuntimeBytePipeline,
  runtimeMessagePipeline
} from '../../../rpc-host/dist/runtime-adapter/byte/pipeline.js'
import {
  ERROR_SOURCE,
  RpcProcessErrorCode
} from '../../../rpc-plugin-process/dist/process/error-code.js'
import { RpcProcessErrorText } from '../../../rpc-plugin-process/dist/process/error-text.js'
import { attachIpcStderr } from '../../../rpc-plugin-process/dist/process/stderr.js'

/** Historical redaction fixture checks that native stderr payloads stay out of reported records. */
export const CHILD_STDERR_REDACTED = '[child stderr redacted]'

/** Canonical Process diagnostics configure the same relocated generic carrier under observation. */
export const processByteDiagnostics: IRuntimeByteDiagnostics = {
  closed: {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed,
    message: RpcProcessErrorText.channelClosed
  },
  timeout: {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.handshakeTimeout,
    message: RpcProcessErrorText.handshakeTimeout
  },
  authenticationRejected: {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.authRejected,
    message: RpcProcessErrorText.authRejected
  },
  duplicateBinding: RpcProcessErrorText.duplicateBinding,
  optionsInvalid: RpcProcessErrorText.optionsInvalid,
  jsonCodecRequired: RpcProcessErrorText.jsonCodecRequired,
  negotiatedCodecUnsupported: RpcProcessErrorText.negotiatedCodecUnsupported,
  handshakeTimeoutInvalid: RpcProcessErrorText.handshakeTimeoutInvalid
}

/** The canonical Core factory retains the original Process codec identity and diagnostic text. */
export const byteProcessPipeline = createRuntimeBytePipeline(RpcProcessErrorText.expectedString)
/** Existing encoder assertions keep their binding while observing the relocated canonical codec. */
export const remoteProcessJsonCodec = byteProcessPipeline.codec
/** Existing static message assertions observe the same canonical identity/message component pair. */
export const messageProcessPipeline = runtimeMessagePipeline

/** Construct a genuine Core fixed-profile channel over the fixture's actual held message I/O. */
export function createProcessFixtureChannel(
  io: IRuntimeMessageIO,
  options: Readonly<{ peerId: string; scheduler: IScheduler; capabilities?: readonly string[] }>
) {
  return createRuntimeMessageConnection(
    io,
    {
      platform: RpcPlatform.process,
      expectedStringText: RpcProcessErrorText.expectedString,
      peerId: options.peerId,
      scheduler: options.scheduler,
      offer: options.capabilities ?? [],
      report: () => undefined,
      ipc: { connectionId: options.peerId, sessionId: options.peerId, log: () => undefined }
    },
    processByteDiagnostics
  )
}

/** Keep the real Process listener while Core retains its genuine opaque preparation internally. */
export function createProcessFixtureListenerPeer(
  options: IRuntimePeerOptions,
  ingress: Parameters<typeof createProcessListenerPeer>[1]
) {
  return createProcessListenerPeer(options, ingress, captureProcessTask(options))
}

/** Supply only the moved diagnostic/presentation arguments to the same private byte mechanism. */
export function bindProcessByteWire(
  channel: Parameters<typeof bindRuntimeByteWire>[0],
  options: Omit<Parameters<typeof bindRuntimeByteWire>[1], 'platform' | 'expectedStringText'>
) {
  return bindRuntimeByteWire(
    channel,
    {
      ...options,
      platform: RpcPlatform.process,
      expectedStringText: RpcProcessErrorText.expectedString
    },
    processByteDiagnostics
  )
}

/** Supply only the moved diagnostic/presentation arguments to the same whole-message mechanism. */
export function bindProcessMessageTransport(
  channel: Parameters<typeof bindRuntimeMessageTransport>[0],
  options: Omit<
    Parameters<typeof bindRuntimeMessageTransport>[1],
    'platform' | 'expectedStringText'
  >
) {
  return bindRuntimeMessageTransport(
    channel,
    {
      ...options,
      platform: RpcPlatform.process,
      expectedStringText: RpcProcessErrorText.expectedString
    },
    processByteDiagnostics
  )
}

/** Compose the two relocated canonical owners while keeping all existing stderr assertions intact. */
export function attachIpcConnection(
  transport: IRpcTransport,
  ipc: IProcessCommonOptions['ipc'],
  report: (error: unknown) => void,
  scheduler: IScheduler = systemScheduler
) {
  /** Core owns the original gate/log installation; Process owns the original stderr subscription. */
  const attached = attachGenericIpcConnection(transport, ipc, report, scheduler)
  try {
    /** The existing Process subscriber is an actual cleanup resource of the same Core connection. */
    const unsubscribe = attachIpcStderr(attached.log, ipc, report, scheduler)
    attached.ownClose({ close: unsubscribe })
    return attached
  } catch (primary) {
    void attached.close().catch(report)
    throw primary
  }
}
