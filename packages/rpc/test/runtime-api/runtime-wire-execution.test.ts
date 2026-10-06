import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { connected } from './fixture.js'
import type { IRemoteCallOptions } from '../../src/remote/types.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import type { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import type { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import { readRuntimeCarrier } from '../../src/contract/runtime-api/carrier.js'
import type { IRpcRuntimeEnvelope } from '../../src/contract/runtime-api/types.js'
import { RpcRouteProfile } from '../../src/contract/wire-constants.js'

/** Independent source offers explicitly exercise the new profile without changing default offers. */
const capabilities = [
  RpcCapability.runtimeApi,
  RpcCapability.batch,
  RpcCapability.generation,
  RpcCapability.group
]

it('[A64][A68] oversized complete group result fails PAYLOAD_INVALID and seals that failure instead of hanging', async () => {
  /** The group is tiny on input; only the actual provider result exceeds the physical frame ceiling. */
  let effects = 0
  const selected = [...capabilities, RpcCapability.outcome, RpcCapability.deadline]
  const fixture = await connected(
    {},
    {
      large: () => {
        effects++
        return 'x'.repeat(16 * 1024 * 1024)
      }
    },
    selected,
    selected
  )
  try {
    await assert.rejects(
      fixture.peers[0].group([{ method: 'large' }], {
        timeoutMs: 500,
        idempotencyKey: 'large-result'
      }),
      { code: 'PAYLOAD_INVALID' },
      '[A64] exact terminal failure must arrive before the caller deadline'
    )
    assert.equal(effects, 1, '[A64] executed business is never rolled back or retried')
    const outcome = await fixture.peers[0].outcome('large-result')
    assert.equal(outcome.state, 'done')
    if (outcome.state !== 'done' || outcome.outcome.completion.ok)
      assert.fail('[A68] actual failed group completion must be retained')
    assert.equal(outcome.outcome.completion.error.code, 'PAYLOAD_INVALID')
    assert.ok(outcome.outcome.completion.error.stack)
  } finally {
    await fixture.close()
  }
})

it.each(['options', 'target', 'mode', 'empty', 'getter', 'revoked'] as const)(
  '[A62][A73] local group %s is INVALID_CONFIG before any physical send or provider effect',
  async (shape) => {
    /** Malformed local steps cannot reach the sole original physical sender. */
    let calls = 0
    let reads = 0
    const selected = [...capabilities, RpcCapability.group]
    const fixture = await connected(
      {},
      {
        first: () => {
          calls++
          return 42
        }
      },
      selected,
      selected
    )
    const sender = readEndpointOwner<RpcOutboundSender>(
      readRuntimePeerConnection(fixture.peers[0]).endpoint,
      'outbound-pipeline'
    )!
    const send = vi.spyOn(sender.transport, 'send')
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    const steps =
      shape === 'empty'
        ? []
        : shape === 'revoked'
          ? revoked.proxy
          : shape === 'getter'
            ? [
                Object.defineProperty({}, 'method', {
                  enumerable: true,
                  get: () => {
                    reads++
                    return 'first'
                  }
                })
              ]
            : [{ method: 'first', [shape]: shape === 'options' ? {} : 'other' }]
    try {
      await assert.rejects(async () => fixture.peers[0].group(steps as never), {
        code: 'INVALID_CONFIG'
      })
      assert.equal(send.mock.calls.length, 0)
      assert.equal(calls, 0)
      assert.equal(reads, 0)
    } finally {
      send.mockRestore()
      await fixture.close()
    }
  }
)

it('[A72] a legacy response cannot settle a new task that requires the full authenticated generation tuple', async () => {
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  let started = false
  const selected = [...capabilities, RpcCapability.order]
  const fixture = await connected(
    {},
    {
      hold: async () => {
        started = true
        await blocked
        return 42
      }
    },
    selected,
    selected
  )
  const client = readEndpointOwner<RpcOutboundAttachment>(
    readRuntimePeerConnection(fixture.peers[0]).endpoint,
    EndpointOwnerKey.outboundAttachment
  )!
  const provider = readEndpointOwner<RpcOutboundAttachment>(
    readRuntimePeerConnection(fixture.peers[1]).endpoint,
    EndpointOwnerKey.outboundAttachment
  )!
  const sent = vi.spyOn(client.kernel, 'send')
  const dispatch = vi.spyOn(client.kernel, 'dispatchRoute')
  let settled = false
  const running = fixture.peers[0]
    .request('hold', undefined, { orderKey: 'same', timeoutMs: false })
    .then((value) => {
      settled = true
      return value
    })
  void running.catch(() => undefined)
  try {
    await vi.waitFor(() => assert.equal(started, true))
    const envelope = sent.mock.calls
      .map(([value]) => readRuntimeCarrier(value)?.frame)
      .find(
        (value) =>
          value && typeof value === 'object' && Reflect.get(value, 'kind') === 'runtime-call'
      ) as IRpcRuntimeEnvelope
    assert.ok(envelope)
    await provider.sendFrame({
      kind: 'response',
      id: envelope.id,
      ok: true,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'response',
          applicationVersion: '1.0',
          senderId: 'child-1',
          targetId: 'parent-1',
          receiverId: 'parent-1',
          sentAt: 0,
          method: 'hold'
        },
        payload: 'legacy-poison'
      }
    })
    await vi.waitFor(() => assert.ok(dispatch.mock.calls.some(([kind]) => kind === 'response')))
    const index = dispatch.mock.calls.findIndex(([kind]) => kind === 'response')
    await dispatch.mock.results[index]!.value
    assert.equal(
      settled,
      false,
      '[A72] authenticated legacy method/id matching lacks the required generation association'
    )
    complete()
    assert.equal(await running, 42)
  } finally {
    complete()
    await running
    sent.mockRestore()
    dispatch.mockRestore()
    await fixture.close()
  }
})

it('[A67][A69] notify send completion precedes business completion while its before-start receipt and keyed outcome stay live', async () => {
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  let signal: IRpcAbortSignal | undefined
  const selected = [
    ...capabilities,
    RpcCapability.order,
    RpcCapability.cancelBeforeStart,
    RpcCapability.outcome
  ]
  const fixture = await connected(
    {},
    {
      hold: async (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
        signal = context.signal
        await blocked
        return 42
      }
    },
    selected,
    selected
  )
  const control = new AbortController()
  try {
    const peer = fixture.peers[0]
    await peer.notify('hold', undefined, {
      orderKey: 'same',
      cancel: 'before-start',
      signal: control.signal,
      idempotencyKey: 'notify-key'
    })
    await vi.waitFor(() => assert.ok(signal))
    assert.equal(
      (await peer.outcome('notify-key')).state,
      'pending',
      '[A67] public notify Promise cannot pretend that business already finished'
    )
    control.abort(new Error('started notification intent'))
    assert.equal(signal!.aborted, false)
    complete()
    await vi.waitFor(async () => assert.equal((await peer.outcome('notify-key')).state, 'done'))
    const done = await peer.outcome('notify-key')
    if (done.state !== 'done') assert.fail('[A69] actual notification completion must be retained')
    assert.equal(done.outcome.completion.ok, true)
    assert.equal(fixture.failures.length, 0)
  } finally {
    complete()
    await fixture.close()
  }
})

it('[A67] before-start notify rejects a failed physical write after send admission instead of leaving its public Promise pending', async () => {
  const selected = [...capabilities, RpcCapability.cancelBeforeStart]
  let effects = 0
  const fixture = await connected(
    {},
    {
      value: () => {
        effects++
        return 42
      }
    },
    selected,
    selected
  )
  const endpoint = readRuntimePeerConnection(fixture.peers[0]).endpoint
  const sender = readEndpointOwner<RpcOutboundSender>(endpoint, 'outbound-pipeline')!
  const failure = new Error('fixture physical write rejected')
  const send = vi.spyOn(sender.transport, 'send').mockImplementationOnce(async () => {
    throw failure
  })
  let settlement: 'pending' | 'resolved' | 'rejected' = 'pending'
  let rejection: unknown
  try {
    void fixture.peers[0].notify('value', undefined, { cancel: 'before-start' }).then(
      () => {
        settlement = 'resolved'
      },
      (error: unknown) => {
        settlement = 'rejected'
        rejection = error
      }
    )
    await vi.waitFor(() =>
      assert.equal(
        settlement,
        'rejected',
        '[A67] failed physical completion rejects the original send Promise'
      )
    )
    assert.equal(Reflect.get(rejection as object, 'code'), 'TRANSPORT')
    assert.equal(Reflect.get(rejection as object, 'cause'), failure)
    assert.equal(effects, 0)
  } finally {
    send.mockRestore()
    await fixture.close()
  }
})

it('[A71] genuine bilateral describe binds each peer generation before business dispatch', async () => {
  const fixture = await connected({}, { value: () => 42 }, capabilities, capabilities)
  try {
    const remote = readRuntimePeerConnection(fixture.peers[0]).description
    assert.deepEqual(
      { ...Reflect.get(remote!.self, 'generation') },
      {
        kind: 'session',
        value: 0,
        providerId: 'child-1'
      },
      '[A71] the accepted identity contains the actual first connection generation'
    )
    assert.equal(await fixture.peers[0].request('value'), 42)
  } finally {
    await fixture.close()
  }
})

it('[A62][A76] a real Peer group executes through the original provider and returns fail-stop outcomes', async () => {
  const effects: string[] = []
  const fixture = await connected(
    {},
    {
      first: () => {
        effects.push('first')
        return 42
      },
      fail: () => {
        throw new RangeError('fixture group failure')
      },
      last: () => {
        effects.push('last')
        return 7
      }
    },
    capabilities,
    capabilities
  )
  try {
    const group = Reflect.get(fixture.peers[0], 'group')
    assert.equal(typeof group, 'function', '[A62] the genuine prepared Peer exposes group')
    const result = await group([{ method: 'first' }, { method: 'fail' }, { method: 'last' }])
    assert.deepEqual(
      result.map((step: { state: string }) => step.state),
      ['success', 'failure', 'not-executed']
    )
    assert.equal(result[0].state, 'success')
    assert.equal(result[1].state, 'failure')
    if (result[0].state === 'success') assert.equal(result[0].result, 42)
    if (result[1].state === 'failure') {
      assert.equal(result[1].error.name, 'RangeError')
      assert.ok(result[1].error.stack)
    }
    assert.deepEqual(effects, ['first'])
  } finally {
    await fixture.close()
  }
})

it('[A59][A66] real ordered requests share provider leases; queued cancel wins and started cancel cannot abort business', async () => {
  const selected = [...capabilities, RpcCapability.order, RpcCapability.cancelBeforeStart]
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  const effects: string[] = []
  let signal: IRpcAbortSignal | undefined
  const fixture = await connected(
    {},
    {
      hold: async (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
        effects.push('hold')
        signal = context.signal
        await blocked
        return 42
      },
      queued: () => {
        effects.push('queued')
        return 7
      },
      other: () => {
        effects.push('other')
        return 9
      }
    },
    selected,
    selected
  )
  const firstControl = new AbortController()
  const queuedControl = new AbortController()
  try {
    const peer = fixture.peers[0]
    const firstOptions: IRemoteCallOptions = {
      orderKey: 'same',
      cancel: 'before-start',
      signal: firstControl.signal
    }
    const first = peer.request('hold', undefined, firstOptions)
    /** Cleanup also observes a failed fixture's outstanding original operation. */
    void first.catch(() => undefined)
    await vi.waitFor(() => assert.deepEqual(effects, ['hold']))
    const queuedOptions: IRemoteCallOptions = {
      orderKey: 'same',
      cancel: 'before-start',
      signal: queuedControl.signal
    }
    const queued = peer.request('queued', undefined, queuedOptions)
    const rejected = assert.rejects(queued, (error: unknown) => {
      assert.equal(Reflect.get(error as object, 'code'), 'CANCELLED')
      return true
    })
    /** Preserve the assertion failure while preventing failure-path fixture cleanup from leaking it. */
    void rejected.catch(() => undefined)
    const other = peer.request('other', undefined, {
      orderKey: 'different',
      cancel: 'before-start'
    })
    assert.equal(await other, 9)
    const admission = readEndpointOwner<ProviderAdmissionRegistry>(
      readRuntimePeerConnection(fixture.peers[1]).endpoint,
      EndpointOwnerKey.providerAdmission
    )!
    await vi.waitFor(() => assert.equal(admission.size, 2))
    assert.deepEqual(
      effects,
      ['hold', 'other'],
      '[A59] same key remains queued; another key executes'
    )
    queuedControl.abort(new Error('queued fixture intent'))
    await rejected
    firstControl.abort(new Error('started fixture intent'))
    await vi.waitFor(() => assert.equal(admission.size, 1))
    assert.equal(
      signal!.aborted,
      false,
      '[A66] the final original provider start defeats caller abort'
    )
    complete()
    assert.equal(await first, 42)
    await vi.waitFor(() => assert.equal(admission.size, 0))
    assert.deepEqual(effects, ['hold', 'other'])
  } finally {
    complete()
    await fixture.close()
  }
})

it('[A68][A69] real outcome lookup observes the original pending claim and complete sealed group without executing business', async () => {
  const selected = [...capabilities, RpcCapability.outcome]
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  let effects = 0
  const fixture = await connected(
    {},
    {
      hold: async () => {
        effects++
        await blocked
        return 42
      }
    },
    selected,
    selected
  )
  try {
    const peer = fixture.peers[0]
    assert.equal(
      typeof Reflect.get(peer, 'outcome'),
      'function',
      '[A68] prepared Peer exposes the read-only query'
    )
    const lookup = Reflect.get(peer, 'outcome')
    const unknown = await lookup('absent')
    assert.equal(unknown.state, 'unknown')
    assert.equal(unknown.store.kind, 'memory')
    assert.equal(unknown.store.continuity, 'retained')
    assert.ok(unknown.store.epoch)
    const running = peer.group([{ method: 'hold' }], { idempotencyKey: 'key' })
    void running.catch(() => undefined)
    await vi.waitFor(() => assert.equal(effects, 1))
    assert.equal((await lookup('key')).state, 'pending')
    assert.equal(
      effects,
      1,
      '[A68] querying an existing pending claim cannot execute or join business'
    )
    complete()
    await running
    const done = await lookup('key')
    assert.equal(done.state, 'done')
    assert.equal(done.store.kind, 'memory')
    assert.equal(done.store.epoch, unknown.store.epoch)
    assert.equal(done.outcome.completion.ok, true)
    assert.ok(Array.isArray(done.outcome.completion.result))
    assert.deepEqual(
      done.outcome.completion.result.map((step: { state: string }) => step.state),
      ['success']
    )
    assert.equal(Reflect.get(done.outcome.completion.result[0] as object, 'result'), 42)
    assert.equal(done.outcome.targetGeneration.providerId, 'child-1')
    assert.equal(effects, 1)
  } finally {
    complete()
    await fixture.close()
  }
})
