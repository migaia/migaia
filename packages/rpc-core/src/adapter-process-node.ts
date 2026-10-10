import type { IProcessSpec } from '@migaia/supervision/process'
import { AdapterProcessLaunch } from './adapter-owned/process/launch.js'
import type {
  IAdapterProcessLaunchContext,
  IAdapterProcessLaunchOptions
} from './adapter-owned/process/launch.js'
import { createAdapterChildStdio } from './adapter-node.js'
import type { IAdapterChildStdio } from './adapter-node.js'
import { deferProcessByteReceive } from './adapter-owned/process/channel.js'

/**
 * This Node-specific operation holds one launch while Core constructs its actual child pipe
 * channel.
 */
class NodeAdapterProcessLaunch extends AdapterProcessLaunch {
  /**
   * No existing target transport is accepted; private hand-off facts belong to this newly built
   * channel.
   */
  createChildChannel(child: IAdapterChildStdio) {
    /** Retain the original Node pipe cleanup and native replay observation constructor. */
    const channel = createAdapterChildStdio(child)
    if (this.bootstrap) deferProcessByteReceive(channel)
    return channel
  }
}

/** A Node/Bun launcher supplies its held request, then its actual ChildProcess stdio after spawn. */
export function createAdapterNodeProcessLaunch(
  spec: IProcessSpec,
  context: IAdapterProcessLaunchContext,
  options: IAdapterProcessLaunchOptions = {}
) {
  return new NodeAdapterProcessLaunch(spec, context, options)
}
