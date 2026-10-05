import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createUnitBudget } from '@migaia/supervision'
import {
  createProcessHost,
  createProcessTransport,
  createNativeProcessOffer
} from '@migaia/rpc/process'
import { createNodeProcessLauncher } from '@migaia/rpc/process/adapters/node-child-process'
import { endpointFor } from '../peers/ts/runtime.ts'

/** This disposable parent owns one real public Host facade and is intentionally killed by its test. */
const peer = JSON.parse(process.argv[2])
/** The fixture contract selects the same real local Plugin/Feature implementation as A1. */
const contract = JSON.parse(
  readFileSync(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value
/** Authentication stays in the bootstrap closure rather than command arguments or the receipt. */
const token = randomUUID()
/** Public negotiation remains the only protocol producer in this parent. */
const offer = {
  ...createNativeProcessOffer({
    peer: { id: 'caller', runtime: 'node' },
    stream: true,
    capabilities: ['runtime-api@1', 'abort@1', 'wire-error@1']
  }),
  auth: token
}
/** The canonical builtin launcher owns actual child creation and physical pipes. */
const launcher = createNodeProcessLauncher()
/** This identity is obtained from the actual launched public handle. */
let peerPid
/** One public facade owns hello, describe, Host use and feature projection. */
const host = createProcessHost({
  catalog: { p: contract },
  endpointFactory: (channel) => endpointFor(channel, 'caller'),
  report: () => undefined,
  deployment: {
    kind: 'spawn',
    wire: 'native',
    channelKind: 'byte',
    token,
    offer,
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
          const handle = await launcher.launch(spec, context)
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
})
await host.ready()
/** The wire proves that the descendant-owning peer is serving actual Host business before kill -9. */
const installed = await host.use('p', {})
if ((await installed.f.request(['kill9-ready'])) !== 'kill9-ready')
  throw new Error('parent fixture business mismatch')
process.stdout.write(JSON.stringify({ parentPid: process.pid, peerPid }) + '\n')
