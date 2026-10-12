import { parentPort } from 'node:worker_threads'
import { AdapterNodeThreadParentChannel } from '../node-parent.js'
import type { IThreadParentPort } from '../runtime-types.js'
import {
  createAdapterNodeThreadLauncher,
  createAdapterNodeThreadChannelFactory
} from '../node-launcher.js'
import type { IRuntimePeerSourceContext } from '@migaia/rpc-core/remote'
import type { IThreadChannelOptions } from '../types.js'
import { threadRuntimeResource } from '../runtime-resource.js'
export type { INodeThreadHandle } from '../node-launcher.js'

/** Actual child import borrows its held port but preserves the original listener-free cold state. */
const parentChannel = parentPort ? borrowNodeThreadParent(parentPort) : undefined
// Retain the complete borrowed resource without publishing a startup or provenance helper.
void parentChannel

/** Acquire the complete held-parent resource; no registrar or target transport crosses packages. */
function borrowNodeThreadParent(port: IThreadParentPort): AdapterNodeThreadParentChannel {
  return new AdapterNodeThreadParentChannel(port)
}

/** Launch this runtime's actual Worker through the complete Core-owned execution operation. */
export function createNodeThreadLauncher(
  options: Readonly<{
    runtimeApi?: IRuntimePeerSourceContext
    /** Explicit runtime flags apply to short entries without replaying their parent's controller. */
    execArgv?: readonly string[]
  }> = {}
) {
  return createAdapterNodeThreadLauncher(threadRuntimeResource, options)
}

/** Construct the factory over Core-owned handles or the existing strict custom raw-port shape. */
export function createNodeThreadChannelFactory(options: IThreadChannelOptions) {
  return createAdapterNodeThreadChannelFactory(options)
}
