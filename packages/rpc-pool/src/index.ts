import { createProcessPeer } from '@migaia/rpc-process'
import { createThreadPeer } from '@migaia/rpc-threads'
import type { IRuntimePeer } from '@migaia/rpc-core/remote'
import { createPool, validatePoolOptions } from './pool.js'
import type { IProcessPool, IProcessPoolOptions, IThreadPool, IThreadPoolOptions } from './types.js'

/** Create independent Thread Peers using the caller's exact original spawn source and policy. */
export async function createThreadPool<TRemote = Record<never, never>>(
  options: IThreadPoolOptions
): Promise<IThreadPool<TRemote>> {
  validatePoolOptions(options)
  return (await createPool(
    options,
    async () =>
      (await createThreadPeer<TRemote>({ spawn: options.spawn })) as unknown as IRuntimePeer
  )) as unknown as IThreadPool<TRemote>
}

/** Create independent Process Peers without overriding native restart or transfer semantics. */
export async function createProcessPool<TRemote = Record<never, never>>(
  options: IProcessPoolOptions
): Promise<IProcessPool<TRemote>> {
  validatePoolOptions(options)
  return (await createPool(
    options,
    async () =>
      (await createProcessPeer<TRemote>({ spawn: options.spawn })) as unknown as IRuntimePeer
  )) as unknown as IProcessPool<TRemote>
}

export { RpcPoolErrorCode, RPC_POOL_ERROR_SOURCE, type IRpcPoolErrorCode } from './error-code.js'
export { RpcPoolState } from './text.js'
export type {
  IRpcPoolStats,
  IRpcPoolControls,
  IProcessPool,
  IProcessPoolOptions,
  IThreadPool,
  IThreadPoolOptions
} from './types.js'
