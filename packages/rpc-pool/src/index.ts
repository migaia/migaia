import { createProcessPeer } from '@migaia/rpc-process'
import { createThreadPeer } from '@migaia/rpc-threads'
import type { IRuntimePeer } from '@migaia/rpc-core/remote'
import { createPool, validatePoolOptions } from './pool.js'
import type { IProcessPool, IProcessPoolOptions, IThreadPool, IThreadPoolOptions } from './types.js'

/**
 * Creates the initial size of independent Thread Peers, then schedules one client operation per
 * member. Idle ties rotate and overflow waits in a bounded FIFO. spawn and probe go through the
 * existing public Thread factory without replacing its handshake, supervision or transfer rules.
 *
 * Resolves after the initial batch is ready; invalid limits reject before native acquisition.
 * Partial startup failure closes successful acquisitions and rejects the original first failure in
 * batch order, reporting secondary cleanup failures. Later Peer errors remain unchanged and are not
 * replayed by the pool. Await close to drain accepted work and close owned Peers; finish active
 * streams first when necessary, since the pool adds no drain timeout.
 */
export async function createThreadPool<TRemote = Record<never, never>>(
  options: IThreadPoolOptions
): Promise<IThreadPool<TRemote>> {
  validatePoolOptions(options)
  return (await createPool(
    options,
    async () =>
      (await createThreadPeer<TRemote>({
        spawn: options.spawn,
        probe: options.probe
      })) as unknown as IRuntimePeer
  )) as unknown as IThreadPool<TRemote>
}

/**
 * Creates independent Process Peers and schedules one client operation per member with rotating
 * idle selection and bounded FIFO waiting. spawn/probe are forwarded to the public Process factory;
 * process launch, restart, authentication, wire and call-option rules remain its own. This factory
 * does not add Thread-style native transfer support.
 *
 * Resolves once the initial batch is ready. Invalid pool limits reject before acquisition; startup
 * failure rolls back successful members without replacing its original primary failure. Runtime
 * Peer failures pass through without automatic business-call replay. The pool owns the created
 * Peers; close drains accepted calls/streams before closing them and has no pool deadline.
 */
export async function createProcessPool<TRemote = Record<never, never>>(
  options: IProcessPoolOptions
): Promise<IProcessPool<TRemote>> {
  validatePoolOptions(options)
  return (await createPool(
    options,
    async () =>
      (await createProcessPeer<TRemote>({
        spawn: options.spawn,
        probe: options.probe
      })) as unknown as IRuntimePeer
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
