import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import {
  createProcessPeer,
  createProcessTransport,
  createNativeProcessOffer
} from '../../src/process/index.js'
import type { IRuntimePeer } from '../../src/remote/runtime-api/peer.js'

it('[A2][A3] Deno explicit source does not require or prompt for discovery env permission', () => {
  /** Actual Deno executes without allow-env; imported modules and local Feature business run first. */
  const entry = fileURLToPath(new URL('./fixtures/deno-source-permission.mjs', import.meta.url))
  /** The fixture emits only safe preparation counters and error identity, never environment values. */
  const receipt = JSON.parse(
    execFileSync('deno', ['run', '--no-prompt', entry], { encoding: 'utf8', timeout: 15000 })
  )
  assert.equal(receipt.ordinary, 42)
  assert.equal(
    receipt.prepared,
    1,
    '[A2] explicit source prepares with denied discovery permission'
  )
  assert.equal(receipt.sourceCalls, 1)
})

it('[A2][A3] consumed process discovery cannot redirect a genuine grandchild stdin', async () => {
  /** The same actual automatic-child fixture already proves native forward and reverse business. */
  const entry = fileURLToPath(new URL('./fixtures/automatic-process.mjs', import.meta.url))
  /** Native execution stays with its original launcher and real exit observation. */
  let handle:
    | Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>
    | undefined
  /** The genuine accepted Peer is closed independently from the owned execution unit. */
  let peer: IRuntimePeer | undefined
  /** The one-off authentication token remains inside bootstrap and the actual native handshake. */
  const token = 'source-audit-native-token'
  try {
    peer = await createProcessPeer<IRuntimeDynamicSurface>({
      self: { name: 'audit-parent', instanceId: 'automatic-process-parent' },
      provide: { parentEcho: () => 'automatic-process-parent' },
      spawn: async (context) => {
        handle = await createNodeProcessLauncher({
          runtimeApiBootstrap: { name: 'audit-child', parentInstanceId: context.self.instanceId }
        }).launch(
          {
            command: process.execPath,
            args: [entry],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          { signal: new AbortController().signal, output: () => undefined }
        )
        /** The exact original launch fingerprint remains the remote route authority. */
        const offer = createNativeProcessOffer({
          peer: { id: context.self.instanceId, runtime: 'node' },
          auth: token,
          capabilities: context.capabilities
        })
        return createProcessTransport(handle.channel!, {
          role: 'initiator',
          peerId: handle.runtimeApiIdentity!.instanceId,
          offer,
          ipc: { connectionId: 'audit-parent', sessionId: 'audit-parent', log: () => undefined },
          report: () => undefined
        })
      },
      report: () => undefined
    })
    assert.equal(((await peer.request('probe', 'ordinary')) as { value: string }).value, 'ordinary')
    /** The child really spawns a grandchild with its default inherited environment. */
    const receipt = (await peer.request('auditSource')) as unknown as {
      consumed: boolean
      grandchild: { code: string; before: number; after: number }
    }
    assert.equal(
      receipt.consumed,
      true,
      '[A2] the automatic marker is consumed before nested spawn'
    )
    assert.deepEqual(
      receipt.grandchild,
      Object.assign(Object.create(null), { code: 'INVALID_CONFIG', before: 0, after: 0 }),
      '[A3] no arbitrary grandchild stdin reader is acquired'
    )
  } finally {
    await peer?.close()
    handle?.terminate('force')
    await handle?.exited
  }
}, 15000)

it('[A2][A3] a genuine unlaunched Bun Worker rejects missing bootstrap within its cold bound', () => {
  /** The parent uses a native Worker without the library launcher, so there is no trusted bootstrap. */
  const entry = fileURLToPath(new URL('./fixtures/unlaunched-worker-parent.mjs', import.meta.url))
  /**
   * A bounded fixture receipt distinguishes a settled INVALID_CONFIG from an indefinitely pending
   * Peer.
   */
  const receipt = JSON.parse(execFileSync('bun', [entry], { encoding: 'utf8', timeout: 15000 }))
  assert.equal(receipt.ordinary, 42)
  assert.equal(
    receipt.code,
    'INVALID_CONFIG',
    '[A3] a missing library bootstrap settles rather than hanging'
  )
}, 20000)
