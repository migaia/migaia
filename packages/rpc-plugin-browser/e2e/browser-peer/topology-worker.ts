/** Dedicated worker leaf of the iframe topology: business providers behind the page's worker. */
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { TopologyLeaf } from '../../../rpc-integration/test/host/fixtures/topology-leaf.ts'
import { HopSecret } from '../../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './topology-names.ts'

/** Whether the page installs auth on the window–worker hop. */
const hopAuth = (self as unknown as { name: string }).name === 'auth'
/** Providers and counters of this leaf. */
const leaf = new TopologyLeaf()
/** The leaf host connected to the page that created this worker. */
const host = await createRpcHost({
  self: { name: BrowserTopology.worker, instanceId: `${BrowserTopology.worker}-${crypto.randomUUID()}` },
  plugins: [
    leaf.recorder.plugin,
    dedicatedWorkerPlugin({
      worker: self as never,
      features: hopAuth ? [auth(leaf.auth.options(HopSecret.shared))] : []
    })
  ],
  provide: leaf.providers()
})
leaf.bind(host.self.instanceId)
