/** SharedWorker leaf of T2, reached through the port transferred to the dedicated worker. */
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { TopologyLeaf } from '../../../rpc-integration/test/host/fixtures/topology-leaf.ts'
import { BrowserTopology } from './topology-names.ts'

/** Business providers and execution counters belong solely to this leaf realm. */
const leaf = new TopologyLeaf()
/**
 * The native connect listener accepts the same port the window transferred to the forwarding
 * worker.
 */
const host = await createRpcHost({
  self: {
    name: BrowserTopology.sharedLeaf,
    instanceId: `${BrowserTopology.sharedLeaf}-${crypto.randomUUID()}`
  },
  plugins: [leaf.recorder.plugin, sharedWorkerPlugin({ listen: globalThis as never })],
  provide: leaf.providers()
})
leaf.bind(host.self.instanceId)
