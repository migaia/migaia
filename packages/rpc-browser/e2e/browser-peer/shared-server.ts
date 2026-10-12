import { createBrowserPeer } from '@migaia/rpc-browser'
import type { IRuntimePeer } from '@migaia/rpc-core/remote'
import { fixtureProviders } from './api.js'

/** The Core listener owns the actual accepted-session directory used by the business query. */
const listener: IRuntimePeer = await createBrowserPeer({
  listen: globalThis as never,
  provide: {
    ...fixtureProviders(),
    sessions: async () => (await listener.describe()).connections.length
  }
})
