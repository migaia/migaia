export { postgresBackendKind, postgresBackendPlugin } from './plugin.ts'

export type { IPgCapabilityProbeHookPayload, IPgNotifyHookPayload } from './hooks.ts'
export type {
  IPgNativeOperation,
  IPgListenApi,
  IPgTransactionNotifyApi,
  IPgCopyApi,
  IPgNativeVectorTarget,
  IPgNativeVectorSearchOptions,
  IPgNativeVectorHit,
  IPgNativeVectorApi
} from './types.ts'
export type {
  IPgResult,
  IPgCopyTarget,
  IPgCopyOptions,
  IPgCopySource,
  IPgNativeArrayParameter,
  IPgNativeParameter,
  IPgConnection,
  IPgLogicalReplicationPort,
  IPgLogicalReplicationRoute,
  IPgLogicalReplicationOptions,
  IPgDriver,
  IPgServer,
  IPgCapabilities,
  IPostgresTransactionScope,
  IPostgresStore,
  IPostgresOptions
} from './types.ts'
