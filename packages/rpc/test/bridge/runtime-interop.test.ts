import { randomUUID } from 'node:crypto'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import { createJsonRpcRemoteChannel } from '../../src/bridge/jsonrpc/index.js'
import { JSONRPC_ALLOWED_CAPABILITIES } from '../../src/bridge/jsonrpc/constants.js'
import { BRIDGE_CONTRACT, flush } from './fixture.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../src/remote/runtime-api/peer.js'
import { peers } from '../process/peers/runtime-interop-fixture.js'

for (const fixture of peers.filter((peer) => peer.language !== 'ts-reference')) {
  it(`U41 production TS Runtime Peer bridge → ${fixture.language}`, async () => {
    const launcher = createNodeProcessLauncher()
    const token = randomUUID()
    let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
    let active: IRuntimePeer | undefined
    const failures: unknown[] = []
    const sent: unknown[] = []
    /** Hold one real carrier write so the existing outbound owner can group ready siblings. */
    let holdNext = false
    /** The byte owner keeps its real write while this test controls only completion backpressure. */
    let releaseWrite!: () => void
    const heldWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    /** Entry proves the original physical write started before subsequent calls are queued. */
    let enteredWrite!: () => void
    const writing = new Promise<void>((resolve) => {
      enteredWrite = resolve
    })
    try {
      active = await createRuntimePeer({
        self: { name: 'production-ts', instanceId: 'u41-production-ts' },
        connect: async (context) => {
          handle = await launcher.launch(
            {
              command: fixture.command,
              args: [...fixture.args, '--jsonrpc', '--stdio', '--bootstrap', 'stdin'],
              env: { inherit: ['PATH'], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
              bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
            },
            { signal: new AbortController().signal, output: () => undefined }
          )
          const byte = handle.channel!
          const originalWrite = byte.write
          Object.assign(byte, {
            write: async (chunk: Uint8Array) => {
              const text = Buffer.from(chunk).toString('utf8')
              sent.push(JSON.parse(text.slice(text.indexOf('\r\n\r\n') + 4)))
              await originalWrite(chunk)
              if (holdNext) {
                holdNext = false
                enteredWrite()
                await heldWrite
              }
            }
          })
          return createJsonRpcRemoteChannel({
            byte,
            peerId: fixture.id,
            target: { kind: 'plugin', contract: BRIDGE_CONTRACT },
            offer: {
              versions: [{ major: 1, minor: 1 }],
              peer: { id: context.self.instanceId, runtime: 'node' },
              capabilities: context.capabilities.filter((capability) =>
                JSONRPC_ALLOWED_CAPABILITIES.includes(capability)
              )
            },
            token,
            scheduler: systemScheduler,
            wallClock: systemWallClock,
            ipc: {
              connectionId: `u41-bridge-${fixture.language}`,
              sessionId: `u41-bridge-${fixture.language}`,
              log: () => undefined
            },
            report: (error) => {
              failures.push(error)
            }
          })
        },
        report: (error) => {
          failures.push(error)
        }
      })
      const description = readRuntimePeerConnection(active).description!
      assert.equal(description.schemaVersion, 2)
      assert.equal(description.self.instanceId, fixture.id)
      assert.ok(description.methods.every((method) => !method.supportedModes.includes('stream')))
      assert.deepEqual(await active.request('echo', ['bridge-single']), ['bridge-single'])
      holdNext = true
      const anchor = active.request('echo', ['anchor'])
      await writing
      const first = active.request('echo', [1])
      const second = active.request('echo', [2])
      await flush()
      releaseWrite()
      assert.deepEqual(await anchor, ['anchor'])
      assert.deepEqual(await Promise.all([first, second]), [[1], [2]])
      assert.ok(
        sent.some(
          (value) =>
            Array.isArray(value) &&
            value.filter((member) => member.method === 'migaia.invoke').length === 2
        )
      )
      assert.equal(failures.length, 0)
    } finally {
      releaseWrite()
      try {
        await active?.close()
      } finally {
        handle?.terminate('force')
        await handle?.exited
      }
    }
  }, 30_000)
}
