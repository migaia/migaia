import { createDenoProcessLauncher } from '../../../dist/process/adapters/deno-command.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../dist/process/adapters/deno-socket.js'

/** This executable probe runs only under Deno with explicit local permissions. */
const token = 'deno-bootstrap-token'
const launcher = createDenoProcessLauncher()
const childPath = new URL('./deno-child.mjs', import.meta.url).pathname
const handle = await launcher.launch(
  {
    command: Deno.execPath(),
    args: ['run', '-A', childPath],
    env: { inherit: ['PATH'], set: {} },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
    bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
  },
  {
    signal: new AbortController().signal,
    output(stream, chunk) {
      if (stream === 'stderr') Deno.stderr.writeSync(chunk)
    }
  }
)
const channel = await createProcessTransport(handle.channel, {
  role: 'initiator',
  offer: createNativeProcessOffer({ peer: { id: 'deno-parent', runtime: 'deno' }, auth: token }),
  peerId: 'deno-child',
  ipc: { connectionId: 'deno-parent', sessionId: 'deno-parent', log: () => undefined },
  report: () => undefined
})
const reply = new Promise((resolve) => channel.transport.subscribe(({ data }) => resolve(data)))
const payload = 'd'.repeat(128 * 1024)
await channel.transport.send(payload)
if ((await reply) !== payload) throw new Error('Deno byte channel payload mismatch')
await channel.close()
handle.terminate('force')
await handle.exited

/** Deno's Node-compatible loopback path retains the authenticated owner. */
let acceptReady
const accepted = new Promise((resolve) => {
  acceptReady = resolve
})
const listener = await listenProcessByteChannel({
  address: 'tcp://127.0.0.1:0',
  auth: {
    mode: 'required',
    verify: (auth) => {
      if (auth !== token) throw new Error('token mismatch')
      return 'deno-principal'
    }
  },
  onConnection: async (pending) => {
    acceptReady(
      await pending.accept({
        offer: createNativeProcessOffer({ peer: { id: 'deno-listener', runtime: 'deno' } }),
        peerId: 'deno-dialer',
        ipc: { connectionId: 'deno-listener', sessionId: 'deno-listener', log: () => undefined },
        report: () => undefined
      })
    )
  },
  report: () => undefined
})
const dialed = await dialProcessByteChannel({ address: listener.address })
const outbound = await createProcessTransport(dialed, {
  role: 'initiator',
  offer: createNativeProcessOffer({ peer: { id: 'deno-dialer', runtime: 'deno' }, auth: token }),
  peerId: 'deno-listener',
  ipc: { connectionId: 'deno-dialer', sessionId: 'deno-dialer', log: () => undefined },
  report: () => undefined
})
const ready = await accepted
if (ready.principalId !== 'deno-principal') throw new Error('Deno principal mismatch')
await listener.close()
await outbound.close()
await ready.channel.close()
console.log(JSON.stringify({ ok: true, capabilities: launcher.capabilities }))
