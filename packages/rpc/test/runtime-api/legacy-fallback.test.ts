import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { systemScheduler } from '@migaia/utils/scheduler'
import { messageFramerV1 } from '../../src/contract/framing/index.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { registerBatchAgreement } from '../../src/core/internal/batch-frame.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { registerRemoteMethods } from '../../src/remote/serve-methods.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { legacyEndpoint } from './fixture.js'

/** Both old wire capability combinations must preserve the same fallback business path. */
const legacyCapabilities: readonly (readonly string[])[] = [[], [RpcCapability.batch]]
for (const capabilities of legacyCapabilities) {
  it(`[A31] a legacy peer without runtime-api keeps v1 calls and sends no v2 describe (batch=${capabilities.length > 0})`, async () => {
    /** Real native endpoints exchange legacy frames without a fixture business dispatcher. */
    const [parentTransport, childTransport] = createMemoryTransportPair()
    /** Count writes independently of provider results to exclude blind v2 probes. */
    const frames: { method?: string }[] = []
    /** Preserve the real physical adapter and its receive subscriptions. */
    const observed = {
      ...parentTransport,
      send: (message: unknown) => {
        frames.push(message as { method?: string })
        return parentTransport.send(message)
      }
    }
    registerBatchAgreement(observed, capabilities)
    registerBatchAgreement(childTransport, capabilities)
    /** The old explicit contract remains the authority for the legacy callee. */
    const child = await legacyEndpoint('legacy-child', childTransport)
    /** New reverse methods remain unregistered when the actual capability intersection is empty. */
    let reverseCalls = 0
    registerRemoteMethods(
      {
        schemaVersion: 1,
        plugin: 'doc',
        features: { api: { methods: { save: { mode: 'request', idempotent: false } } } }
      },
      { endpoint: child as unknown as IRpcEndpoint },
      () => ({ save: () => 'legacy-saved' }),
      () => false,
      () => undefined
    )
    /** The channel publishes only the independently configured old peer's actual offer. */
    const parent = await createRuntimePeer({
      self: { name: 'parent', instanceId: 'parent' },
      provide: {
        reverse: () => {
          reverseCalls += 1
          return 'hidden'
        }
      },
      connect: async (context) => ({
        peerId: 'legacy-child',
        transport: observed,
        scheduler: systemScheduler,
        pipeline: { codec: identityCodecV1, framer: messageFramerV1 },
        agreement: {
          source: 'static',
          codec: identityCodecV1.id,
          capabilities: context.capabilities.filter((value) => capabilities.includes(value))
        },
        features: [],
        close: async () => undefined
      }),
      report: () => undefined
    })
    try {
      assert.equal(
        await parent.request('doc.api.save', []),
        'legacy-saved',
        '[A31] the old explicit contract executes'
      )
      await assert.rejects(child.send('parent', 'reverse', null), { code: 'PROVIDER_NOT_FOUND' })
      assert.equal(
        reverseCalls,
        0,
        '[A31] absent runtime agreement never enables reverse providers'
      )
      assert.deepEqual((await parent.describe()).methods, [])
      assert.equal(
        frames.some((frame) => frame.method === RemoteMethodName.runtimeDescribe),
        false,
        '[A31] no new reserved describe frame is sent'
      )
    } finally {
      await parent.close()
      await child.dispose()
      parentTransport.close()
    }
  })
}
