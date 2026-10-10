/** Adapter-facing raw I/O and existing Process public options share the canonical Core owner. */
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
} from '@migaia/rpc-core/adapter'
