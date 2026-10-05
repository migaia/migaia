import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import type { IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { createThreadPeer } from '../../src/threads/index.js'

/** A native Worker runs independently from Vitest and loads the built package. */
const entry = fileURLToPath(new URL('./fixtures/automatic-worker.mjs', import.meta.url))

it('[A2][A17] the genuine launcher supplies trusted child name and parent route without a child source', async () => {
  /** Both old and new launcher paths use the same actual Worker and borrowed channel owner. */
  let handle: Awaited<ReturnType<ReturnType<typeof createNodeThreadLauncher>['launch']>> | undefined
  /** Existing channel assembly consumes the same scheduler and independent child ACK when present. */
  const channels = createNodeThreadChannelFactory({ scheduler: systemScheduler })
  /** Genuine reverse dispatch is measured independently of child-returned bootstrap metadata. */
  let reverseCalls = 0
  /** A real ordinary call proves worker startup, imports and provider dispatch before the RED. */
  let parent: IRuntimePeer | undefined
  try {
    parent = await createThreadPeer<IRuntimeDynamicSurface>({
      self: { name: 'parent', instanceId: 'automatic-parent' },
      provide: {
        parentEcho: () => {
          reverseCalls += 1
          return parent!.self.instanceId
        }
      },
      spawn: async (context) => {
        /** The JS-compatible option is ignored by the current launcher; no missing import is RED. */
        const create = createNodeThreadLauncher as unknown as (
          options: unknown
        ) => ReturnType<typeof createNodeThreadLauncher>
        const launcher = create({ runtimeApi: context })
        handle = await launcher.launch(
          { entry, name: 'named-child' },
          { signal: new AbortController().signal }
        )
        return channels.open(handle, new AbortController().signal)
      },
      report: () => undefined
    })
    /** The baseline probe executes inside the actual native child, not a mocked facade. */
    const result = (await parent.request('probe', 'ready')) as unknown as {
      value: string
      self: { name: string; instanceId: string } | null
      parent: string
    }
    assert.equal(
      result.value,
      'ready',
      '[A2] ordinary child business succeeds before automatic-source assertion'
    )
    assert.equal(
      result.self?.name,
      'named-child',
      '[A17] automatic self.name comes from the trusted launcher'
    )
    assert.equal(
      result.self?.instanceId,
      handle!.identity.fingerprint,
      '[A17] route ID is the original canonical fingerprint'
    )
    assert.equal(
      result.parent,
      'automatic-parent',
      '[A2] the genuine child reverse request reaches the authenticated parent route'
    )
    assert.equal(
      reverseCalls,
      1,
      '[A2] parent business actually executed through the reverse route'
    )
  } finally {
    try {
      await parent?.close()
    } finally {
      handle?.terminate()
      await handle?.exited
    }
  }
})
