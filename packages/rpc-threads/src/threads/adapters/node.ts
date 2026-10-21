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

/** Actual child import borrows its held port but preserves the original listener-free cold state. */
const parentChannel = parentPort ? borrowNodeThreadParent(parentPort) : undefined
// Retain the complete borrowed resource without publishing a startup or provenance helper.
void parentChannel

/** Acquire the complete held-parent resource; no registrar or target transport crosses packages. */
function borrowNodeThreadParent(port: IThreadParentPort): AdapterNodeThreadParentChannel {
  return new AdapterNodeThreadParentChannel(port)
}

/**
 * Create a Node worker_threads launcher without starting a Worker. launch requires an absolute
 * entry, validates portable initialization data, and retains native error/exit events. Node
 * advertises enforced termination, exit observation and heap limits; this does not isolate OS
 * permissions or provide a separate process. Options default to {}, retaining native execArgv
 * inheritance.
 */
export function createNodeThreadLauncher(
  options: Readonly<{
    /** Optional explicit runtime context; the actual held launch proposal takes precedence. */
    runtimeApi?: IRuntimePeerSourceContext
    /** Explicit runtime flags apply to short entries without replaying their parent's controller. */
    execArgv?: readonly string[]
  }> = {}
) {
  return createAdapterNodeThreadLauncher(threadRuntimeResource, options)
}

/**
 * Build the Node channel factory with a required borrowed scheduler. Exact launcher handles retain
 * their preparation and actual capability ACK, while custom raw ports keep the fixed profile.
 * Channel closure and supervisor termination have separate ownership; opening failure of a genuine
 * launched handle requests termination and retains the primary failure.
 */
export function createNodeThreadChannelFactory(options: IThreadChannelOptions) {
  return createAdapterNodeThreadChannelFactory(options)
}
