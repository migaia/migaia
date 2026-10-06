import { installPage } from './page-common.mjs'
import { peerOptions } from './rpc.mjs'
import { BrowserBenchText } from './text.mjs'
import { createThreadPeer } from '@migaia/rpc/threads'
import {
  createBrowserThreadLauncher,
  createBrowserThreadChannelFactory
} from '@migaia/rpc/threads/adapters/browser'
import { systemScheduler } from '@migaia/utils/scheduler'
import { readRuntimePeerConnection } from '../../../../dist/remote/runtime-api/peer.js'

installPage('/worker-rpc.js', async (createWorker, payload, classification) => {
  /** Each side retains exactly one sampling policy and coded report callback. */
  const options = peerOptions(classification)
  /** The real native constructor transfers the observation port before library bootstrap begins. */
  class ObservedWorker {
    /** Return the actual Worker allocated by this isolated page, not a Worker-shaped facade. */
    constructor() {
      return createWorker()
    }
  }
  /** Actual bootstrap, capabilities, directory and endpoint belong to the public factory. */
  const peer = await createThreadPeer({
    ...options,
    self: { name: 'page', instanceId: 'page' },
    spawn: async (context) => {
      const launcher = createBrowserThreadLauncher({
        Worker: ObservedWorker,
        runtimeApi: context,
        report: options.report
      })
      const handle = await launcher.launch(
        { entry: new URL('/worker-rpc.js', location.href).href, name: 'worker' },
        { signal: new AbortController().signal }
      )
      return createBrowserThreadChannelFactory({ scheduler: systemScheduler }).open(
        handle,
        new AbortController().signal
      )
    }
  })
  /** Only preparation invokes the canonical WeakMap reader after successful real business. */
  globalThis.benchRuntimeProof = () => {
    const accepted = readRuntimePeerConnection(peer)
    return {
      self: peer.self,
      peerId: accepted.peerId,
      methods: accepted.description.methods.map((method) => method.name)
    }
  }
  return async () => {
    if ((await peer.request(BrowserBenchText.echo, payload)) !== payload)
      throw new Error(BrowserBenchText.mismatch)
  }
})
