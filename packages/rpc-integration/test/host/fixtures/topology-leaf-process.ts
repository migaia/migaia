/** Process leaf d: a child process of b that can crash to exercise supervised restart. */
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { TopologyLeaf } from './topology-leaf.ts'
import { Topology } from './topology-vocabulary.ts'

/** Providers and counters of this leaf. */
const leaf = new TopologyLeaf()
/** The leaf host connected to its parent b. */
const host = await createRpcHost({
  plugins: [leaf.recorder.plugin, processPlugin({ connectToParent: true })],
  provide: {
    ...leaf.providers(),
    /** Exit with failure after replying, so b's supervisor restarts a new generation. */
    [Topology.crash]: () => {
      setTimeout(() => process.exit(1), 20)
      return { pid: process.pid }
    }
  }
})
leaf.bind(host.self.instanceId)
