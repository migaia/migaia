/** Thread leaf (b's thread c and its pool members): business providers behind a thread carrier. */
import { workerData } from 'node:worker_threads'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { TopologyLeaf } from './topology-leaf.ts'
import { HopSecret, type ITopologyOptions } from './topology-vocabulary.ts'

/** Application options from b's thread recipe. */
const options = (workerData?.data ?? {}) as ITopologyOptions
/** Providers and counters of this leaf. */
const leaf = new TopologyLeaf()
/** Hop-scoped auth on this thread's parent connection only. */
const features = options.hopAuth
  ? [auth(leaf.auth.options(options.hopAuth === 'match' ? HopSecret.shared : HopSecret.other))]
  : []
/** The leaf host connected to b. */
const host = await createRpcHost({
  plugins: [leaf.recorder.plugin, threadPlugin({ connectToParent: true, features })],
  provide: leaf.providers()
})
leaf.bind(host.self.instanceId)
