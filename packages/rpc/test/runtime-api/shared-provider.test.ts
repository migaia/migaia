import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { bindRpcFrameIngress, messageFramerV1 } from '../../src/contract/framing/index.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import {
  createProviderAdmissionScope,
  prepareProviderAdmissionScope,
  type ProviderAdmissionRegistry
} from '../../src/core/internal/provider-admission.js'
import {
  createRuntimePeer,
  prepareRuntimePeerSourceContext,
  prepareRuntimePeerEndpoint,
  readRuntimePeerConnection,
  type IRuntimePeerProvide
} from '../../src/remote/runtime-api/peer.js'
import { runtimeSources } from './fixture.js'
import type { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'

it('[A73] a custom endpoint cannot advertise shared ordering while returning a different admission owner', async () => {
  const capabilities = [
    RpcCapability.runtimeApi,
    RpcCapability.batch,
    RpcCapability.generation,
    RpcCapability.order
  ]
  const channel = runtimeSources(capabilities, capabilities)
  const options = {
    self: { name: 'custom', instanceId: 'custom-provider' },
    report: () => undefined
  }
  const sources = await Promise.all([
    channel.sources[0](prepareRuntimePeerSourceContext(options.self)),
    channel.sources[1](
      prepareRuntimePeerSourceContext({ name: 'caller', instanceId: 'custom-caller' })
    )
  ])
  const signal = new AbortController().signal
  const built = await prepareRuntimePeerEndpoint(options, sources[0], signal)
  const admissionScope = createProviderAdmissionScope()
  const scope = prepareProviderAdmissionScope(
    admissionScope,
    8,
    8,
    bindRpcFrameIngress(messageFramerV1.accept, messageFramerV1.frame).singleFrameLimits!
      .maxConcurrentMessages
  )
  const owner = readEndpointOwner<RpcOutboundAttachment>(
    built.endpoint,
    EndpointOwnerKey.outboundAttachment
  )!
  try {
    await assert.rejects(
      prepareRuntimePeerEndpoint(
        { ...options, endpointFactory: async () => built },
        sources[0],
        signal,
        {},
        admissionScope
      ),
      { code: 'CAPABILITY_UNSUPPORTED' },
      '[A73] a declared capability cannot stand in for the actual original shared owner'
    )
    assert.notEqual(
      owner.kernel.state,
      'active',
      '[A73] rejected construction disposes the acquired endpoint'
    )
    assert.equal(scope.size, 0)
  } finally {
    await built.endpoint.dispose()
    channel.close()
    scope.clear()
  }
})

/** The same final provider is reached by two real callers over separate physical channels. */
async function sharedProvider(provide: IRuntimePeerProvide) {
  /** Capacity is the actual selected canonical framer's cold fact, not a fixture limiter. */
  const admissionScope = createProviderAdmissionScope()
  const scope = prepareProviderAdmissionScope(
    admissionScope,
    8,
    8,
    bindRpcFrameIngress(messageFramerV1.accept, messageFramerV1.frame).singleFrameLimits!
      .maxConcurrentMessages
  )
  /** Both source offers exercise real authenticated-generation and ordering ports. */
  const capabilities = [
    /** D40 default request/stream deadlines are genuinely offered by both source owners. */
    RpcCapability.deadline,
    RpcCapability.runtimeApi,
    RpcCapability.batch,
    RpcCapability.generation,
    RpcCapability.order,
    RpcCapability.abort
  ]
  /** No fixture dispatcher or provider queue substitutes for either actual endpoint. */
  const channels = [
    runtimeSources(capabilities, capabilities),
    runtimeSources(capabilities, capabilities)
  ]
  /** Independent physical bindings retain their own pending/replay owners. */
  const pairs = await Promise.all(
    channels.map(async (channel, index) => {
      /** One logical provider identity is shared while callers remain distinct. */
      const options = {
        self: { name: 'provider', instanceId: 'shared-provider' },
        provide,
        report: () => undefined
      }
      return Promise.all([
        createRuntimePeer({
          self: { name: `caller-${index}`, instanceId: `caller-${index}` },
          connect: channel.sources[0],
          report: () => undefined
        }),
        createRuntimePeer({
          ...options,
          connect: channel.sources[1],
          // Reflect preserves the original assembly entry while RED predates its private seam.
          endpointFactory: (source, signal) =>
            Reflect.apply(prepareRuntimePeerEndpoint, undefined, [
              options,
              source,
              signal,
              {},
              admissionScope
            ])
        })
      ])
    })
  )
  return {
    scope,
    pairs,
    admissions: pairs.map((pair) =>
      readEndpointOwner<ProviderAdmissionRegistry>(
        readRuntimePeerConnection(pair[1]!).endpoint,
        EndpointOwnerKey.providerAdmission
      )!
    ),
    close: async () => {
      await Promise.all(pairs.flat().map((peer) => peer.close()))
      for (const channel of channels) channel.close()
      scope.clear()
    }
  }
}

it('[A59][A60] separate real caller sessions share final provider ordering across methods while other keys run', async () => {
  /** Holding the first business completion makes premature second execution observable. */
  let finish!: () => void
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  const effects: string[] = []
  const fixture = await sharedProvider({
    first: async () => {
      effects.push('first')
      await held
      return 1
    },
    second: () => {
      effects.push('second')
      return 2
    },
    independent: () => {
      effects.push('independent')
      return 3
    }
  })
  const first = fixture.pairs[0]![0]!.request('first', undefined, { orderKey: 'same' })
  void first.catch(() => undefined)
  let second: Promise<unknown> | undefined
  try {
    await vi.waitFor(() => assert.deepEqual(effects, ['first']))
    second = fixture.pairs[1]![0]!.request('second', undefined, { orderKey: 'same' })
    void second.catch(() => undefined)
    assert.equal(
      await fixture.pairs[1]![0]!.request('independent', undefined, { orderKey: 'other' }),
      3
    )
    assert.deepEqual(
      effects,
      ['first', 'independent'],
      '[A59] caller/method/connection cannot split the final provider key FIFO'
    )
    assert.equal(fixture.admissions[0], fixture.scope)
    assert.equal(fixture.admissions[1], fixture.scope)
    await vi.waitFor(() =>
      assert.equal(
        fixture.scope.size,
        2,
        '[A60] waiting and running retain one original lease each'
      )
    )
    finish()
    assert.equal(await first, 1)
    assert.equal(await second, 2)
    assert.deepEqual(effects, ['first', 'independent', 'second'])
    await vi.waitFor(() => assert.equal(fixture.scope.size, 0))
  } finally {
    finish()
    await fixture.close()
    await Promise.allSettled([first, second])
  }
})

it('[A75] calls without U25 options keep the original per-endpoint quota and do not enter the shared opt-in scope', async () => {
  let finish!: () => void
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  let started = 0
  const fixture = await sharedProvider({
    hold: async () => {
      started++
      await held
      return 1
    }
  })
  const calls = Array.from({ length: 9 }, () => fixture.pairs[0]![0]!.request('hold'))
  for (const call of calls) void call.catch(() => undefined)
  try {
    await vi.waitFor(() =>
      assert.equal(
        started,
        9,
        '[A75] opt-in shared limits cannot replace the original ordinary-call quota'
      )
    )
    assert.equal(fixture.scope.size, 0)
    finish()
    assert.deepEqual(await Promise.all(calls), Array(9).fill(1))
  } finally {
    finish()
    await fixture.close()
    await Promise.allSettled(calls)
  }
})

it.each([false, true])(
  '[A60][A61] closing one connection releases only its member after prior cancel=%s and cannot clear another connection queue',
  async (cancelFirst) => {
    let finish!: () => void
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    const effects: string[] = []
    /** A real received cancellation precedes retirement of the same provider session. */
    let providerSignal: IRpcAbortSignal | undefined
    const controller = new AbortController()
    const fixture = await sharedProvider({
      hold: async (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
        providerSignal = context.signal
        effects.push('hold')
        await held
        return 1
      },
      queued: () => {
        effects.push('queued')
        return 2
      }
    })
    const first = fixture.pairs[0]![0]!.request('hold', undefined, {
      orderKey: 'same',
      ...(cancelFirst ? { signal: controller.signal } : {})
    })
    void first.catch(() => undefined)
    let queued: Promise<unknown> | undefined
    let settled = false
    try {
      await vi.waitFor(() => assert.deepEqual(effects, ['hold']))
      queued = fixture.pairs[1]![0]!.request('queued', undefined, { orderKey: 'same' })
      void queued.catch(() => undefined)
      void queued.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      await vi.waitFor(() => assert.equal(fixture.scope.size, 2))
      if (cancelFirst) {
        controller.abort()
        await vi.waitFor(() => assert.equal(providerSignal!.aborted, true))
        assert.equal(fixture.scope.size, 2)
      }
      await fixture.pairs[0]![1]!.close()
      await vi.waitFor(() => assert.equal(settled, true))
      assert.equal(
        await queued,
        2,
        '[A61] retirement removes the exact head and starts the next actual session'
      )
      assert.equal(fixture.scope.size, 0)
      assert.deepEqual(effects, ['hold', 'queued'])
    } finally {
      finish()
      await fixture.close()
      await Promise.allSettled([first, queued])
    }
  }
)
