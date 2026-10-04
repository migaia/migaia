import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { PROCESS_RUNTIME_API_ENV } from '../../src/process/constants.js'

/** The genuine child imports built public factories, independently from Vitest's source loader. */
const entry = fileURLToPath(new URL('./fixtures/process-source-faults.mjs', import.meta.url))
for (const mode of [
  'plain',
  'explicit',
  'invalid-marker',
  'wrong-token',
  'wrong-parent'
] as const) {
  it(`[A1][A3] genuine process ${mode} rejects before automatic publication`, async () => {
    /** The child receives one fixture-only token through the original private bootstrap owner. */
    const token = 'c3-negative-fixture-token'
    /** Its trusted parent route must also be independently verified by the original responder. */
    const parent = 'c3-trusted-parent'
    /** Stderr carries safe independent factory observations; protocol stdout remains untouched. */
    let stderr = ''
    /** The old launcher path establishes the actual no-marker/no-source configuration boundary. */
    const automatic = mode !== 'plain' && mode !== 'invalid-marker'
    /** Only an opt-in launch writes versioned metadata and the nonsecret discovery marker. */
    const launcher = createNodeProcessLauncher(
      automatic ? { runtimeApiBootstrap: { name: 'negative-child', parentInstanceId: parent } } : {}
    )
    /** This receipt must settle from an actual native exit, not a guessed channel-close event. */
    const handle = await launcher.launch(
      {
        command: process.execPath,
        args: [entry, mode],
        env: {
          inherit: ['PATH'],
          set:
            mode === 'invalid-marker' ? { [PROCESS_RUNTIME_API_ENV]: 'unsupported-discovery' } : {}
        },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        ...(automatic
          ? { bootstrap: { via: 'stdin' as const, payload: new TextEncoder().encode(token) } }
          : {})
      },
      {
        signal: new AbortController().signal,
        output: (stream, bytes) => {
          if (stream === 'stderr') stderr += new TextDecoder().decode(bytes)
        }
      }
    )
    try {
      if (mode === 'wrong-token' || mode === 'wrong-parent') {
        /** Authenticated route authority cannot be replaced by a valid token from another parent. */
        const offer = createNativeProcessOffer({
          peer: { id: mode === 'wrong-parent' ? 'c3-untrusted-parent' : parent, runtime: 'node' },
          auth: mode === 'wrong-token' ? 'c3-wrong-token' : token
        })
        const failure = await createProcessTransport(handle.channel!, {
          role: 'initiator',
          peerId: handle.runtimeApiIdentity!.instanceId,
          offer,
          ipc: {
            connectionId: 'negative-parent',
            sessionId: 'negative-parent',
            log: () => undefined
          },
          report: () => undefined
        }).catch((error: unknown) => error)
        assert.equal(
          (failure as { code?: string }).code,
          'HANDSHAKE_REJECTED',
          '[A3] original responder rejects token or authenticated parent route'
        )
      }
      const status = await handle.exited
      assert.equal(
        status.code,
        0,
        '[A3] actual fixture exit is observed after classified factory rejection'
      )
      const receipt = JSON.parse(stderr.trim().split('\n').at(-1)!)
      assert.equal(
        receipt.code,
        mode === 'wrong-token' || mode === 'wrong-parent'
          ? 'PROCESS_CHANNEL_AUTH_REJECTED'
          : 'INVALID_CONFIG',
        '[A3] the actual child factory rejects the invalid source/auth condition'
      )
      assert.equal(
        receipt.publications,
        0,
        '[A3] a rejected source never publishes a callable Peer'
      )
      assert.equal(receipt.sourceCalls, 0, '[A1] conflicting source callback never executes')
      assert.equal(receipt.handlerCalls, 0, '[A3] rejected bootstrap dispatches no business')
      if (mode === 'plain' || mode === 'explicit' || mode === 'invalid-marker') {
        assert.equal(receipt.beforeReaders, 0)
        assert.equal(
          receipt.afterReaders,
          0,
          '[A1] configuration rejection installs no stdin data reader'
        )
      }
      assert.equal(
        stderr.includes(token),
        false,
        '[A3] classification never discloses bootstrap secret'
      )
    } finally {
      handle.terminate('force')
      await handle.exited
    }
  })
}
