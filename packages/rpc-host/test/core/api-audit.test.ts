import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { expect, it, vi } from 'vitest'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { RpcCapability } from '@migaia/rpc-contract'
import { systemScheduler } from '@migaia/utils'
import { connect } from '../../dist/core/middleware/connect.js'

import { uuid } from '../fixtures/core-role/uuid.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import * as root from '../../dist/index.js'

it('keeps the authentication nonce helper outside the public root', () => {
  expect(root).not.toHaveProperty('createAuthenticationNonce')
})

it('releases the operation parent listener when the UUID callback throws synchronously', async () => {
  /** Count only listeners installed after endpoint construction. */
  const [left, right] = createMemoryTransportPair()
  /** The supported UUID middleware can fail while allocating a task identifier. */
  const original = new Error('audit UUID failed')
  /** A static target prevents unrelated discovery from running before the callback. */
  const endpoint = await createRuntimeEndpointComposition(
    {
      id: 'uuid-listener',
      transport: left,
      targetIds: ['remote'],
      middlewares: [
        connect({ transport: left }),
        uuid({
          generate(context) {
            if (context.variation === 'task') throw original
            return 'initial'
          }
        })
      ]
    },
    { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
  ).installing
  /** Track actual native subscriptions by receiver and listener identity. */
  const active = new Map<EventTarget, Set<unknown>>()
  /** Native delegates retain receiver semantics without mutable call/apply helpers. */
  const nativeAdd = EventTarget.prototype.addEventListener
  /** Removal must match exactly the native listener previously installed. */
  const nativeRemove = EventTarget.prototype.removeEventListener
  /** These spies observe public native operations, without reading a private Core owner. */
  const add = vi
    .spyOn(EventTarget.prototype, 'addEventListener')
    .mockImplementation(function (this: EventTarget, type, listener, options) {
      if (type === 'abort' && listener) {
        const listeners = active.get(this) ?? new Set()
        listeners.add(listener)
        active.set(this, listeners)
      }
      return Reflect.apply(nativeAdd, this, [type, listener, options])
    })
  /** Preserve actual removal while updating the instrumentation ledger. */
  const remove = vi
    .spyOn(EventTarget.prototype, 'removeEventListener')
    .mockImplementation(function (this: EventTarget, type, listener, options) {
      if (type === 'abort') active.get(this)?.delete(listener)
      return Reflect.apply(nativeRemove, this, [type, listener, options])
    })
  try {
    await expect(endpoint.send('remote', 'echo', 1, { timeoutMs: false })).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      cause: original
    })
    expect([...active.values()].reduce((count, listeners) => count + listeners.size, 0)).toBe(0)
  } finally {
    add.mockRestore()
    remove.mockRestore()
    await endpoint.dispose()
    left.close()
    right.close()
  }
})

it('closes an acquired source when native entropy fails before endpoint construction', async () => {
  /** Both physical ends are closed independently of whether rollback works. */
  const [left, right] = createMemoryTransportPair()
  /** Native entropy failure must remain the INVALID_CONFIG diagnostic's original cause. */
  const original = new Error('native entropy unavailable')
  /** Source release counts prove that construction's rollback owner actually ran. */
  const close = vi.fn(async () => {
    left.close()
    right.close()
  })
  /** Only the native fallible operation changes; the spy is restored after the isolated call. */
  const entropy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
    throw original
  })
  try {
    await expect(
      createRuntimePeer({
        self: { name: 'local', instanceId: 'local' },
        connect: async () => ({
          transport: left,
          peerId: 'remote',
          scheduler: systemScheduler,
          agreement: {
            source: 'static',
            codec: identityCodec.id,
            capabilities: [
              RpcCapability.runtimeApi,
              RpcCapability.batch,
              RpcCapability.forwardRoute
            ]
          },
          pipeline: { codec: identityCodec, framer: messageFramerV1 },
          features: [],
          close
        })
      })
    ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG', cause: original })
    expect(close).toHaveBeenCalledTimes(1)
    expect(left.closed).toBe(true)
  } finally {
    entropy.mockRestore()
    left.close()
    right.close()
  }
})
