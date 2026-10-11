import { createAdapterChannel } from '@migaia/rpc-core/adapter'
import type { IRemoteChannel, IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import type {
  IProcessByteChannel,
  IProcessByteOptions,
  IProcessMessageChannel,
  IProcessMessageOptions
} from './types.js'

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
  return createAdapterChannel(channel as IProcessByteChannel, options as IProcessByteOptions)
}
