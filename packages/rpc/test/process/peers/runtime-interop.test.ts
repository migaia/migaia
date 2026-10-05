import { randomUUID } from 'node:crypto'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import { createJsonRpcRemoteChannel } from '../../../src/bridge/jsonrpc/index.js'
import { JSONRPC_ALLOWED_CAPABILITIES } from '../../../src/bridge/jsonrpc/constants.js'
import { BRIDGE_CONTRACT, flush } from '../../bridge/fixture.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../../src/process/offer.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../../src/remote/runtime-api/peer.js'

/** Every entry is an independent language fixture, including the handwritten TS oracle. */
const peers = [
  {
    language: 'python',
    id: 'python-peer',
    command: 'python3',
    args: ['-B', fileURLToPath(new URL('./python/peer.py', import.meta.url)), '--business']
  },
  {
    language: 'rust',
    id: 'rust-peer',
    command: fileURLToPath(new URL('./rust/run.sh', import.meta.url)),
    args: ['--business']
  },
  {
    language: 'go',
    id: 'go-peer',
    command: fileURLToPath(new URL('./go/run.sh', import.meta.url)),
    args: ['--business']
  },
  {
    language: 'ts-reference',
    id: 'ts-peer',
    command: fileURLToPath(new URL('./ts-reference/run.sh', import.meta.url)),
    args: []
  }
] as const

for (const fixture of peers) {
  it(`U36 production TS standard request → ${fixture.language}`, async () => {
    /** The existing launcher owns the child while Runtime Peer borrows its byte endpoint. */
    const launcher = createNodeProcessLauncher()
    /** A failed preparation still leaves child termination with this test. */
    let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
    /** Only a fully prepared production peer can own close. */
    let active: IRuntimePeer | undefined
    /** Observable reports are retained locally, without recording credentials or frames. */
    const failures: unknown[] = []
    /** Only Python can initiate a reverse request on this authenticated peer. */
    let reverseCalls = 0
    try {
      active = await createRuntimePeer({
        self: { name: 'production-ts', instanceId: 'u36-production-ts' },
        provide: {
          parentEcho: (payload: unknown) => {
            reverseCalls += 1
            return payload
          }
        },
        connect: async (context) => {
          handle = await launcher.launch(
            {
              command: fixture.command,
              args: [...fixture.args, '--stdio'],
              env: { inherit: ['PATH'], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
            },
            { signal: new AbortController().signal, output: () => undefined }
          )
          /**
           * The production handshake negotiates the real peer offer; no fixture channel is
           * fabricated.
           */
          const offer = createNativeProcessOffer({
            peer: { id: context.self.instanceId, runtime: 'node' }
          })
          return createProcessTransport(handle.channel!, {
            role: 'initiator',
            peerId: fixture.id,
            offer: { ...offer, capabilities: context.capabilities },
            ipc: {
              connectionId: `u36-${fixture.language}`,
              sessionId: `u36-${fixture.language}`,
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
      /**
       * The accepted remote receipt comes from standard discovery followed by a receiver-addressed
       * request.
       */
      const description = readRuntimePeerConnection(active).description!
      assert.equal(description.schemaVersion, 2)
      assert.equal(description.self.instanceId, fixture.id)
      assert.ok(
        description.methods.some(
          (method) => method.name === 'echo' && method.supportedModes.includes('request')
        )
      )
      assert.deepEqual(
        JSON.parse(JSON.stringify(await active.request('echo', { language: fixture.language }))),
        {
          language: fixture.language
        }
      )
      assert.deepEqual(
        await Promise.all([active.request('echo', 1), active.request('echo', 2)]),
        [1, 2]
      )
      if (fixture.language === 'python') {
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(
              await active.request('peer.reverse', {
                method: 'parentEcho',
                payload: { reverse: true }
              })
            )
          ),
          { reverse: true }
        )
        assert.equal(reverseCalls, 1)
      } else assert.equal(reverseCalls, 0)
      assert.equal(failures.length, 0)
    } finally {
      try {
        await active?.close()
      } finally {
        handle?.terminate('force')
        await handle?.exited
      }
    }
  }, 30_000)
}

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
