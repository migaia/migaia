import { type IRuntimePeerOptions, type IRuntimePeer } from '@migaia/rpc-core/remote'
import type { IThreadParentPort } from './runtime-types.js'
import { createThreadSourcePeer, type IRuntimeThreadPeerOptions } from './runtime-peer.js'
import { captureThreadTask, type IThreadAdapterTask } from './adapter.js'
import { defaultRpcReporter } from '@migaia/rpc-core'

/**
 * Create an advanced child Peer from the actual parentPort and its original native workerData. Core
 * validates bootstrap/provide and performs the original capability admission; a caller-made
 * metadata shape is not proof of native provenance. A null parent port delegates the configured
 * main-thread source path. The Peer borrows this port and retains Core's normal failure
 * identities.
 */
export function createAdapterNodeThreadPeer(
  options: IRuntimeThreadPeerOptions,
  parentPort: IThreadParentPort | null,
  workerData: unknown
): Promise<IRuntimePeer> {
  return openNodeThreadTask(options, parentPort, workerData, captureThreadTask(options))
}

/** Main factories pass only their already captured task, without adding a public trust parameter. */
export function openNodeThreadTask(
  options: IRuntimeThreadPeerOptions,
  parentPort: IThreadParentPort | null,
  workerData: unknown,
  task: IThreadAdapterTask
): Promise<IRuntimePeer> {
  /** The original early admission and genuine Host context are retained by the SDK task. */
  const preparation = task.preparation
  if (!parentPort)
    return typeof options.spawn === 'object'
      ? createThreadSourcePeer(options, undefined, task)
      : preparation.peer({
          ...options,
          self: preparation.context.self,
          report: options.report ?? defaultRpcReporter
        } as IRuntimePeerOptions)
  /** Core reads the same actual workerData and keeps the closed admission snapshot private. */
  /** Identity, local provider compilation, generation and actual ACK remain one Core operation. */
  return task.messagePeer(
    (options.report ? options : { ...options, report: defaultRpcReporter }) as IRuntimePeerOptions,
    parentPort,
    { direction: 'inbound', read: () => workerData }
  )
}
