import { openProcessStdioChannel } from '../../../dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'

/** Saturate stderr before reading bootstrap; the launcher must already drain it. */
await new Promise((resolve) => process.stderr.write(Buffer.alloc(1024 * 1024, 88), resolve))
const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
const token = new TextDecoder().decode(opened.bootstrap)
const channel = await createProcessTransport(opened.channel, {
  role: 'responder',
  offer: createNativeProcessOffer({ peer: { id: 'child', runtime: 'node' } }),
  auth: {
    mode: 'required',
    verify(auth) {
      if (auth !== token) throw new Error('token mismatch')
    }
  },
  peerId: 'parent',
  ipc: { connectionId: 'child', sessionId: 'child', log: () => undefined },
  report: () => undefined
})
channel.transport.subscribe(({ data }) => {
  if (data === 'stop') {
    void channel.close().then(() => {
      process.stdin.destroy()
      process.exitCode = 0
    })
    return
  }
  void (async () => {
    /** Split the secret only after the parent's IPC stderr subscription is ready. */
    await new Promise((resolve) => process.stderr.write(token.slice(0, 4), resolve))
    await new Promise((resolve) => process.stderr.write(token.slice(4), resolve))
    await channel.transport.send(
      JSON.stringify({
        data,
        allowed: process.env.MIGAI_TEST_ALLOWED,
        forbidden: process.env.HOME,
        argument: process.argv[2]
      })
    )
  })()
})
