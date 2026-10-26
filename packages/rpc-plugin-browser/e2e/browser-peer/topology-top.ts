/**
 * Top window of the iframe topology: owns a dedicated worker leaf and a cross-origin iframe, and
 * forwards the iframe's calls to the worker by peer-name prefix.
 */
import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { dedicatedWorkerPlugin, windowPlugin } from '@migaia/rpc-plugin-browser'
import {
  HopAuthCounter,
  HopSecret,
  Topology,
  TopologyRecorder
} from '../../../rpc-integration/test/host/fixtures/topology-vocabulary.ts'
import { BrowserTopology } from './topology-names.ts'

/** Whether auth guards the window–worker hop. */
const hopAuth = new URL(location.href).searchParams.get('auth') === 'match'
/** Forward-stage observation of this forwarding window. */
const recorder = new TopologyRecorder()
/** Transform counts of this window's side of the auth hop. */
const authCounter = new HopAuthCounter()

/** Create the cross-origin iframe and wait for its script to load. */
async function openFrame(): Promise<HTMLIFrameElement> {
  /** Second Vite origin, so the window hop crosses origins. */
  const origin = BrowserTopology.frameOrigin
  /** The iframe this window borrows. */
  const frame = document.createElement('iframe')
  frame.src = `${origin}/browser-peer/topology-frame.html?parentOrigin=${encodeURIComponent(location.origin)}`
  /** Settles on the iframe's non-protocol load notice from the exact source and origin. */
  const loaded = new Promise<void>((resolve) => {
    /** Accept only the iframe's own load notice. */
    const ready = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return
      if ((event.data as { topologyFixture?: string })?.topologyFixture !== 'loaded') return
      window.removeEventListener('message', ready)
      resolve()
    }
    window.addEventListener('message', ready)
  })
  document.body.append(frame)
  await loaded
  return frame
}

/** Open the forwarding window host over the iframe and the worker. */
async function openTop(): Promise<IRpcHost> {
  /** Dedicated worker leaf owned by this page. */
  const worker = new Worker(new URL('./topology-worker.ts', import.meta.url), {
    type: 'module',
    name: hopAuth ? 'auth' : 'plain'
  })
  /** The iframe whose calls this window forwards. */
  const frame = await openFrame()
  /** The forwarding host; providers read it after it opens. */
  const opening = createRpcHost({
    self: { name: BrowserTopology.top, instanceId: `${BrowserTopology.top}-${crypto.randomUUID()}` },
    plugins: [
      recorder.plugin,
      windowPlugin({
        window: frame.contentWindow!,
        origin: BrowserTopology.frameOrigin,
        receiver: window
      }),
      dedicatedWorkerPlugin({
        worker,
        connect: { timeoutMs: 5000 },
        features: hopAuth ? [auth(authCounter.options(HopSecret.shared))] : []
      })
    ],
    provide: {
      [Topology.inspect]: async () => ({
        forward: recorder.snapshot().filter((event) => event.stage === RpcProbeStage.forward),
        auth: authCounter.snapshot(),
        worker: await (await opening).worker.send(BrowserTopology.worker, Topology.inspect)
      }),
      /** Close the worker namespace shortly after replying, while the iframe has a call in flight. */
      [BrowserTopology.closeWorker]: async () => {
        /** The opened host whose worker namespace closes. */
        const host = await opening
        setTimeout(() => void host.worker.close(), 20)
        return true
      }
    }
  }) as unknown as Promise<IRpcHost>
  /** The opened host. */
  const host = await opening
  await host.worker.send(BrowserTopology.worker, Topology.ready)
  return host
}

globalThis.topologyTop = openTop()

declare global {
  var topologyTop: Promise<IRpcHost>
}
