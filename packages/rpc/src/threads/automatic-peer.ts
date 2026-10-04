import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { compileRuntimeMethods } from '../remote/runtime-api/catalog.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import { createRuntimePeer, type IRuntimePeerOptions } from '../remote/runtime-api/peer.js'
import {
  readThreadRuntimeBootstrap,
  intersectThreadCapabilities,
  type IThreadRuntimeBootstrap
} from './bootstrap.js'
import { createWebThreadBootstrapHandoff } from './receive-handoff.js'
import { createWebThreadChannel } from './channel.js'
import { ThreadBootstrap, THREAD_RUNTIME_API_VERSION } from './constants.js'
import type { IThreadWebPort } from './types.js'

/** Attach the original EventTarget bootstrap listener synchronously, before any asynchronous import. */
export async function createAutomaticWebThreadPeer(
  options: IRuntimePeerOptions,
  native: IThreadWebPort
) {
  if (options.spawn !== undefined || options.connect !== undefined || options.listen !== undefined)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  compileRuntimeMethods(options.provide)
  /** A real library bootstrap must arrive before any automatic endpoint is constructed. */
  let resolveBootstrap!: (value: IThreadRuntimeBootstrap) => void
  /** Invalid bootstrap, deserialization and cold overflow share one startup failure. */
  let rejectBootstrap!: (error: unknown) => void
  /** Duplicate private metadata is rejected while the same capture owner is active. */
  let bootstrapped = false
  /** The awaited value carries safe routes rather than native lifecycle authority. */
  const prepared = new Promise<IThreadRuntimeBootstrap>((resolve, reject) => {
    resolveBootstrap = resolve
    rejectBootstrap = reject
  })
  /** One capture owns both bootstrap and the at-most-one following application frame. */
  const handoff = createWebThreadBootstrapHandoff(native, {
    consume(message) {
      if (bootstrapped) return false
      /** Parsing a non-library first frame rejects instead of guessing a route or hanging. */
      const bootstrap = readThreadRuntimeBootstrap(message)
      bootstrapped = true
      resolveBootstrap(bootstrap)
      return true
    },
    onFailure: (error) => rejectBootstrap(error)
  })
  try {
    /** No top-level asynchronous boundary precedes physical bootstrap subscription. */
    const bootstrap = await prepared
    return await createRuntimePeer(options, {
      self: bootstrap.self,
      async source(context) {
        native.postMessage(
          {
            kind: ThreadBootstrap.runtimeAcknowledged,
            version: THREAD_RUNTIME_API_VERSION,
            capabilities: context.capabilities
          },
          undefined
        )
        return createWebThreadChannel(
          handoff.port,
          bootstrap.parent.instanceId,
          {
            scheduler: systemScheduler,
            capabilities: intersectThreadCapabilities(context.capabilities, bootstrap.capabilities)
          },
          handoff
        )
      }
    })
  } catch (primary) {
    try {
      handoff.close()
    } catch (cleanup) {
      try {
        options.report(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw primary
  }
}
