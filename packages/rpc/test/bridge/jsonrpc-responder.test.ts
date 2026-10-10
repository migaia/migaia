import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createProviderFeature } from '../../src/core/features/provider.js'
import { createOneWayFeature } from '../../src/core/features/one-way.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRemoteChannel } from '../../src/remote/types.js'
import type { IRpcFactoryConfig } from '../../src/core/typing.js'
import { RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '../../src/core/errors.js'
import { fromJsonRpcError } from '../../src/contract/error-jsonrpc.js'
import { bridgeFixture, flush } from './fixture.js'

/** The actual bridge and original provider share one composed kernel, registry and response owner. */
function responderEndpoint(
  channel: IRemoteChannel,
  options: Pick<IRpcFactoryConfig, 'idempotency'> = {}
) {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  return createComposedEndpoint(
    {
      ...options,
      id: 'client',
      targetIds: ['peer'],
      version: '1.0.0',
      transport: channel.transport,
      scheduler: channel.scheduler,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport })
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': createProviderFeature(outbound),
      'first-party-one-way': createOneWayFeature(outbound),
      'channel-ipc-queue': channel.features[0]!,
      'channel-ipc-log': channel.features[1]!
    }
  )
}

it('[BC14/A60] installed Core provider receives foreign invoke and ID-less notify on the same bridge', async () => {
  const fixture = bridgeFixture()
  const channel = await fixture.open()
  const endpoint = await responderEndpoint(channel)
  const calls: unknown[] = []
  endpoint.provide('echo', (context) => {
    calls.push(context.data)
    return context.success(context.data)
  })
  try {
    fixture.deliver({
      jsonrpc: '2.0',
      id: 7,
      method: 'migaia.invoke',
      params: { method: 'echo', args: [42] }
    })
    await flush()
    assert.deepEqual(calls, [[42]], 'foreign call reaches the original provider exactly once')
    assert.deepEqual(fixture.messages.at(-1), { jsonrpc: '2.0', id: 7, result: [42] })
    const before = fixture.messages.length
    fixture.deliver({
      jsonrpc: '2.0',
      method: 'migaia.invoke',
      params: { method: 'echo', args: [43] }
    })
    await flush()
    assert.deepEqual(calls, [[42], [43]])
    assert.equal(fixture.messages.length, before, 'notification has no response')
    assert.equal(fixture.closes, 0)
  } finally {
    await endpoint.dispose()
    await channel.close()
  }
})

it('[BC14/A60] full provider error cause retains source/code/name/message/stack on the correlated wire id', async () => {
  const fixture = bridgeFixture()
  const channel = await fixture.open()
  const endpoint = await responderEndpoint(channel)
  const cause = new TypeError('original-cause')
  const failure = new Error('provider-failure', { cause })
  endpoint.provide('fail', () => {
    throw failure
  })
  try {
    fixture.deliver({
      jsonrpc: '2.0',
      id: 'failure',
      method: 'migaia.invoke',
      params: { method: 'fail', args: [] }
    })
    await flush()
    const response = fixture.messages.at(-1)!
    assert.equal(response.id, 'failure')
    const error = fromJsonRpcError(response.error)
    assert.equal(error.name, 'Error')
    assert.equal(error.message, failure.message)
    assert.equal(error.stack, failure.stack)
    assert.ok(JSON.stringify(error).includes(cause.message))
    assert.equal(fixture.closes, 0)
  } finally {
    await endpoint.dispose()
    await channel.close()
  }
})

/** Caller-defined failed codes remain result metadata, not new Core error-code declarations. */
const failureCode = 'BUSINESS_DECLINED'
it.each(['failed', 'not-settled'] as const)(
  '[BC14/A60/F2] %s and replay retain the same full failure wire graph',
  async (mode) => {
    /** Actual hello negotiates original idempotency metadata before any keyed business call. */
    const fixture = bridgeFixture()
    const channel = await fixture.open({
      offer: { ...fixture.options.offer, capabilities: ['deadline@1', 'trace@1', 'idempotency@1'] }
    })
    const endpoint = await responderEndpoint(channel)
    /** The retained failure cannot execute the provider a second time. */
    let calls = 0
    endpoint.provide('failure', (context) => {
      calls++
      return mode === 'failed' ? context.failed('declined', failureCode) : (undefined as never)
    })
    try {
      fixture.deliver({
        jsonrpc: '2.0',
        id: 'first',
        method: 'migaia.invoke',
        params: { method: 'failure', args: [], meta: { idempotencyKey: 'same-key' } }
      })
      await flush()
      const first = fixture.messages.find((message) => message.id === 'first')!
      assert.ok(first?.error, 'first standard failure settles on its bridge correlation')
      const error = fromJsonRpcError(first.error)
      assert.equal(
        error.code,
        mode === 'failed' ? failureCode : RpcCoreErrorCode.providerNotSettled
      )
      assert.equal(error.source, RPC_CORE_ERROR_SOURCE)
      assert.ok(error.stack.length > 0)
      fixture.deliver({
        jsonrpc: '2.0',
        id: 'replay',
        method: 'migaia.invoke',
        params: { method: 'failure', args: [], meta: { idempotencyKey: 'same-key' } }
      })
      await flush()
      const replay = fixture.messages.find((message) => message.id === 'replay')!
      assert.deepEqual(
        fromJsonRpcError(replay.error),
        error,
        'replay retains the original graph and stack'
      )
      assert.equal(calls, 1)
      assert.equal(fixture.closes, 0)
    } finally {
      await endpoint.dispose()
      await channel.close()
    }
  }
)

it('[BC14/A60/F3] frozen scope error keeps native name/stack/cause without mutation', async () => {
  const fixture = bridgeFixture()
  const channel = await fixture.open({
    offer: { ...fixture.options.offer, capabilities: ['deadline@1', 'trace@1', 'idempotency@1'] }
  })
  /** The original scope callback can throw a caller-owned, non-extensible native error. */
  const cause = new RangeError('scope-cause')
  const failure = Object.freeze(new TypeError('scope-failed', { cause }))
  const endpoint = await responderEndpoint(channel, {
    idempotency: {
      scope: () => {
        throw failure
      }
    }
  })
  /** Scope failure remains before provider execution. */
  let calls = 0
  endpoint.provide('echo', (context) => {
    calls++
    return context.success(context.data)
  })
  try {
    fixture.deliver({
      jsonrpc: '2.0',
      id: 'frozen',
      method: 'migaia.invoke',
      params: { method: 'echo', args: [], meta: { idempotencyKey: 'frozen-key' } }
    })
    await flush()
    const response = fixture.messages.find((message) => message.id === 'frozen')!
    assert.ok(response?.error, 'frozen error settles its original correlation')
    const error = fromJsonRpcError(response.error)
    assert.equal(error.source, RPC_CORE_ERROR_SOURCE)
    assert.equal(error.code, RpcCoreErrorCode.internal)
    assert.equal(error.name, failure.name)
    assert.equal(error.message, failure.message)
    assert.equal(error.stack, failure.stack)
    assert.equal(error.cause?.name, cause.name)
    assert.equal(error.cause?.stack, cause.stack)
    assert.equal(Object.hasOwn(failure, 'source'), false)
    assert.equal(Object.hasOwn(failure, 'code'), false)
    assert.equal(calls, 0)
    assert.equal(fixture.closes, 0)
  } finally {
    await endpoint.dispose()
    await channel.close()
  }
})
