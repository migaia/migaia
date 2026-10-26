/**
 * One tab of the cross-tab topology: connects to the shared hub, provides leaf business, and can
 * call another tab through the hub.
 */
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { TopologyLeaf } from '../../../rpc-integration/test/host/fixtures/topology-leaf.ts'
import { Topology } from '../../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './topology-names.ts'

/** This tab's peer name, chosen by the test through the query string. */
const tabName = new URL(location.href).searchParams.get('tab')!
/** Providers and counters of this tab as a leaf. */
const leaf = new TopologyLeaf()

/** Connect this tab to the hub SharedWorker. */
async function openTab(): Promise<IRpcHost> {
  /** The shared hub; every tab of this origin gets the same worker. */
  const worker = new SharedWorker(new URL('./topology-hub.ts', import.meta.url), {
    type: 'module',
    name: 'forward-topology-hub'
  })
  /** This tab's host; its leaf providers serve calls forwarded by the hub. */
  const host = (await createRpcHost({
    self: { name: tabName, instanceId: `${tabName}-${crypto.randomUUID()}` },
    plugins: [leaf.recorder.plugin, sharedWorkerPlugin({ sharedWorker: worker })],
    provide: leaf.providers()
  })) as unknown as IRpcHost
  leaf.bind(host.self.instanceId)
  return host
}

/** Classified result of one settled call. */
async function settle(pending: Promise<unknown>) {
  try {
    return { value: await pending }
  } catch (error) {
    /** Codes along `cause`, bounded by the chain length. */
    const chain: { source?: string; code?: string; message?: string }[] = []
    /** Current node in the walk. */
    let node: unknown = error
    while (node && typeof node === 'object' && chain.length < 32) {
      /** One node's public classification. */
      const failure = node as { source?: string; code?: string; message?: string; cause?: unknown }
      chain.push({ source: failure.source, code: failure.code, message: failure.message })
      node = failure.cause
    }
    return { error: { chain, route: (error as { route?: unknown })?.route ?? null } }
  }
}

/** This tab's opened host. */
const opening = openTab()

/** Operations Playwright runs in this tab. */
globalThis.topologyTab = {
  ready: async () => {
    await opening
    return true
  },
  /** Call `method` on tab `target` through the hub. */
  callTab: async (target: string, method: string, payload?: unknown) =>
    settle(
      (await opening).sharedWorker.send(
        BrowserTopology.hub,
        `${target}.${method}`,
        payload as never,
        { trace: Topology.trace }
      )
    ),
  /** This tab's own leaf counters. */
  leaf: async () => leaf.snapshot(),
  /** The hub's forward rows. */
  hub: async () => (await opening).sharedWorker.send(BrowserTopology.hub, Topology.inspect)
}

declare global {
  var topologyTab: Record<string, (...args: never[]) => Promise<unknown>>
}
