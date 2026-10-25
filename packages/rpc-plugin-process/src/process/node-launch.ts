/**
 * Specializes the original launch operation for acquired Node/Bun child pipes. Native bootstrap
 * preparation stays shared, while the receiving Host owns Session admission.
 */
import type { IProcessSpec } from '@migaia/supervision/process'
import { AdapterProcessLaunch } from './launch.js'
import type { IAdapterProcessLaunchContext, IAdapterProcessLaunchOptions } from './launch.js'
import { createAdapterChildStdio, type IAdapterChildStdio } from './node-io.js'

/** Node/Bun physical acquisition stays in Process while Core owns the generic byte carrier. */
class NodeAdapterProcessLaunch extends AdapterProcessLaunch {
  /** Construct the actual returned child pipes; the later Core handshake owns receive activation. */
  createChildChannel(child: IAdapterChildStdio) {
    return createAdapterChildStdio(child)
  }
}

/** Prepare one actual supervised launch before its native spawn or secret write. */
export function createAdapterNodeProcessLaunch(
  spec: IProcessSpec,
  context: IAdapterProcessLaunchContext,
  options: IAdapterProcessLaunchOptions = {}
) {
  return new NodeAdapterProcessLaunch(spec, context, options)
}
