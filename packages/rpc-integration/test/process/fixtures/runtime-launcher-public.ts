/** Both actual runtimes exercise their public Host, native child, and authenticated TCP source. */
import assert from 'node:assert/strict'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { detectServerRuntime } from '@migaia/utils'
import type { IProcessByteListener } from '../../../../rpc-plugin-process/dist/process/types.js'

/** Canonical runtime detection selects only this process's actual native adapter. */
const runtime = detectServerRuntime()
/** The same native implementation supplies both loopback byte acquisition operations. */
const sockets =
  runtime === 'deno'
    ? await import('../../../../rpc-plugin-process/dist/process/adapters/deno-socket.js')
    : await import('../../../../rpc-plugin-process/dist/process/adapters/bun-socket.js')
/** Capability facts come from the runtime's original native launcher, without a second protocol. */
const launcher =
  runtime === 'deno'
    ? (
        await import('../../../../rpc-plugin-process/dist/process/adapters/deno-command.js')
      ).createDenoProcessLauncher()
    : (
        await import('../../../../rpc-plugin-process/dist/process/adapters/bun-spawn.js')
      ).createBunProcessLauncher()
/** This original large payload crosses the actual framed stdio boundary intact. */
const payload = (runtime === 'deno' ? 'd' : 'b').repeat(128 * 1024)
/** Native socket verification observes the exact configured credential before publication. */
const token = 'runtime-public-listener-token'
/** Count only executions of the actual native listener credential verifier. */
const verification = { calls: 0 }
/** Listener cleanup remains with the genuine Process plugin that acquired it. */
let listener: IProcessByteListener | undefined
/** Successful construction alone transfers these lifetimes to the fixture's final cleanup. */
let childHost: Awaited<ReturnType<typeof createRpcHost>> | undefined
/** The server uses the runtime's TCP listener, without substituting Node socket IO. */
let server: Awaited<ReturnType<typeof createRpcHost>> | undefined
/** The client owns only its original connected socket and Host. */
let client: Awaited<ReturnType<typeof createRpcHost>> | undefined
try {
  childHost = await createRpcHost({
    self: { name: 'parent', instanceId: 'runtime-public-parent' },
    plugins: [
      processPlugin({
        name: 'runtime-child',
        spawn: {
          entry: new URL('../../runtime-api/fixtures/automatic-process.mjs', import.meta.url)
        }
      })
    ],
    provide: { parentEcho: () => 'runtime-public-parent' },
    report: () => undefined
  })
  /** The independent child executes the same maintained public provider used by the matrix. */
  const result = (await childHost.process.send('runtime-child', 'probe', payload)) as {
    value: string
    parent: string
  }
  assert.equal(result.value, payload)
  assert.equal(result.parent, 'runtime-public-parent')
  server = await createRpcHost({
    self: { name: 'runtime-server', instanceId: 'runtime-server' },
    provide: { echo: (value: string) => value },
    plugins: [
      processPlugin({
        listen: {
          kind: 'listener',
          address: 'tcp://127.0.0.1:0',
          async listen(options) {
            listener = await sockets.listenProcessByteChannel(options)
            return listener
          },
          verify(credentials) {
            assert.equal(credentials, token)
            verification.calls += 1
            return 'runtime-client'
          },
          createConnectionContext: () => ({
            peerId: 'runtime-client',
            ipc: { connectionId: 'runtime-listener', sessionId: 'runtime-listener', log() {} }
          })
        }
      })
    ],
    report: () => undefined
  })
  client = await createRpcHost({
    self: { name: 'runtime-client', instanceId: 'runtime-client' },
    plugins: [
      processPlugin({
        connect: {
          target: {
            kind: 'connect',
            address: listener!.address,
            token,
            dial: (address, signal) =>
              sockets.dialProcessByteChannel({ address, signal: signal as AbortSignal })
          }
        }
      })
    ],
    report: () => undefined
  })
  assert.equal(await client.process.send('runtime-server', 'echo', payload), payload)
  assert.equal(verification.calls, 1)
  console.log(JSON.stringify({ ok: true, capabilities: launcher.capabilities }))
} finally {
  await client?.close()
  await server?.close()
  await childHost?.close()
}
