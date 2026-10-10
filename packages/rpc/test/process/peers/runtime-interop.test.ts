import assert from 'node:assert/strict'
import { it } from 'vitest'
import { peers } from './runtime-interop-fixture.js'
import { createNodeProcessLauncher } from '../../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../../src/process/offer.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../../src/remote/runtime-api/peer.js'

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
