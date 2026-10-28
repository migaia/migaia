/** Dedicated worker leaf of the iframe topology: business providers behind the page's worker. */
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import { dedicatedWorkerPlugin, sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { TopologyLeaf } from '../../../rpc-integration/test/host/fixtures/topology-leaf.ts'
import {
  HopSecret,
  Topology
} from '../../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './topology-names.ts'

/** Native worker configuration is supplied by the creating window, outside the RPC protocol. */
type IWorkerConfiguration = Readonly<{ hopAuth: boolean; nested: boolean }>
/** Whether the page selects the second leaf or auth on the window–worker hop. */
const configuration = JSON.parse((self as unknown as { name: string }).name) as IWorkerConfiguration
/** Receive the native SharedWorker port; the dedicated worker never constructs a SharedWorker. */
function receiveSharedPort(): Promise<MessagePort> {
  return new Promise((resolve) => {
    /** Remove the setup listener before either RPC transport starts observing native messages. */
    const receive = (event: MessageEvent<Record<string, unknown>>) => {
      /** The creating window transfers a real port rather than a second RPC carrier wrapper. */
      const port = event.data?.[BrowserTopology.sharedPort]
      if (!(port instanceof MessagePort)) return
      self.removeEventListener('message', receive)
      resolve(port)
    }
    self.addEventListener('message', receive)
    self.postMessage({ [BrowserTopology.requestSharedPort]: true })
  })
}
/** T2 borrows the transferred port; T1 has no SharedWorker transport. */
const sharedPort = configuration.nested ? await receiveSharedPort() : undefined
/** Providers and counters of this leaf. */
const leaf = new TopologyLeaf()
/** Parent readiness waits for this worker's complete transport batch, including the SharedWorker. */
const opening: Promise<IRpcHost> = createRpcHost({
  self: {
    name: BrowserTopology.worker,
    instanceId: `${BrowserTopology.worker}-${crypto.randomUUID()}`
  },
  plugins: [
    leaf.recorder.plugin,
    dedicatedWorkerPlugin({
      worker: self as never,
      features: configuration.hopAuth ? [authFeature(leaf.auth.options(HopSecret.shared))] : []
    }),
    ...(sharedPort ? [sharedWorkerPlugin({ sharedWorker: { port: sharedPort } })] : [])
  ],
  provide: {
    ...leaf.providers(),
    /** A parent handshake alone is not the ready state of the worker's additional transport. */
    [Topology.ready]: async () => {
      /** Namespace calls use the completed factory, as in the public browser usage examples. */
      const initialized = await opening
      if (sharedPort)
        await initialized.sharedWorker.send(BrowserTopology.sharedLeaf, Topology.ready)
      return true
    },
    /** The forwarding worker retains its own hop rows while the SharedWorker owns leaf counters. */
    [Topology.inspect]: () => ({
      ...leaf.snapshot(),
      forward: leaf.recorder.snapshot().filter((event) => event.stage === RpcProbeStage.forward)
    })
  }
}) as unknown as Promise<IRpcHost>
/** The original leaf identity becomes public only after the complete host construction resolves. */
const host = await opening
leaf.bind(host.self.instanceId)
