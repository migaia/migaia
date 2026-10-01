import { normalizeRemoteContract, normalizeRemoteHostCatalog } from '../remote/contract.js'
import { serveRemotePlugin, type IRemoteServePluginHandle } from '../remote/serve-plugin.js'
import { serveRemoteHost, type IRemoteServeHostHandle } from '../remote/serve-host.js'
import type { IRemoteChannel } from '../remote/types.js'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'
import type { IServeThreadPluginOptions, IServeThreadHostOptions } from './types.js'

/** Services borrow caller Hosts and share one close Promise for endpoint/channel teardown. */
function ownThreadService(
  service: IRemoteServePluginHandle,
  channel: IRemoteChannel,
  report: (error: unknown) => void
): IRemoteServePluginHandle {
  /** The exact original Promise is returned for every close call. */
  let closing: Promise<void> | undefined
  return Object.freeze({
    close: () =>
      (closing ??= (async () => {
        /** Channel cleanup failure cannot replace an earlier service failure. */
        let primary: unknown
        let failed = false
        try {
          await service.close()
        } catch (error) {
          primary = error
          failed = true
        }
        try {
          await channel.close()
        } catch (error) {
          if (failed) report(error)
          else throw error
        }
        if (failed) throw primary
      })())
  })
}

/** Create an exclusive endpoint and let remote own Plugin service registration/rollback. */
export async function createServeThreadPlugin(
  options: IServeThreadPluginOptions
): Promise<IRemoteServePluginHandle> {
  try {
    /** Reject malformed descriptions before allocating an endpoint. */
    const contract = normalizeRemoteContract(options.contract)
    /** The service side has no supervisor lifecycle, but endpointFactory still receives a signal. */
    const endpoint = await options.endpointFactory(options.channel, new AbortController().signal)
    return ownThreadService(
      await serveRemotePlugin({ ...options, contract, endpoint }),
      options.channel,
      options.report
    )
  } catch (error) {
    try {
      await options.channel.close()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw error
  }
}

/** Forward the local resolver unchanged; never dispose the caller's Host. */
export async function createServeThreadHost(
  options: IServeThreadHostOptions
): Promise<IRemoteServeHostHandle> {
  if (typeof options.resolvePlugin !== 'function')
    invalidThreadConfig('resolvePlugin', ThreadErrorText.invalidServe)
  try {
    /** Catalog admission stays with the canonical remote owner before endpoint construction. */
    const catalog = normalizeRemoteHostCatalog(options.catalog)
    /** Remote owns service endpoint registration after the factory completes. */
    const endpoint = await options.endpointFactory(options.channel, new AbortController().signal)
    return ownThreadService(
      await serveRemoteHost({ ...options, catalog, endpoint }),
      options.channel,
      options.report
    )
  } catch (error) {
    try {
      await options.channel.close()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw error
  }
}
