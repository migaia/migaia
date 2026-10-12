import type { createProcessPeer, IRuntimeProcessPeerOptions } from '@migaia/rpc-process'
import type { createThreadPeer, IRuntimeThreadPeerOptions } from '@migaia/rpc-threads'
import type { RpcPoolState } from './text.js'

/** This snapshot measures pool client slots and FIFO entries, never provider concurrency. */
export type IRpcPoolStats = Readonly<{
  targetSize: number
  memberCount: number
  inFlight: number
  queued: number
  state: RpcPoolState
}>

/** Pool controls own only the Peers created by their corresponding public factory. */
export type IRpcPoolControls = Readonly<{
  stats(): IRpcPoolStats
  resize(size: number): Promise<void>
  close(): Promise<void>
}>

/** Thread payload, method and transfer types remain exactly those of its public Peer. */
export type IThreadPool<TRemote = Record<never, never>> = Pick<
  Awaited<ReturnType<typeof createThreadPeer<TRemote>>>,
  'request' | 'notify' | 'stream'
> &
  IRpcPoolControls

/** Process call options retain the public owner's prohibition on native transfer lists. */
export type IProcessPool<TRemote = Record<never, never>> = Pick<
  Awaited<ReturnType<typeof createProcessPeer<TRemote>>>,
  'request' | 'notify' | 'stream'
> &
  IRpcPoolControls

/** Common pool limits are validated before acquiring any public Peer. */
export type IRpcPoolOptions = Readonly<{
  size: number
  maxQueue?: number
  idleTimeoutMs?: number
}>

/** Every Thread member receives this exact original source value. */
export type IThreadPoolOptions = IRpcPoolOptions &
  Readonly<{
    spawn: NonNullable<IRuntimeThreadPeerOptions['spawn']>
  }>

/** Every Process member receives this exact original source value. */
export type IProcessPoolOptions = IRpcPoolOptions &
  Readonly<{
    spawn: NonNullable<IRuntimeProcessPeerOptions['spawn']>
  }>
