import { createBunProcessLauncher } from '../../../dist/process/adapters/bun-spawn.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../dist/process/adapters/bun-socket.js'

/** This executable probe runs both Bun's child and loopback socket paths. */
const token = 'bun-bootstrap-token'
const launcher = createBunProcessLauncher()
const childPath = new URL('./bun-child.mjs', import.meta.url).pathname
const handle = await launcher.launch(
  {
    command: process.execPath,
    args: [childPath],
    env: { inherit: ['PATH'], set: {} },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
    bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
  },
  { signal: new AbortController().signal, output: () => undefined }
)
const channel = await createProcessTransport(handle.channel, {
  role: 'initiator',
  offer: createNativeProcessOffer({ peer: { id: 'bun-parent', runtime: 'bun' }, auth: token }),
  peerId: 'bun-child',
  ipc: { connectionId: 'bun-parent', sessionId: 'bun-parent', log: () => undefined },
  report: () => undefined
})
const reply = new Promise((resolve) => channel.transport.subscribe(({ data }) => resolve(data)))
const payload = 'b'.repeat(128 * 1024)
await channel.transport.send(payload)
if ((await reply) !== payload) throw new Error('Bun byte channel payload mismatch')
await channel.close()
handle.terminate('force')
await handle.exited

/** Listener accepts only a verified pending capability on Bun as well. */
let acceptReady
const accepted = new Promise((resolve) => {
  acceptReady = resolve
})
const offer = createNativeProcessOffer({ peer: { id: 'bun-listener', runtime: 'bun' } })
const listener = await listenProcessByteChannel({
  address: 'tcp://127.0.0.1:0',
  auth: {
    mode: 'required',
    verify: (auth) => {
      if (auth !== token) throw new Error('token mismatch')
      return 'bun-principal'
    }
  },
  onConnection: async (pending) => {
    acceptReady(
      await pending.accept({
        offer,
        peerId: 'bun-dialer',
        ipc: { connectionId: 'bun-listener', sessionId: 'bun-listener', log: () => undefined },
        report: () => undefined
      })
    )
  },
  report: () => undefined
})
const dialed = await dialProcessByteChannel({ address: listener.address })
const outbound = await createProcessTransport(dialed, {
  role: 'initiator',
  offer: createNativeProcessOffer({ peer: { id: 'bun-dialer', runtime: 'bun' }, auth: token }),
  peerId: 'bun-listener',
  ipc: { connectionId: 'bun-dialer', sessionId: 'bun-dialer', log: () => undefined },
  report: () => undefined
})
const ready = await accepted
if (ready.principalId !== 'bun-principal') throw new Error('Bun principal mismatch')
await listener.close()
await outbound.close()
await ready.channel.close()
console.log(JSON.stringify({ ok: true, capabilities: launcher.capabilities }))
