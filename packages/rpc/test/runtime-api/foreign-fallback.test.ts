import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createRpcStreamFrameDecoder } from '../../src/contract/framing/stream.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { normalizeRemoteContract } from '../../src/remote/contract.js'
import { createRuntimePeer, type IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { peers } from '../process/fixtures/conformance-business.js'

/** The existing registry identifies unmodified independent Python/Go/Rust and public TS executables. */
for (const peer of peers.filter((peer) => peer.language !== 'bun')) {
  it(`[A32] ${peer.language} retains real v1 forward calls without receiving a blind v2 directory`, async () => {
    /** Actual process ownership stays with the existing builtin launcher and its exit receipt. */
    const launcher = createNodeProcessLauncher()
    /** Only this test owns and terminates its child; the new Peer owns the borrowed byte endpoint. */
    let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
    /** Frame observation retains method names alone, excluding auth and all business payloads. */
    const methods: string[] = []
    /** Actual negotiated capabilities are copied after the independent foreign handshake. */
    let capabilities: readonly string[] = []
    /** Hidden reverse providers must remain unregistered on a legacy connection. */
    let hiddenCalls = 0
    /** Preparation diagnostics remain local; no secret-bearing frames enter saved output. */
    const failures: unknown[] = []
    /** A local fixture credential is written only in the canonical first bootstrap frame. */
    const token = 'a32-local-fixture-token'
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
              args: [...peer.args, '--stdio', '--bootstrap', 'stdin'],
              env: { inherit: ['PATH'], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
              bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
            },
            { signal: new AbortController().signal, output: () => undefined }
          )
          /** One observer reuses the published decoder; it implements no RPC receiver or dispatcher. */
          const decoder = createRpcStreamFrameDecoder({
            onFrame(frame) {
              /**
               * Method spelling is sufficient to distinguish v1 calls from a blind reserved
               * request.
               */
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
            peer: { id: context.self.instanceId, runtime: 'node' },
            auth: token
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
      /** Existing v1 description is parsed by its unchanged canonical contract owner. */
      const contract = normalizeRemoteContract(await active.request(RemoteMethodName.describe))
      assert.equal(contract.schemaVersion, 1, '[A32] the old description grammar remains accepted')
      assert.equal(contract.plugin, 'p')
      assert.equal(
        await active.request('p.f.request', ['fallback-ready']),
        'fallback-ready',
        '[A32] real foreign business succeeds through the shared caller'
      )
      assert.equal(capabilities.includes(RpcCapability.runtimeApi), false)
      assert.deepEqual((await active.describe()).methods, [])
      assert.equal(hiddenCalls, 0)
      assert.equal(
        methods.includes(RemoteMethodName.runtimeDescribe),
        false,
        '[A32] no foreign peer receives a v2 directory request'
      )
      assert.equal(methods.includes('p.f.request'), true)
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
