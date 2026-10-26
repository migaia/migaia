/** Thread leaf (b's thread c and its pool members): business providers behind a thread carrier. */
import { workerData } from 'node:worker_threads'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { TopologyLeaf } from './topology-leaf.ts'
import {
  HopSecret,
  Topology,
  topologyLoopMethod,
  type ITopologyOptions
} from './topology-vocabulary.ts'

/** Application options from b's thread recipe. */
const options = (workerData?.data ?? {}) as ITopologyOptions
/** Providers and counters of this leaf. */
const leaf = new TopologyLeaf()
/** Hop-scoped auth on this thread's parent connection only. */
const features = options.hopAuth
  ? [auth(leaf.auth.options(options.hopAuth === 'match' ? HopSecret.shared : HopSecret.other))]
  : []
/** The leaf host connected to b. */
const opening: Promise<IRpcHost> = createRpcHost({
  plugins: [leaf.recorder.plugin, threadPlugin({ connectToParent: true, features })],
  provide: {
    ...leaf.providers(),
    ...(options.loop
      ? {
          /** Publish the parent's actual held method; no ordinary callback starts a new route. */
          [Topology.prepareLoop]: async () => {
            /** Complete this realm's own construction before reading its accepted parent directory. */
            const host = await opening
            host.provide({
              [Topology.loop]: await topologyLoopMethod(host.thread, Topology.b)
            })
            return true
          }
        }
      : {})
  }
}) as unknown as Promise<IRpcHost>
/** Binding waits for this exact leaf factory rather than the parent's construction. */
const host = await opening
leaf.bind(host.self.instanceId)
