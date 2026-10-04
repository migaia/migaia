import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createRpcStreamFrameDecoder } from '../../src/contract/framing/stream.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../src/remote/runtime-api/peer.js'
import { peers } from '../process/fixtures/conformance-business.js'

/** U36 uses the independent new-baseline peers, including the handwritten TS oracle. */
for (const peer of [
  ...peers.filter((peer) => ['python', 'go', 'rust'].includes(peer.language)),
  {
    language: 'ts-reference',
    command: 'sh',
    args: [new URL('../process/peers/ts-reference/run.sh', import.meta.url).pathname],
    id: 'ts-peer'
  }
]) {
  it(`[A32] ${peer.language} uses the U36 v2 directory and batch baseline`, async () => {
    /** Actual process ownership stays with the existing builtin launcher and its exit receipt. */
    const launcher = createNodeProcessLauncher()
    /** Only this test owns and terminates its child; the new Peer owns the borrowed byte endpoint. */
    let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
    /** Frame observation retains method names alone, excluding auth and all business payloads. */
    const methods: string[] = []
    /** Actual negotiated capabilities are copied after the independent foreign handshake. */
    let capabilities: readonly string[] = []
    /** A registered reverse provider remains idle until explicitly called. */
    let hiddenCalls = 0
    /** Preparation diagnostics remain local; no secret-bearing frames enter saved output. */
    const failures: unknown[] = []
    /** Construction failure still leaves the real child in this test's cleanup ownership. */
    let active: IRuntimePeer | undefined
    try {
      /** The unchanged peer executes its own real native handshake and business dispatcher. */
      active = await createRuntimePeer({
        self: { name: 'caller', instanceId: 'caller' },
        provide: {
          hidden: () => {
            hiddenCalls += 1
            return 'hidden'
          }
        },
        connect: async (context) => {
          handle = await launcher.launch(
            {
              command: peer.command,
              args: [...peer.args, '--stdio'],
              env: { inherit: ['PATH'], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
            },
            { signal: new AbortController().signal, output: () => undefined }
          )
          /** One observer reuses the published decoder; it implements no RPC receiver or dispatcher. */
          const decoder = createRpcStreamFrameDecoder({
            onFrame(frame) {
              /** Method spelling proves v2 discovery without retaining business payloads. */
              const value = JSON.parse(new TextDecoder().decode(frame)) as { method?: string }
              if (value.method !== undefined) methods.push(value.method)
            },
            onError(error) {
              throw error
            }
          })
          /**
           * Capture the native writer through an arrow and preserve the original transport
           * completion.
           */
          const raw = handle.channel!
          /** Only declared canonical endpoint capabilities enter the initiator's actual offer. */
          const offer = createNativeProcessOffer({
            peer: { id: context.self.instanceId, runtime: 'node' }
          })
          /** The original process handshake still owns authentication and capability intersection. */
          const channel = await createProcessTransport(
            {
              ...raw,
              write: (frame) => {
                decoder.push(frame)
                return raw.write(frame)
              }
            },
            {
              role: 'initiator',
              peerId: peer.id,
              offer: { ...offer, capabilities: context.capabilities },
              ipc: {
                connectionId: `a32-${peer.language}`,
                sessionId: `a32-${peer.language}`,
                log: () => undefined
              },
              report: (error) => {
                failures.push(error)
              }
            }
          )
          capabilities = channel.agreement.capabilities
          return channel
        },
        report: (error) => {
          failures.push(error)
        }
      })
      /** The accepted v2 directory describes the actual remote provider whitelist. */
      const description = readRuntimePeerConnection(active).description!
      assert.equal(description.schemaVersion, 2)
      assert.equal(description.self.instanceId, peer.id)
      assert.ok(description.methods.some((method) => method.name === 'echo'))
      assert.equal(await active.request('echo', 'baseline-ready'), 'baseline-ready')
      assert.deepEqual(
        await Promise.all([active.request('echo', 1), active.request('echo', 2)]),
        [1, 2]
      )
      assert.equal(capabilities.includes(RpcCapability.runtimeApi), true)
      assert.equal(capabilities.includes(RpcCapability.batch), true)
      assert.equal(hiddenCalls, 0)
      assert.equal(methods.includes(RemoteMethodName.runtimeDescribe), true)
      assert.equal(methods.includes(RemoteMethodName.describe), false)
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
