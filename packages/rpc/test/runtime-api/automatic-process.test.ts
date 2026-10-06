import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { createProcessPeer } from '../../src/process/index.js'

/** A genuine child loads built public owners independently from the source parent. */
const entry = fileURLToPath(new URL('./fixtures/automatic-process.mjs', import.meta.url))

it('[A2][A17] framed bootstrap supplies child identity and parent route before automatic business', async () => {
  /** A one-off fixture token stays in bootstrap/auth, never in returned business metadata. */
  const token = 'c3-fixture-only-token'
  /** Actual exit and termination remain owned by the real launcher handle. */
  let handle:
    | Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>
    | undefined
  /** Preparation diagnostics remain available when a real startup fails. */
  const failures: unknown[] = []
  /** Genuine reverse dispatch is observed separately from fixture-returned labels. */
  let reverseCalls = 0
  /** The launcher exposes the exact safe identity placed in its authenticated bootstrap. */
  let childInstanceId: string | undefined
  /** The existing parent source executes before the missing automatic-source assertion. */
  let parent: IRuntimePeer | undefined
  try {
    parent = await createProcessPeer<IRuntimeDynamicSurface>({
      self: { name: 'parent', instanceId: 'automatic-process-parent' },
      provide: {
        parentEcho: () => {
          reverseCalls += 1
          return parent!.self.instanceId
        }
      },
      spawn: async (context) => {
        /** Current JS ignores this opt-in; an absent new type/export cannot be the RED. */
        const create = createNodeProcessLauncher as unknown as (
          options: unknown
        ) => ReturnType<typeof createNodeProcessLauncher>
        const launcher = create({
          runtimeApiBootstrap: {
            name: 'named-process-child',
            parentInstanceId: context.self.instanceId
          }
        })
        handle = await launcher.launch(
          {
            command: process.execPath,
            args: [entry],
            env: { inherit: ['PATH'], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
          },
          { signal: new AbortController().signal, output: () => undefined }
        )
        /** New bootstrap identity is a projection of the launcher owner, never the child's PID. */
        const identity = (handle as typeof handle & { runtimeApiIdentity?: { instanceId: string } })
          .runtimeApiIdentity
        childInstanceId = identity?.instanceId
        /** The actual peer independently negotiates its offer over the genuine byte stream. */
        const offer = createNativeProcessOffer({
          peer: { id: context.self.instanceId, runtime: 'node' },
          auth: token
        })
        return createProcessTransport(handle.channel!, {
          role: 'initiator',
          peerId: identity?.instanceId ?? 'legacy-process-child',
          offer: { ...offer, capabilities: context.capabilities },
          ipc: { connectionId: 'c3-process', sessionId: 'c3-process', log: () => undefined },
          report: (error) => {
            failures.push(error)
          }
        })
      },
      report: (error) => {
        failures.push(error)
      }
    })
    /** Imports, token handshake and actual provider dispatch must succeed before the business RED. */
    const result = (await parent.request('probe', 'ready')) as unknown as {
      value: string
      self: { name: string; instanceId: string } | null
      parent: string
    }
    assert.equal(result.value, 'ready')
    assert.equal(
      result.self?.name,
      'named-process-child',
      '[A17] automatic identity comes from the trusted launcher'
    )
    assert.equal(
      result.parent,
      'automatic-process-parent',
      '[A2] parent route comes from authenticated bootstrap'
    )
    assert.equal(
      reverseCalls,
      1,
      '[A2] a genuine reverse request reached only the exposed parent provider'
    )
    assert.equal(
      result.self?.instanceId,
      childInstanceId,
      '[A17] the child retained the exact launcher bootstrap identity'
    )
    assert.notEqual(
      result.self?.instanceId,
      String(handle!.identity.pid),
      '[A17] PID never becomes route authority'
    )
    assert.equal(
      JSON.stringify(result).includes(token),
      false,
      '[A2] bootstrap token stays private'
    )
    /** Sixteen real bidirectional calls must use data reply capacity on both framed endpoints. */
    const replies = await Promise.all(
      Array.from({ length: 16 }, (_, index) => parent!.request('probe', index, { timeoutMs: 2000 }))
    )
    assert.deepEqual(
      replies.map((reply) => (reply as { value: number }).value),
      Array.from({ length: 16 }, (_, index) => index),
      '[A84][A93] concurrent process runtime replies must not be shed as control traffic'
    )
    assert.equal(reverseCalls, 17, '[A93] all sixteen reverse providers really executed')
  } finally {
    try {
      await parent?.close()
    } finally {
      handle?.terminate('force')
      await handle?.exited
    }
  }
})
