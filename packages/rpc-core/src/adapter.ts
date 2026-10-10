/**
 * A runtime/carrier adapter gives Core the ordered raw I/O it actually holds. Core constructs the
 * channel, negotiates its protocol and owns its exact trust facts; no registrar is public.
 */
export { createAdapterChannel } from './adapter-owned/process/handshake.js'
export type {
  IProcessMessageChannel,
  IProcessByteChannel,
  IProcessCommonOptions,
  IProcessByteOptions,
  IProcessMessageOptions,
  IProcessByteListener,
  IAuthenticatedProcessChannel,
  IProcessPendingByteConnection,
  IListenProcessByteChannel
} from './adapter-owned/process/types.js'

/** Receive framed bootstrap on held byte I/O and transfer the same decoder into this channel. */
export { receiveAdapterBootstrap } from './adapter-owned/process/bootstrap.js'
