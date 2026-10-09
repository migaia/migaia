import assert from 'node:assert/strict'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineHost } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createProcessPeer,
  createProcessPlugin,
  createProcessTransport,
  createNativeProcessOffer
} from '../../../dist/process/index.js'
import { createThreadPlugin } from '../../../dist/threads/index.js'
import { createBunProcessLauncher } from '../../../dist/process/adapters/bun-spawn.js'
import { createDenoProcessLauncher } from '../../../dist/process/adapters/deno-command.js'
import {
  createBunThreadLauncher,
  createBunThreadChannelFactory
} from '../../../dist/threads/adapters/bun.js'
import {
  createDenoThreadLauncher,
  createDenoThreadChannelFactory
} from '../../../dist/threads/adapters/deno.js'
import {
  listenProcessByteChannel,
  dialProcessByteChannel
} from '../../../dist/process/adapters/node-socket.js'
import { RUNTIME_API_CAPABILITIES } from '../../../dist/remote/runtime-api/constants.js'

/** This entire graph runs in the requested runtime, including its actual native child. */
const runtime = process.argv[2]
/** The native final provider varies only its original process versus Worker source. */
const mode = process.argv[3]
/** Public fixture token is unrelated to any actual account or external endpoint. */
const token = 'r14-listener-public-token'
/** Original Host and shared slot own both forwarding and the accepted listener connection. */
const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** Only actual native resources acquired by this fixture are closed in finally. */
let handle, client, address
/** Listener readiness comes from its actual OS bind. */
let sequence = 0
/** All operational failures remain visible with their full package classification. */
const failures = []
/** Existing report callback preserves error objects locally and exposes redacted fields on failure. */
const report = (error) =>
  failures.push({
    source: error?.source,
    code: error?.code,
    name: error?.name,
    reason: error?.reason ?? error?.detail?.reason ?? null,
    message: String(error?.message ?? '').slice(0, 160)
  })
try {
  await host.use(
    (mode === 'process' ? createProcessPlugin : createThreadPlugin)({
      name: 'c',
      report,
      spawn: async (context) => {
        if (mode === 'thread') {
          const launcher = (runtime === 'bun' ? createBunThreadLauncher : createDenoThreadLauncher)(
            { runtimeApi: context, report }
          )
          handle = await launcher.launch(
            {
              entry: new URL('./runtime-u25-worker.mjs', import.meta.url).href,
              name: 'relay-child'
            },
            { signal: new AbortController().signal }
          )
          return (
            runtime === 'bun' ? createBunThreadChannelFactory : createDenoThreadChannelFactory
          )({ scheduler: systemScheduler }).open(handle, new AbortController().signal)
        }
        const launcher = (runtime === 'bun' ? createBunProcessLauncher : createDenoProcessLauncher)(
          {
            runtimeApiBootstrap: { name: 'relay-child', parentInstanceId: context.self.instanceId }
          }
        )
        handle = await launcher.launch(
          {
            command: process.execPath,
            args:
              runtime === 'deno'
                ? [
                    'run',
                    '-A',
                    fileURLToPath(new URL('./runtime-u25-process.mjs', import.meta.url))
                  ]
                : [fileURLToPath(new URL('./runtime-u25-process.mjs', import.meta.url))],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          { signal: new AbortController().signal, output: () => undefined }
        )
        return createProcessTransport(handle.channel, {
          role: 'initiator',
          peerId: handle.runtimeApiIdentity.instanceId,
          offer: createNativeProcessOffer({
            peer: { id: context.self.instanceId, runtime },
            auth: token,
            capabilities: context.capabilities
          }),
          ipc: { connectionId: 'relay-c', sessionId: 'relay-c', log: () => undefined },
          report
        })
      }
    })
  )
  await host.use(
    createProcessPlugin({
      name: 'listener',
      expose: ['c'],
      report,
      listen: {
        kind: 'listener',
        address: 'tcp://127.0.0.1:0',
        listen: async (options) => {
          const listener = await listenProcessByteChannel(options)
          address = listener.address
          return listener
        },
        verify: (auth) => {
          assert.equal(auth, token)
          return 'r14-principal'
        },
        offer: createNativeProcessOffer({
          peer: { id: 'relay-server', runtime },
          capabilities: RUNTIME_API_CAPABILITIES
        }),
        createConnectionContext: () => ({
          peerId: `client-${++sequence}`,
          ipc: { connectionId: 'relay-in', sessionId: 'relay-in', log: () => undefined }
        })
      }
    })
  )
  /** A real public connect object reaches the original authenticated TCP listener. */
  client = await createProcessPeer({
    self: { name: 'client', instanceId: 'client-1' },
    provide: { reverse: () => 9 },
    report,
    connect: {
      kind: 'connect',
      address,
      token,
      dial: (path, signal) => dialProcessByteChannel({ address: path, signal }),
      establish: (raw, options) =>
        createProcessTransport(raw, {
          role: 'initiator',
          offer: options.offer,
          peerId: 'relay-server',
          scheduler: options.scheduler,
          ipc: { connectionId: 'relay-client', sessionId: 'relay-client', log: () => undefined },
          report
        })
    }
  })
  /** Both payload levels cross A-to-B and the actual compiled B-to-C forwarding owner. */
  const payload = { marker: 'r14-one-hop', nested: { value: mode } }
  assert.equal(await client.request('c.binaryCount'), 0)
  const value = await client.request('c.echo', payload)
  assert.equal(value.marker, payload.marker)
  assert.equal(value.nested.value, mode)
  assert.equal(
    await client.request('c.binaryCount'),
    1,
    '[R14-A11] final native business executes once through the original forward slot'
  )
  assert.equal(
    await host.process.request('client-1', 'reverse'),
    9,
    '[R14-A11] accepted native listener preserves actual reverse business'
  )
  assert.deepEqual(failures, [])
  console.log(
    JSON.stringify({
      runtime,
      mode,
      cases: ['tcp-connect', 'authenticated-listen', 'actual-native-one-hop', 'reverse'],
      effects: 1
    })
  )
} finally {
  await client?.close()
  await host.dispose()
  handle?.terminate(mode === 'process' ? 'force' : undefined)
  if (mode === 'process') await handle?.exited
}
if (runtime === 'deno') Deno.exit(0)
else process.exit(0)
