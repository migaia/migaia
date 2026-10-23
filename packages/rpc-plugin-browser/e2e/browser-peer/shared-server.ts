import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { createRpcHost } from '@migaia/rpc-host'
import type { IRpcHost } from '@migaia/rpc-host'
import { fixtureProviders } from './api.js'

/** The Core listener owns the actual accepted-session directory used by the business query. */
const listener: IRpcHost = await createRpcHost({
  plugins: [sharedWorkerPlugin({ listen: globalThis as never })],
  provide: {
    ...fixtureProviders(),
    sessions: async () => (await listener.describe()).connections.length
  }
})
