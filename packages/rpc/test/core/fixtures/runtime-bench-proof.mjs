import { createIpcSession } from '../../../bench/ipc-session.mjs'
import { readRuntimePeerConnection } from '../../../dist/remote/runtime-api/peer.js'

/** One real carrier completes ordinary business before checking the actual production Peer owner. */
const unit = JSON.parse(process.argv[2])
if (unit.carrier === 'browser-worker') {
  /** Chromium provides real page/Worker business, PID attribution and actual loaded bundle SHA. */
  const { runBrowserSide } = await import('../../../bench/browser-side.mjs')
  const receipt = await runBrowserSide({ ...unit, payloadBytes: 64 }, 'rpc', { check: true })
  console.log(JSON.stringify({ echoes: receipt.echoes, ...receipt.facadeProof }))
} else {
  /** Physical payload and sampling policy match the existing DA1 preparation side. */
  const session = await createIpcSession({ ...unit, side: 'rpc', payload: 'x'.repeat(64) })
  try {
    await session.ready()
    for (let index = 0; index < 3; index++) await session.exchange()
    /** A canonical WeakMap read cannot be satisfied by adding a facade-shaped fixture object. */
    const accepted = session.facade ? readRuntimePeerConnection(session.facade) : undefined
    console.log(
      JSON.stringify({
        echoes: 3,
        self: session.facade?.self ?? null,
        peerId: accepted?.peerId ?? null,
        methods: accepted?.description?.methods.map((method) => method.name) ?? []
      })
    )
  } finally {
    await session.close()
  }
}
