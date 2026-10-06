import { randomUUID } from 'node:crypto'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessPeer, createProcessTransport } from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'

/** This disposable parent owns one real public Peer and is intentionally killed by its test. */
const peer = JSON.parse(process.argv[2])
/** Authentication stays in the bootstrap closure rather than command arguments or the receipt. */
const token = randomUUID()
/** The canonical builtin launcher owns actual child creation and physical pipes. */
const launcher = createNodeProcessLauncher()
/** This identity is obtained from the actual launched public handle. */
let peerPid
/** One public Peer owns the negotiated source and explicitly permitted Host control requests. */
const peerOptions = {
  self: { name: 'parent', instanceId: 'caller' },
  report: () => undefined,
  spawn: {
    kind: 'spawn',
    wire: 'native',
    channelKind: 'byte',
    token,
    supervision: {
      id: 'kill9-parent',
      isolation: 'best-effort',
      report: () => undefined,
      budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
      spec: {
        command: peer.command,
        args: [...peer.args, '--stdio', '--host', '--bootstrap', 'stdin', '--descendant'],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      },
      launcher: {
        ...launcher,
        launch: async (spec, context) => {
          /** Foreign peers consume the original token prefix, never the TS-only automatic marker. */
          const handle = await launcher.launch(spec, {
            signal: context.signal,
            output: context.output
          })
          peerPid = handle.identity.pid
          return handle
        }
      }
    },
    rawChannel: async (handle) => handle.channel,
    establish: (byte, context) =>
      createProcessTransport(byte, {
        role: 'initiator',
        peerId: peer.id,
        offer: context.offer,
        scheduler: context.scheduler,
        signal: context.signal,
        report: () => undefined,
        ipc: { ...context.session, log: () => undefined }
      })
  }
}
/** The actual Peer source supplies its installed capability offer without a legacy Host facade. */
const host = await createProcessPeer(peerOptions)
/** The wire proves that the descendant-owning peer is serving actual Host business before kill -9. */
await host.request('migaia.remote.host.use', ['p', {}])
if ((await host.request('p.f.request', ['kill9-ready'])) !== 'kill9-ready')
  throw new Error('parent fixture business mismatch')
process.stdout.write(JSON.stringify({ parentPid: process.pid, peerPid }) + '\n')
