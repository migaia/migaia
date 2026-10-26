/** SharedWorker hub of the cross-tab topology: forwards one tab's calls to another tab. */
import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import {
  Topology,
  TopologyRecorder
} from '../../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './topology-names.ts'

/** Forward-stage observation of this hub. */
const recorder = new TopologyRecorder()
await createRpcHost({
  self: { name: BrowserTopology.hub, instanceId: `${BrowserTopology.hub}-${crypto.randomUUID()}` },
  plugins: [recorder.plugin, sharedWorkerPlugin({ listen: globalThis as never })],
  provide: {
    [Topology.inspect]: () => ({
      forward: recorder.snapshot().filter((event) => event.stage === RpcProbeStage.forward)
    })
  }
})
