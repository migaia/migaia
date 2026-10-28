import { randomUUID } from 'node:crypto'
import { createUnitBudget } from '@migaia/supervision'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { createNodeProcessLauncher } from '../../../dist/process/adapters/node-child-process.js'

/** This disposable parent is killed only after its actual public Host completed peer business. */
const peer = JSON.parse(process.argv[2])
/** Authentication remains in native bootstrap custody, never command arguments or the receipt. */
const token = randomUUID()
/** The canonical launcher alone owns real child creation, stdio, bootstrap, and exit observation. */
const launcher = createNodeProcessLauncher()
/** Only the genuine launched handle supplies the child PID reported to the resource observer. */
let peerPid
/** Public Host construction owns the same native supervisor and one current process namespace. */
const host = await createRpcHost({
  self: { name: 'parent', instanceId: 'caller' },
  report: () => undefined,
  plugins: [
    authFeature({ credentials: token }),
    processPlugin({
      name: 'p',
      spawn: {
        kind: 'spawn',
        channelKind: 'byte',
        token,
        supervision: {
          id: 'kill9-parent',
          isolation: 'best-effort',
          report: () => undefined,
          budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
          spec: {
            command: peer.command,
            args: [...peer.args, '--stdio', '--bootstrap', 'stdin', '--descendant'],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          launcher: {
            ...launcher,
            /** The unchanged source context carries current native launch facts to the launcher. */
            async launch(spec, context) {
              /** This original handle supplies identity without wrapping native exit or stdio. */
              const handle = await launcher.launch(spec, context)
              peerPid = handle.identity.pid
              return handle
            }
          }
        },
        /** Borrow the exact launched physical channel; Host owns the sole semantic handshake. */
        rawChannel: async (handle) => handle.channel
      }
    })
  ]
})
/** Original descendant-owning business must succeed before any readiness PID becomes observable. */
if ((await host.process.request('p.f.request', ['kill9-ready'])) !== 'kill9-ready')
  throw new Error('parent fixture business mismatch')
process.stdout.write(JSON.stringify({ parentPid: process.pid, peerPid }) + '\n')
