import {
  createAdapterConfigurationTypeError,
  createRuntimeByteConnection,
  createRuntimeMessageConnection
} from '@migaia/rpc-core/adapter'
import type { IRuntimeByteOptions } from '@migaia/rpc-core/adapter'
import type { IRemoteChannel, IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import type {
  IProcessByteChannel,
  IProcessByteOptions,
  IProcessMessageChannel,
  IProcessMessageOptions
} from './types.js'
import { ProcessChannelDiagnostics } from './diagnostics.js'
import { RpcProcessErrorText } from './error-text.js'
import { attachProcessChannelStderr } from './stderr.js'
import { processConnectionOptions } from './connection-options.js'

/** Construct a process byte channel through the Core owner, preserving its original Promise. */
export function createProcessTransport(
  channel: IProcessByteChannel,
  options: IProcessByteOptions
): Promise<IRuntimePeerSourceResult>
/** Construct a static message channel without adding a wire handshake. */
export function createProcessTransport(
  channel: IProcessMessageChannel,
  options: IProcessMessageOptions
): Promise<IRemoteChannel>
/** This actual Process entry owns its package-instance boundary before Core acquires resources. */
export function createProcessTransport(
  channel: IProcessByteChannel | IProcessMessageChannel,
  options: IProcessByteOptions | IProcessMessageOptions
): Promise<IRuntimePeerSourceResult> {
  try {
    if (channel.kind === 'message') {
      if (!('staticAgreement' in options))
        throw createAdapterConfigurationTypeError(RpcProcessErrorText.optionsInvalid)
      /** Existing public declaration equality is validated before Core acquires any physical reader. */
      const local = options.staticAgreement?.local
      /**
       * Peer declaration remains caller validation only; it can never grant Core expansion
       * authority.
       */
      const peer = options.staticAgreement?.peer
      if (
        !local ||
        !peer ||
        local.codec !== 'identity' ||
        peer.codec !== 'identity' ||
        local.capabilities.length !== peer.capabilities.length ||
        local.capabilities.some((capability, index) => capability !== peer.capabilities[index])
      )
        throw createAdapterConfigurationTypeError(RpcProcessErrorText.staticAgreementMismatch)
      return createRuntimeMessageConnection(
        channel,
        Object.create(processConnectionOptions(options), {
          offer: { value: local.capabilities, enumerable: true }
        }),
        ProcessChannelDiagnostics
      )
    }
    if (!('role' in options))
      throw createAdapterConfigurationTypeError(RpcProcessErrorText.optionsInvalid)
    return createRuntimeByteConnection(
      channel,
      Object.create(processConnectionOptions(options), {
        role: { get: () => options.role, enumerable: true },
        offer: { get: () => options.offer, enumerable: true },
        auth: { get: () => ('auth' in options ? options.auth : undefined), enumerable: true }
      }) as IRuntimeByteOptions,
      ProcessChannelDiagnostics
    ).then((connection) => attachProcessChannelStderr(connection, options))
  } catch (error) {
    // The original async owner rejected validation failures without changing successful promises.
    return Promise.reject(error)
  }
}

/** The moved former Core operation uses this same Process-owned implementation. */
export { createProcessTransport as createAdapterChannel }
