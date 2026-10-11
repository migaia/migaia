import {
  createAdapterNodeThreadChannel,
  createAdapterWebThreadChannel
} from '@migaia/rpc-core/adapter/threads'
import type { INodeMessagePortLike } from '@migaia/rpc-core/adapters/message-port'
import type { IThreadChannelOptions, IThreadWebPort } from './types.js'

/** Build the complete Node messaging channel over this actual held resource. */
export function createNodeThreadChannel(
  port: INodeMessagePortLike,
  peerId: string,
  options: IThreadChannelOptions
) {
  return createAdapterNodeThreadChannel(port, peerId, options)
}

/** Build the complete EventTarget messaging channel over this actual held resource. */
export function createWebThreadChannel(
  port: IThreadWebPort,
  peerId: string,
  options: IThreadChannelOptions
) {
  return createAdapterWebThreadChannel(port, peerId, options)
}
