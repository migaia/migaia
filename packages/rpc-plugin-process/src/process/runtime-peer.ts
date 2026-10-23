import type { IUrlLike } from '@migaia/utils'
import type { IRuntimePeerOptions, IRuntimePeerSource } from '@migaia/rpc-host/plugin'
import type { IProcessHandle } from '@migaia/supervision/process'
import type {
  ISpawnProcessPluginDeployment,
  IConnectProcessPluginDeployment
} from './plugin/types.js'
import type { IRuntimeProcessListen } from './runtime-listener.js'
import type { IProcessShortSpawn, IProcessShortSourceOptions } from './adapters/short-source.js'

/**
 * Public deployed sources reuse the original native spawn and borrowed socket-session
 * specifications.
 */
export type IRuntimeProcessFullPeerOptions<THandle extends IProcessHandle = IProcessHandle> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect' | 'listen' | 'report'
> &
  Readonly<{
    report(error: unknown): void
    spawn?: IRuntimePeerSource | ISpawnProcessPluginDeployment<THandle>
    connect?: IRuntimePeerSource | IConnectProcessPluginDeployment
    listen?: IRuntimePeerSource | IRuntimeProcessListen
  }>

/**
 * Create one source from spawn, connect, or listen; combining them rejects before acquisition.
 * spawn:true relaunches the real main entry, URLs/short objects choose an entry or command, and
 * connect/listen strings select local rendezvous. Function/full deployments retain their explicit
 * ownership. Omitted sources allow child bootstrap discovery; Core owns shared Peer options.
 */
export type IRuntimeProcessPeerOptions<THandle extends IProcessHandle = IProcessHandle> = Omit<
  IRuntimeProcessFullPeerOptions<THandle>,
  'spawn' | 'connect' | 'listen' | 'report'
> &
  IProcessShortSourceOptions &
  Readonly<{
    /** Owned child source; guard parent-only top-level work with isProcessChild for self-spawn. */
    spawn?:
      | IRuntimePeerSource
      | ISpawnProcessPluginDeployment<THandle>
      | true
      | IUrlLike
      | IProcessShortSpawn
    /** Borrow the external process and own only the dialed local session. */
    connect?: IRuntimePeerSource | IConnectProcessPluginDeployment | string
    /** Own a listener and accepted sessions, without launching a process. */
    listen?: IRuntimePeerSource | IRuntimeProcessListen | string
    /** Optional diagnostics sink; omission uses Core's defaultRpcReporter. */
    report?(error: unknown): void
  }>
