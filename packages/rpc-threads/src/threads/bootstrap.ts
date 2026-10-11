import { receiveThreadData as receiveAdapterThreadData } from '@migaia/rpc-core/adapter/threads'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IThreadWebPort } from './types.js'
export { readThreadBootstrap } from '@migaia/rpc-core/adapter/threads'
export type { IThreadBootstrapData } from '@migaia/rpc-core/adapter/threads'

/** Receive and prepare one real service bootstrap, retaining the original owned Promise. */
export function receiveThreadData(
  port: IThreadWebPort,
  prepare: (data: IRpcPortableValue | undefined, peerId: string) => PromiseLike<void> | void
): Promise<IRpcPortableValue | undefined> {
  return receiveAdapterThreadData(port, prepare)
}
