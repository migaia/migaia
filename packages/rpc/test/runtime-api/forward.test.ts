import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createThreadPlugin, type IRuntimeThreadPluginOptions } from '../../src/threads/plugin.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import {
  readRuntimePeerEndpoint,
  readRuntimePeerConnection,
  prepareRuntimePeerEndpoint
} from '../../src/remote/runtime-api/peer.js'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import * as portable from '../../src/contract/normalize.js'
import { byteProcessPipeline, messageProcessPipeline } from '../../src/process/pipeline.js'
import { registerFastCodec } from '../../src/core/internal/fast-path.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { ping } from '../../src/core/middleware/ping.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import {
  readAuthenticationEnvelope,
  wrapAuthenticationEnvelope
} from '../../src/core/middleware/authentication-envelope.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from './fixture.js'
import { readRuntimeCarrier } from '../../src/contract/runtime-api/carrier.js'
import type { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import type { IRuntimeOutlet } from '../../src/remote/runtime-api/outlet.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'
import { RpcError, RpcCoreErrorCode } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import type { IRpcRuntimeEnvelope } from '../../src/contract/runtime-api/types.js'
import { createProcessProviderAdmission } from '../../src/process/resilience/provider-admission.js'
import { normalizeProcessResilienceOptions } from '../../src/process/resilience/session.js'
import { createRemoteBindingDrain } from '../../src/remote/internal/binding-drain.js'

it.each(['quota', 'drain'] as const)(
  '[A60][A67][A114] original native %s owns a forwarded stream before C open',
  async (policy) => {
    /** Genuine Host slots compile the relay; native policy wraps that same registered callback. */
    const owners = [owner(), owner(), owner()] as const
    const carriers: ReturnType<typeof runtimeSources>[] = []
    const capabilities = [
      ...RUNTIME_API_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.order,
      RpcCapability.cancelBeforeStart
    ].filter((value) => value !== RpcCapability.close)
    /** C's real iterator construction can precede its first pull and has a visible business effect. */
    let constructed = 0
    let finish!: () => void
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** A held original C open write exposes B's preparation lifetime without pulling an item. */
    let openSeen = false
    let releaseOpen!: () => void
    const openHeld = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    /** Native quota clock moves only after the actual describe exchange has completed. */
    let offset = 0
    const scheduler = { ...systemScheduler, now: () => systemScheduler.now() + offset }
    const drain = createRemoteBindingDrain(scheduler, () => undefined)
    let governor: ReturnType<typeof createProcessProviderAdmission> | undefined
    let restoreSend: (() => void) | undefined
    let pending: Promise<unknown> | undefined
    /** Native policy and physical preparation failures stay visible throughout the fixture. */
    const failures: unknown[] = []
    try {
      carriers.push(
        await attach(
          owners[1],
          owners[2],
          'c',
          'b',
          {},
          {
            report: (error) => failures.push(error),
            provide: {
              values: () => {
                constructed++
                return (async function* () {
                  await held
                  yield 1
                  return 42
                })()
              }
            }
          },
          runtimeSources(capabilities, capabilities)
        )
      )
      /** Borrow the genuine shared Host class; a custom endpoint cannot replace its ownership. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        readRuntimePeerConnection(readRuntimeOutletConnection(owners[1].thread, 'c')!.peer)
          .endpoint,
        'provider-admission'
      )!
      if (policy === 'drain') {
        const sender = readEndpointOwner<RpcOutboundSender>(
          readRuntimePeerConnection(readRuntimeOutletConnection(owners[2].thread, 'b')!.peer)
            .endpoint,
          'outbound-pipeline'
        )!
        const original = sender.transport.send
        const spy = vi.spyOn(sender.transport, 'send').mockImplementation(async (frame) => {
          const envelope = readRuntimeCarrier(frame)?.frame as
            | { kind?: string; stream?: { event?: string } }
            | undefined
          if (envelope?.kind === 'runtime-control' && envelope.stream?.event === 'open') {
            openSeen = true
            await openHeld
          }
          /** Kernel.send is a native method; preserve its exact receiver without mutable bind. */
          return Reflect.apply(original, sender.transport, [frame])
        })
        restoreSend = () => spy.mockRestore()
      }
      carriers.push(
        await attach(
          owners[0],
          owners[1],
          'b',
          'a',
          {},
          {
            expose: ['c'],
            report: (error) => failures.push(error),
            provide: { baseline: () => 7 },
            endpointFactory: async (channel, signal) => {
              /** The original quota and drain owners retain all scalar and streaming registrations. */
              const endpoint = await prepareRuntimePeerEndpoint(
                { self: { name: 'a', instanceId: 'a-caller' }, report: () => undefined },
                channel,
                signal,
                {},
                admission
              )
              governor = createProcessProviderAdmission(
                channel,
                normalizeProcessResilienceOptions({
                  scheduler,
                  report: () => undefined,
                  maxCallsPerMinute: policy === 'quota' ? 1 : 100,
                  idleTimeoutMs: 600_000
                }),
                scheduler,
                async () => undefined,
                () => undefined
              )
              return drain.wrap(channel, governor.wrap(endpoint))
            }
          },
          runtimeSources(capabilities, capabilities)
        )
      )
      offset = 60_000
      const outlet = owners[0].thread as unknown as IRuntimeOutlet
      if (policy === 'quota') assert.equal(await outlet.request('b', 'baseline'), 7)
      const iterator = outlet.stream('b', 'c.values', undefined, {
        orderKey: 'same',
        cancel: 'before-start'
      })
      pending = iterator.next()
      void pending.catch(() => undefined)
      if (policy === 'quota') {
        await assert.rejects(pending)
        assert.equal(
          constructed,
          0,
          '[A60] B quota refusal must precede actual C iterator construction'
        )
      } else {
        await vi.waitFor(() => assert.equal(openSeen, true))
        assert.equal(constructed, 1)
        let drained = false
        const draining = drain.drainCurrent().then(() => {
          drained = true
        })
        await new Promise<void>((resolve) => setImmediate(resolve))
        assert.equal(
          drained,
          false,
          '[A67] actual C preparation already occupies B original drain lifetime'
        )
        releaseOpen()
        finish()
        /** Observe actual settlement separately from the drain barrier to locate any lost terminal. */
        let first: unknown
        void pending.then(
          (result) => {
            first = result
          },
          (error) => {
            first = error
          }
        )
        await vi.waitFor(() =>
          assert.deepEqual({ first, failures }, { first: { done: false, value: 1 }, failures: [] })
        )
        let final: unknown
        const returning = iterator.return!().then((result) => {
          final = result
        })
        await vi.waitFor(() => assert.deepEqual(final, { done: true, value: 42 }))
        await returning
        await vi.waitFor(() => assert.equal(drained, true))
        await draining
      }
    } finally {
      releaseOpen()
      finish()
      restoreSend?.()
      governor?.close()
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
      await pending?.catch(() => undefined)
    }
  }
)

it.each(['mixed', 'multiple', 'failure', 'keyed-local', 'lookup'] as const)(
  '[A62][A65][A69][A114] forwarded group namespace %s preserves one final provider and explicit query refusal',
  async (policy) => {
    /** Four original Hosts provide two distinct downstream targets and B's actual local route. */
    const owners = [owner(), owner(), owner(), owner()] as const
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** Only final business execution changes this list; validation and lookup have no effects. */
    const effects: string[] = []
    const capabilities = [
      ...RUNTIME_API_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.group,
      RpcCapability.order,
      RpcCapability.outcome
    ]
    try {
      carriers.push(
        await attach(
          owners[1],
          owners[2],
          'c',
          'b',
          {},
          {
            provide: {
              first: () => {
                effects.push('first')
                return 1
              },
              fail: () => {
                effects.push('fail')
                throw new RpcError(
                  RpcCoreErrorCode.capabilityUnsupported,
                  RpcCoreErrorText.capabilityUnsupported
                )
              },
              last: () => {
                effects.push('last')
                return 3
              }
            }
          },
          runtimeSources(capabilities, capabilities)
        )
      )
      if (policy === 'multiple')
        carriers.push(
          await attach(
            owners[1],
            owners[3],
            'd',
            'b',
            {},
            {
              provide: {
                first: () => {
                  effects.push('d')
                  return 4
                }
              }
            },
            runtimeSources(capabilities, capabilities)
          )
        )
      carriers.push(
        await attach(
          owners[0],
          owners[1],
          'b',
          'a',
          {},
          {
            expose: policy === 'multiple' ? ['c', 'd'] : ['c'],
            ...(policy === 'mixed' || policy === 'keyed-local' || policy === 'lookup'
              ? {
                  provide: {
                    local: () => {
                      effects.push('local')
                      return 5
                    }
                  }
                }
              : {})
          },
          runtimeSources(capabilities, capabilities)
        )
      )
      const upstream = owners[0].thread as unknown as IRuntimeOutlet
      const sender = readEndpointOwner<RpcOutboundSender>(
        readRuntimePeerConnection(readRuntimeOutletConnection(owners[1].thread, 'c')!.peer)
          .endpoint,
        'outbound-pipeline'
      )!
      const send = vi.spyOn(sender.transport, 'send')
      try {
        if (policy === 'failure') {
          const result = await upstream.group(
            'b',
            [{ method: 'c.first' }, { method: 'c.fail' }, { method: 'c.last' }],
            { idempotencyKey: 'forward-group' }
          )
          assert.deepEqual(
            result.map((step) => step.state),
            ['success', 'failure', 'not-executed']
          )
          assert.deepEqual(effects, ['first', 'fail'])
          if (result[1]!.state !== 'failure')
            assert.fail('[A65] actual C failure must stay in complete group report')
          assert.equal(result[1]!.error.code, RpcCoreErrorCode.capabilityUnsupported)
          assert.ok(result[1]!.error.stack)
          assert.equal((await upstream.outcome('b', 'forward-group')).state, 'done')
          const groups = send.mock.calls
            .map((args) => readRuntimeCarrier(args[0])?.frame as { kind?: string } | undefined)
            .filter((frame) => frame?.kind === 'runtime-group')
          assert.equal(groups.length, 1)
        } else {
          await assert.rejects(
            async () =>
              policy === 'lookup'
                ? upstream.outcome('b', 'unclaimed')
                : policy === 'keyed-local'
                  ? upstream.request('b', 'local', undefined, {
                      orderKey: 'same',
                      idempotencyKey: 'ambiguous'
                    })
                  : upstream.group('b', [
                      { method: 'c.first' },
                      { method: policy === 'multiple' ? 'd.first' : 'local' }
                    ]),
            {
              code:
                policy === 'lookup' || policy === 'keyed-local'
                  ? RpcCoreErrorCode.capabilityUnsupported
                  : RpcCoreErrorCode.invalidConfig
            }
          )
          assert.deepEqual(effects, [])
          assert.equal(send.mock.calls.length, 0)
        }
      } finally {
        send.mockRestore()
      }
    } finally {
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
    }
  }
)

it('[A59][A61][A114] forwarded order-only notify holds B original lease until C business completion', async () => {
  /** Forwarding uses the actual three Host scopes and compiled provider callbacks. */
  const owners = [owner(), owner(), owner()] as const
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** C's business completion stays separate from A's successful physical notification. */
  let started = false
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const capabilities = [...RUNTIME_API_CAPABILITIES, RpcCapability.generation, RpcCapability.order]
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            service: {
              value: async () => {
                started = true
                await held
                return 42
              }
            }
          }
        },
        runtimeSources(capabilities, capabilities)
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        { expose: ['c'] },
        runtimeSources(capabilities, capabilities)
      )
    )
    const upstream = owners[0].thread as unknown as IRuntimeOutlet
    await upstream.notify('b', 'c.service.value', undefined, { orderKey: 'same' })
    await vi.waitFor(() => assert.equal(started, true))
    const admission = readEndpointOwner<ProviderAdmissionRegistry>(
      readRuntimePeerConnection(readRuntimeOutletConnection(owners[1].thread, 'a')!.peer).endpoint,
      'provider-admission'
    )!
    /** Allow original completed physical-send cleanup to run while C remains held. */
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(
      admission.size,
      1,
      '[A61] physical notify completion cannot release B business lease'
    )
    release()
    await vi.waitFor(() => assert.equal(admission.size, 0))
  } finally {
    release()
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it.each(['request', 'group', 'notify', 'stream'] as const)(
  '[A66][A67][A69][A114] C %s start wins over forwarded cancellation and stream finish retains the true final result',
  async (mode) => {
    /** Three independent Hosts exercise the actual forwarding registration and C's executor. */
    const owners = [owner(), owner(), owner()] as const
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** C holds its actual business completion after its start point. */
    let signal: IRpcAbortSignal | undefined
    let effects = 0
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const capabilities = [
      ...RUNTIME_API_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.order,
      RpcCapability.group,
      RpcCapability.cancelBeforeStart,
      RpcCapability.outcome
    ]
    /** A terminal result must survive an intent that arrives after C really started. */
    let operation: Promise<unknown> | undefined
    /** Original physical-send observation is restored even when an assertion fails. */
    let restoreSend: (() => void) | undefined
    try {
      carriers.push(
        await attach(
          owners[1],
          owners[2],
          'c',
          'b',
          {},
          {
            provide: {
              service: {
                value: async (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
                  effects++
                  signal = context.signal
                  await held
                  assert.equal(
                    context.signal.aborted,
                    false,
                    '[A66] cancellation cannot abort running C business'
                  )
                  return 42
                },
                values: (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
                  effects++
                  signal = context.signal
                  return (async function* () {
                    await held
                    assert.equal(
                      context.signal.aborted,
                      false,
                      '[A66] cancellation cannot abort running C generator'
                    )
                    yield 1
                    yield 2
                    assert.equal(
                      context.signal.aborted,
                      false,
                      '[A67] discard must complete the same C generator'
                    )
                    return 42
                  })()
                }
              }
            }
          },
          runtimeSources(capabilities, capabilities)
        )
      )
      carriers.push(
        await attach(
          owners[0],
          owners[1],
          'b',
          'a',
          {},
          { expose: ['c'] },
          runtimeSources(capabilities, capabilities)
        )
      )
      const upstream = owners[0].thread as unknown as IRuntimeOutlet
      const downstream = owners[1].thread as unknown as IRuntimeOutlet
      const sender = readEndpointOwner<RpcOutboundSender>(
        readRuntimePeerConnection(readRuntimeOutletConnection(owners[1].thread, 'c')!.peer)
          .endpoint,
        'outbound-pipeline'
      )!
      const send = vi.spyOn(sender.transport, 'send')
      restoreSend = () => send.mockRestore()
      const cancel = new AbortController()
      const options = {
        orderKey: 'same',
        cancel: 'before-start' as const,
        idempotencyKey: 'started-forward',
        signal: cancel.signal
      }
      const iterator =
        mode === 'stream' ? upstream.stream('b', 'c.service.values', undefined, options) : undefined
      operation =
        mode === 'request'
          ? upstream.request('b', 'c.service.value', undefined, options)
          : mode === 'group'
            ? upstream.group('b', [{ method: 'c.service.value' }], options)
            : mode === 'notify'
              ? upstream.notify('b', 'c.service.value', undefined, options)
              : iterator!.next()
      void operation.catch(() => undefined)
      await vi.waitFor(() => assert.ok(signal))
      const forwarded = send.mock.calls
        .map((args) => readRuntimeCarrier(args[0])?.frame as IRpcRuntimeEnvelope | undefined)
        .find(
          (frame) =>
            (frame?.kind === 'runtime-call' || frame?.kind === 'runtime-group') &&
            frame.task.mode === mode
        )
      assert.deepEqual(
        forwarded?.route.forwardRoute,
        [await nodeOf(owners[0], 'b'), await nodeOf(owners[1], 'c')],
        '[A111] each new-profile mode retains the authenticated loop/hop route'
      )
      cancel.abort()
      assert.equal(signal!.aborted, false, '[A66] C owns the actual start decision')
      assert.equal((await upstream.outcome('b', 'started-forward')).state, 'pending')
      if (mode === 'notify') assert.equal(await operation, undefined)
      release()
      if (mode === 'request') assert.equal(await operation, 42)
      else if (mode === 'group')
        assert.deepEqual(await operation, [{ state: 'success', result: 42 }])
      else if (mode === 'stream') {
        assert.deepEqual(await operation, { done: false, value: 1 })
        assert.deepEqual(await iterator!.return!(), { done: true, value: 42 })
      }
      await vi.waitFor(async () =>
        assert.equal((await downstream.outcome('c', 'started-forward')).state, 'done')
      )
      assert.deepEqual(
        await upstream.outcome('b', 'started-forward'),
        await downstream.outcome('c', 'started-forward')
      )
      assert.equal(effects, 1)
      /**
       * Original stream scope is released after true terminal; scalar native signals stay
       * unchanged.
       */
      assert.equal(signal!.aborted, mode === 'stream')
    } finally {
      release()
      restoreSend?.()
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
      await operation?.catch(() => undefined)
    }
  }
)

it.each(['request', 'group', 'notify', 'stream'] as const)(
  '[A66][A69][A114] forwarded %s cancellation is decided at C and outcome reads only C',
  async (mode) => {
    /** Original slots and lifetime scopes exist on three independent Hosts. */
    const owners = [owner(), owner(), owner()] as const
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** The actual final provider owns this held key; B cannot mistake its own entry for final start. */
    let started = false
    let effects = 0
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const capabilities = [
      ...RUNTIME_API_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.order,
      RpcCapability.group,
      RpcCapability.cancelBeforeStart,
      RpcCapability.outcome
    ]
    let holding: Promise<unknown> | undefined
    let operation: Promise<unknown> | undefined
    try {
      carriers.push(
        await attach(
          owners[1],
          owners[2],
          'c',
          'b',
          {},
          {
            provide: {
              service: {
                hold: async () => {
                  started = true
                  await held
                  return 1
                },
                value: () => {
                  effects++
                  return 42
                },
                values: () => {
                  effects++
                  return (async function* () {
                    yield 1
                    return 42
                  })()
                }
              }
            }
          },
          runtimeSources(capabilities, capabilities)
        )
      )
      carriers.push(
        await attach(
          owners[0],
          owners[1],
          'b',
          'a',
          {},
          { expose: ['c'] },
          runtimeSources(capabilities, capabilities)
        )
      )
      const downstream = owners[1].thread as unknown as IRuntimeOutlet
      const upstream = owners[0].thread as unknown as IRuntimeOutlet
      holding = downstream.request('c', 'service.hold', undefined, { orderKey: 'same' })
      void holding.catch(() => undefined)
      await vi.waitFor(() => assert.equal(started, true))
      const cancel = new AbortController()
      const options = {
        orderKey: 'same',
        cancel: 'before-start' as const,
        idempotencyKey: 'forward-key',
        signal: cancel.signal
      }
      operation = (
        mode === 'request'
          ? upstream.request('b', 'c.service.value', undefined, options)
          : mode === 'group'
            ? upstream.group('b', [{ method: 'c.service.value' }], options)
            : mode === 'notify'
              ? upstream.notify('b', 'c.service.value', undefined, options)
              : upstream.stream('b', 'c.service.values', undefined, options).next()
      ).catch((error: unknown) => error)
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        readRuntimePeerConnection(readRuntimeOutletConnection(owners[2].thread, 'b')!.peer)
          .endpoint,
        'provider-admission'
      )!
      await vi.waitFor(() => assert.equal(admission.size, 2))
      const pending = await downstream.outcome('c', 'forward-key')
      assert.equal(pending.state, 'pending')
      assert.deepEqual(
        await upstream.outcome('b', 'forward-key'),
        pending,
        '[A69] B cannot substitute its own store or claim C work'
      )
      cancel.abort()
      await vi.waitFor(
        async () =>
          assert.equal(
            (await downstream.outcome('c', 'forward-key')).state,
            'done',
            '[A66] real C store observes final queued cancellation'
          ),
        { timeout: 1000 }
      )
      if (mode === 'notify') assert.equal(await operation, undefined)
      else assert.equal(Reflect.get((await operation) as object, 'code'), 'CANCELLED')
      await vi.waitFor(async () =>
        assert.equal((await downstream.outcome('c', 'forward-key')).state, 'done')
      )
      assert.deepEqual(
        await upstream.outcome('b', 'forward-key'),
        await downstream.outcome('c', 'forward-key')
      )
      assert.equal(effects, 0)
      release()
      assert.equal(await holding, 1)
    } finally {
      release()
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
      await holding?.catch(() => undefined)
      await operation
    }
  }
)

it('[A65][A114] the Host facade forwards one complete group and final provider refuses the whole group before any effect', async () => {
  /** Three real Hosts retain their original current slots, scopes and authenticated identity facts. */
  const owners = [owner(), owner(), owner()] as const
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Actual final business invocations expose any forbidden partial forwarding admission. */
  const effects: string[] = []
  /** New profile offers are explicit fixture inputs, independent of production default declarations. */
  const capabilities = [
    ...RUNTIME_API_CAPABILITIES,
    RpcCapability.generation,
    RpcCapability.order,
    RpcCapability.group,
    RpcCapability.cancelBeforeStart,
    RpcCapability.outcome
  ]
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          providerLimits: { maxGlobal: 1, maxPerPeer: 1 },
          provide: {
            service: {
              one: () => {
                effects.push('one')
                return 1
              },
              two: () => {
                effects.push('two')
                return 2
              }
            }
          }
        },
        runtimeSources(capabilities, capabilities)
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        { expose: ['c'] },
        runtimeSources(capabilities, capabilities)
      )
    )
    /** This is the actual Host facade; the temporary shape only permits the missing-port RED. */
    const outlet = owners[0].thread as unknown as IRuntimeOutlet
    assert.equal(
      typeof Reflect.get(outlet, 'group'),
      'function',
      '[A114] group belongs to the original target-selection facade'
    )
    const endpoint = readRuntimePeerConnection(
      readRuntimeOutletConnection(owners[1].thread, 'c')!.peer
    ).endpoint
    const sender = readEndpointOwner<RpcOutboundSender>(endpoint, 'outbound-pipeline')!
    const send = vi.spyOn(sender.transport, 'send')
    try {
      await assert.rejects(
        async () =>
          Reflect.get(outlet, 'group')('b', [
            { method: 'c.service.one' },
            { method: 'c.service.two' }
          ]),
        { code: 'OVERLOADED' },
        '[A114] C must reserve the whole group before executing its first step'
      )
      assert.deepEqual(effects, [])
      const groups = send.mock.calls
        .map(
          (args) =>
            readRuntimeCarrier(args[0])?.frame as { kind?: string; steps?: unknown } | undefined
        )
        .filter((frame) => frame?.kind === 'runtime-group')
      assert.equal(
        groups.length,
        1,
        '[A65] B sends one group rather than scalar calls or JSON-RPC batch'
      )
      assert.deepEqual(groups[0]!.steps, [{ method: 'service.one' }, { method: 'service.two' }])
    } finally {
      send.mockRestore()
    }
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

/** Read the original handshake's actual Host node, independently of an observed business route. */
async function nodeOf(host: ReturnType<typeof owner>, connection: string): Promise<string> {
  return readRuntimePeerConnection(readRuntimeOutletConnection(host.thread, connection)!.peer)
    .directory.localDescription.nodeId!
}

/** Genuine Hosts retain the canonical registration, availability and cleanup owners. */
function owner() {
  return runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

/** Join two actual Plugin registrations; no substitute dispatcher resolves business methods. */
async function attach(
  left: ReturnType<typeof owner>,
  right: ReturnType<typeof owner>,
  leftName: string,
  rightName: string,
  leftOptions: Partial<IRuntimeThreadPluginOptions> = {},
  rightOptions: Partial<IRuntimeThreadPluginOptions> = {},
  carrier = runtimeSources()
) {
  /** A rejected right-hand configuration must not strand the other source at its offer barrier. */
  let opposite: Promise<unknown> | undefined
  try {
    await right.use(
      createThreadPlugin({
        ...rightOptions,
        name: rightName,
        self: { name: rightName, instanceId: `${rightName}-caller` },
        connect: async (context) => {
          opposite = left.use(
            createThreadPlugin({
              ...leftOptions,
              name: leftName,
              self: { name: leftName, instanceId: `${leftName}-caller` },
              connect: carrier.sources[0],
              report: leftOptions.report ?? (() => undefined)
            })
          )
          return carrier.sources[1](context)
        },
        report: rightOptions.report ?? (() => undefined)
      })
    )
    await opposite
    return carrier
  } catch (error) {
    await opposite
    carrier.close()
    throw error
  }
}

it('[A104/A105] two forward Hosts preserve a notify-only terminal and await its completion', async () => {
  /** Four actual Hosts exercise two forward entries before the declared one-way provider. */
  const owners = [owner(), owner(), owner(), owner()] as const
  /** Original carriers remain alive until every Host has disposed its admitted work. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Terminal execution is observed independently of A ordinary physical-send completion. */
  const calls: unknown[] = []
  /** Actual forwarding failures are recorded through the original provider reporter. */
  const failures: any[] = []
  try {
    carriers.push(
      await attach(
        owners[2],
        owners[3],
        'd',
        'c',
        {},
        {
          contract: {
            schemaVersion: 1,
            plugin: 'service',
            features: { data: { methods: { tell: { mode: 'one-way', idempotent: false } } } }
          },
          provide: {
            service: {
              data: {
                tell: (value) => {
                  calls.push(value)
                }
              }
            }
          }
        }
      )
    )
    await owners[2].thread!.notify('d', 'service.data.tell', 'direct')
    await vi.waitFor(() => assert.deepEqual(calls, ['direct']))
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          expose: ['d.service.data.tell'],
          report: (error) => failures.push(error)
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        {
          expose: ['c.d.service.data.tell'],
          report: (error) => failures.push(error)
        }
      )
    )
    await owners[0].thread!.notify('b', 'c.d.service.data.tell', 'forwarded')
    await vi.waitFor(() => assert.deepEqual(calls, ['direct', 'forwarded']))
    assert.equal(failures.length, 0)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

for (const mode of ['tell', 'values'] as const) {
  it(`[A108] forwarded native ${mode} retires once without replay and a fresh call uses replacement`, async () => {
    /** A uses a real original carrier; B owns the actual supervised native Worker C. */
    const owners = [owner(), owner()] as const
    /** The original unit budget witnesses release of both native generations. */
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
    /** Native handles are the authoritative execution and exit receipts. */
    const launcher = createNodeThreadLauncher()
    /** Final cleanup includes every acquired generation even after a failed assertion. */
    const handles: INodeThreadHandle[] = []
    /** A-to-B ownership is independent of the supervisor's channel resources. */
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** Parent providers count actual old and new business entry, never send promises. */
    const calls = { old: 0, fresh: 0 }
    /** The real provider must enter before this test terminates its execution. */
    let enter!: () => void
    /** Original reverse RPC supplies a deterministic business-entry barrier. */
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    /** Notify failures are observed on B's canonical provider endpoint. */
    const failures: any[] = []
    /** The ordinary upstream stream owns its iterator and cleanup. */
    let iterator: AsyncIterableIterator<unknown> | undefined
    try {
      await owners[1].use(
        definePlugin({
          name: 'parent',
          features: {
            data: defineFeature(() => ({
              started: () => {
                calls.old += 1
                enter()
              },
              fresh: () => {
                calls.fresh += 1
              }
            }))
          },
          install: () => ({})
        })
      )
      await owners[1].use(
        createThreadPlugin({
          name: 'c',
          expose: ['parent'],
          report: () => undefined,
          spawn: {
            spec: {
              entry: fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url)),
              data: { lifecycleMode: mode }
            },
            budget,
            scheduler: systemScheduler,
            launcher: {
              ...launcher,
              launch: async (...args: Parameters<typeof launcher.launch>) => {
                const handle = await launcher.launch(...args)
                handles.push(handle)
                return handle
              }
            },
            channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
            supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
            report: () => undefined
          }
        })
      )
      carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c'] }))
      ;(
        readRuntimePeerEndpoint(readRuntimeOutletConnection(owners[1].thread, 'a')!.peer)
          .endpoint as unknown as IRpcEndpoint
      ).hooks.on((event) => {
        if (event.name === 'failure') failures.push(event.error)
      })
      /** Replacement identity must differ; the old logical execution must not enter it. */
      const first = readRuntimeOutletConnection(owners[1].thread, 'c')!.instanceId
      /** Catch is attached immediately so a real transport failure cannot become unhandled. */
      const pending =
        mode === 'tell'
          ? (await owners[0].thread!.notify('b', 'c.service.data.tell', 'hold'), undefined)
          : ((iterator = owners[0].thread!.stream('b', 'c.service.data.values', 'hold')),
            iterator.next().catch((error) => error))
      await entered
      handles[0]!.terminate()
      await handles[0]!.exited
      /** Notify has no upstream result; the original provider failure channel is its outcome. */
      if (mode === 'tell') await vi.waitFor(() => assert.ok(failures.length > 0))
      const failure = mode === 'tell' ? failures[0] : await pending
      assert.equal(failure.code, 'PROVIDER_GENERATION_RETIRED')
      assert.equal(failure.source, '@migaia/rpc/core')
      assert.ok(failure.cause instanceof Error, '[A108] native departure remains reachable')
      await vi.waitFor(
        () =>
          assert.notEqual(readRuntimeOutletConnection(owners[1].thread, 'c')!.instanceId, first),
        {
          timeout: 3000
        }
      )
      assert.equal(calls.old, 1, '[A108] retired work is never replayed')
      if (mode === 'tell') {
        await owners[0].thread!.notify('b', 'c.service.data.tell', 'replacement')
        await vi.waitFor(() => assert.equal(calls.fresh, 1))
      } else {
        const fresh = owners[0].thread!.stream('b', 'c.service.data.values', 'replacement')
        assert.deepEqual(await fresh.next(), { done: false, value: 'replacement' })
        await fresh.return!(undefined)
        assert.equal(calls.fresh, 1)
        assert.deepEqual(await iterator!.return!(undefined), { done: true, value: undefined })
      }
      assert.equal(handles.length, 2)
    } finally {
      await iterator?.return?.(undefined)
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map((handle) => handle.exited))
    }
    assert.equal(budget.inUse, 0)
  }, 15_000)
}

it('[A102/A104] one explicit connection method forwards through B with B as the direct caller', async () => {
  /** Three independent Hosts distinguish the original caller from the forwarding authority. */
  const owners = [owner(), owner(), owner()] as const
  /** Successful carriers remain owned by this fixture until all registrations close. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The final provider observes actual caller context and independently counted business work. */
  const calls: unknown[] = []
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            math: {
              add: (payload, context) => {
                calls.push(Reflect.get(context, 'senderId'))
                return payload
              },
              sub: () => {
                calls.push('sub')
                return 0
              }
            }
          }
        }
      )
    )
    assert.equal(await owners[1].thread!.request('c', 'math.add', 42), 42)
    calls.length = 0
    /** Preserve a pre-change installation rejection for the intended business RED assertion. */
    const installed = await attach(
      owners[0],
      owners[1],
      'b',
      'a',
      {},
      {
        expose: ['c.math.add']
      }
    ).then(
      (carrier) => {
        carriers.push(carrier)
        return true
      },
      (error: unknown) => error
    )
    assert.equal(
      installed,
      true,
      '[A102] explicit remote exposure configures the original connection'
    )
    assert.equal(await owners[0].thread!.request('b', 'c.math.add', 42), 42)
    assert.deepEqual(calls, ['c-caller'], '[A102] C authorizes its direct B peer, rather than A')
    await assert.rejects(
      Promise.resolve().then(() => owners[0].thread!.request('b', 'c.math.sub')),
      { code: 'PROVIDER_NOT_FOUND' }
    )
    assert.equal(calls.length, 1, '[A104] an unexposed remote method performs no business')
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A103] an unexposed connection never forwards to its business provider', async () => {
  /** The working B-to-C path is independent evidence that the final provider is available. */
  const owners = [owner(), owner(), owner()] as const
  /** Each acquired source closes after its original Host scope. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Count business execution, rather than treating a rejected Promise as sufficient proof. */
  let calls = 0
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: { math: { add: () => ++calls } }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a'))
    await assert.rejects(
      Promise.resolve().then(() => owners[0].thread!.request('b', 'c.math.add')),
      { code: 'PROVIDER_NOT_FOUND' }
    )
    assert.equal(calls, 0)
    assert.equal(await owners[1].thread!.request('c', 'math.add'), 1)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A105] the original upstream abort reaches C and its remaining deadline never restarts', async () => {
  /** Each provider belongs to its actual Host scope. */
  const owners = [owner(), owner(), owner()] as const
  /** Acquired connections close after business cancellation settles. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The final provider signals entry independently of the caller Promise. */
  let entered!: () => void
  /** Observe cancellation independently from the upstream rejection. */
  let canceled!: () => void
  /** No timer drives this fixture's synchronization. */
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  /** Resolve only when the original final-provider signal actually aborts. */
  const aborted = new Promise<void>((resolve) => {
    canceled = resolve
  })
  /** Record C's original deadline at actual provider entry. */
  let remaining: number | undefined
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            wait: (_payload, context) =>
              new Promise<void>((resolve) => {
                remaining = context.timeoutMs
                context.signal.addEventListener(
                  'abort',
                  () => {
                    canceled()
                    resolve()
                  },
                  { once: true }
                )
                entered()
              })
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.wait'] }))
    /** Cancellation must use the native signal rather than a forwarding-specific scope. */
    const controller = new AbortController()
    /** Attach rejection handling before abort can settle either original endpoint. */
    const result = owners[0]
      .thread!.request('b', 'c.wait', null, {
        signal: controller.signal,
        timeoutMs: 1000
      })
      .catch((error: unknown) => error)
    await started
    assert.ok(remaining !== undefined && remaining > 0 && remaining <= 1000)
    controller.abort()
    assert.equal(Reflect.get((await result) as object, 'code'), 'CANCELLED')
    await aborted
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A106] forwarded stream pulls remain lazy and early return reaches C exactly once', async () => {
  /** Actual stream owners retain both provider and caller lifetimes at every hop. */
  const owners = [owner(), owner(), owner()] as const
  /** Each original source remains live through the stream's return handshake. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Construction is independent from next credit, so unrequested pulls are detectable. */
  let constructed!: () => void
  /** Observe the genuine C iterator being installed, without a timing delay. */
  const ready = new Promise<void>((resolve) => {
    constructed = resolve
  })
  /** Count only final business pulls and cleanup. */
  let pulls = 0,
    returns = 0
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            values: () => {
              constructed()
              return {
                [Symbol.asyncIterator]() {
                  return this
                },
                async next() {
                  pulls += 1
                  return { done: false as const, value: pulls }
                },
                async return() {
                  returns += 1
                  return { done: true as const, value: undefined }
                }
              }
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.values'] }))
    /** The public stream operation is identical for a local method and a forwarded method. */
    const iterator = owners[0].thread!.stream('b', 'c.values')
    assert.equal(pulls, 0, '[A106] upstream absence of credit performs no final next')
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    await ready
    assert.equal(pulls, 1)
    await iterator.return!()
    assert.equal(returns, 1)
    assert.equal(pulls, 1)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A107/A116] C business identity, stack and cause cross both hops with forward metadata', async () => {
  /** Business errors originate only at the final genuine provider. */
  const owners = [owner(), owner(), owner()] as const
  /** Original sources preserve wire serialization and cleanup ownership. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Distinct native types and stacks distinguish the complete chain from a summary wrapper. */
  const cause = new TypeError('forward-fixture-cause')
  /** The source/code already belong to the public utils registry. */
  const original = attachErrorIdentity(new RangeError('forward-fixture-business', { cause }), {
    source: '@migaia/utils',
    code: 'INVALID_ARGUMENT'
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            fail: () => {
              throw original
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.fail'] }))
    /**
     * Preserve the top-level result for exact identity assertions instead of merely expecting
     * reject.
     */
    const failure = await owners[0].thread!.request('b', 'c.fail').catch((error: unknown) => error)
    assert.equal(Reflect.get(failure as object, 'source'), Reflect.get(original, 'source'))
    assert.equal(Reflect.get(failure as object, 'code'), Reflect.get(original, 'code'))
    assert.equal(Reflect.get(failure as object, 'stack'), original.stack)
    assert.equal(Reflect.get(Reflect.get(failure as object, 'cause'), 'stack'), cause.stack)
    assert.deepEqual(Reflect.get(failure as object, 'route'), [
      await nodeOf(owners[0], 'b'),
      await nodeOf(owners[1], 'a')
    ])
    assert.equal(
      readRuntimeOutletConnection(owners[0].thread, 'b')!.description!.methods.find(
        (method) => method.name === 'c.fail'
      )?.forwardedVia,
      'c'
    )
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A109] A forwarding through B back to the same Host is refused before final business', async () => {
  /** Two different physical connections still refer to the same two runtime Host identities. */
  const owners = [owner(), owner()] as const
  /** Each actual source retains original scope ownership. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The local terminal distinguishes refusal from a request that silently returned to its origin. */
  let calls = 0
  /** B's occupied provider lease distinguishes preflight from quota rejection. */
  let enter!: () => void, release!: () => void
  /** Observe actual entry without a delay. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** Keep the only B lease occupied while checking the loop. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[0],
        'back',
        'other',
        {},
        {
          provide: { echo: () => ++calls }
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        {
          expose: ['back.echo'],
          providerLimits: { maxGlobal: 1, maxPerPeer: 1 },
          provide: {
            hold: async () => {
              enter()
              await held
            }
          }
        }
      )
    )
    /** An unrelated admitted call occupies B before the loop is dispatched. */
    const occupied = owners[0].thread!.request('b', 'hold')
    await entered
    /** Counting the physical next-hop write distinguishes preflight refusal from a remote error. */
    const send = vi.spyOn(carriers[0]!.transports[0], 'send')
    /** Capture a success as well as a failure so the pre-change oracle fails for the right reason. */
    const result = await owners[0]
      .thread!.request('b', 'back.echo')
      .catch((error: unknown) => error)
    assert.equal(
      typeof result === 'object' && result !== null ? Reflect.get(result, 'code') : result,
      'FORWARD_LOOP'
    )
    assert.equal(calls, 0, '[A109] the rejected next hop never executes')
    assert.equal(send.mock.calls.length, 0, '[A109] the refused hop sends no frame')
    assert.deepEqual(Reflect.get(result as object, 'route'), [await nodeOf(owners[0], 'b')])
    release()
    await occupied
  } finally {
    release()
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it.each([3, 4])(
  '[A110] exactly three forwarding Hosts succeed; %i forwarding Hosts obey the fixed limit',
  async (hops) => {
    /** Each forwarding layer owns an independent Host and one real downstream slot. */
    const owners = Array.from({ length: hops + 2 }, () => owner())
    /** Backward construction makes every downstream directory available before compiling exposure. */
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** The logical method prefix grows once for each explicitly configured forward entry. */
    let method = 'echo'
    /** No rejected request may reach the final business provider. */
    let calls = 0
    /** A final context provides the actual ordered node route independently of caller-side metadata. */
    let route: unknown
    try {
      for (let index = owners.length - 2; index >= 0; index -= 1) {
        const terminal = index === owners.length - 2
        carriers.push(
          await attach(
            owners[index]!,
            owners[index + 1]!,
            'next',
            'upstream',
            {},
            terminal
              ? {
                  provide: {
                    echo: (_payload, context) => {
                      calls += 1
                      route = Reflect.get(context, 'route')
                      return 42
                    }
                  }
                }
              : { expose: [`next.${method}`] }
          )
        )
        if (!terminal) method = `next.${method}`
      }
      /** Only the final carrier follows the potentially refused fourth forward node. */
      const finalSend = vi.spyOn(carriers[0]!.transports[0], 'send')
      const result = await owners[0]!
        .thread!.request('next', method)
        .catch((error: unknown) => error)
      if (hops === 3) {
        assert.equal(result, 42)
        assert.equal(calls, 1)
        assert.ok(
          Array.isArray(route) && route.length === 4,
          '[A111] origin plus three forward nodes are ordered'
        )
        assert.equal(new Set(route).size, 4)
        assert.equal(Object.isFrozen(route), true)
        assert.deepEqual(
          route,
          await Promise.all(owners.slice(0, 4).map((host) => nodeOf(host, 'next')))
        )
      } else {
        assert.equal(
          typeof result === 'object' && result !== null ? Reflect.get(result, 'code') : result,
          'FORWARD_HOP_LIMIT'
        )
        assert.equal(calls, 0)
        assert.equal(finalSend.mock.calls.length, 0)
        assert.deepEqual(
          Reflect.get(result as object, 'route'),
          await Promise.all(owners.slice(0, 4).map((host) => nodeOf(host, 'next')))
        )
      }
    } finally {
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
    }
  }
)

it('[A109] A through B and C back to B is refused at C before its outbound send', async () => {
  /** Three Hosts exercise a repeated intermediate node, rather than only a repeated origin. */
  const owners = [owner(), owner(), owner()] as const
  /** Every connection still belongs to its actual Plugin scope. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The terminal is on B; reaching it would prove the repeated route was accepted. */
  let calls = 0
  try {
    carriers.push(
      await attach(
        owners[2],
        owners[1],
        'back',
        'other',
        {},
        {
          provide: { echo: () => ++calls }
        }
      )
    )
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'fromB',
        {},
        {
          expose: ['back.echo']
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'fromA',
        {},
        {
          expose: ['c.back.echo']
        }
      )
    )
    /** The rejected C-to-B hop cannot use transport completion as its refusal boundary. */
    const send = vi.spyOn(carriers[0]!.transports[0], 'send')
    const failure = await owners[0].thread!.request('b', 'c.back.echo').catch((error) => error)
    assert.equal(failure.code, 'FORWARD_LOOP')
    assert.deepEqual(failure.route, [await nodeOf(owners[0], 'b'), await nodeOf(owners[1], 'c')])
    assert.equal(send.mock.calls.length, 0)
    assert.equal(calls, 0)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A107] a forwarded iterator failure keeps C source, stack, cause and admitted route', async () => {
  /** All iterator work crosses the actual stream owners at both hops. */
  const owners = [owner(), owner(), owner()] as const
  /** Scope cleanup remains independent of a failed pull. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The final provider's native cause has its own independently recorded stack. */
  const cause = new TypeError('forward-stream-cause')
  /** Existing utils identity distinguishes business failure from B's stream controls. */
  const original = attachErrorIdentity(new RangeError('forward-stream-business', { cause }), {
    source: '@migaia/utils',
    code: 'INVALID_ARGUMENT'
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            fail: async function* () {
              throw original
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.fail'] }))
    const failure = await owners[0]
      .thread!.stream('b', 'c.fail')
      .next()
      .catch((error) => error)
    assert.equal(failure.source, Reflect.get(original, 'source'))
    assert.equal(failure.code, Reflect.get(original, 'code'))
    assert.equal(failure.stack, original.stack)
    assert.equal(failure.cause.stack, cause.stack)
    assert.deepEqual(failure.route, [await nodeOf(owners[0], 'b'), await nodeOf(owners[1], 'c')])
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A115] forwarded notify holds B admission until the actual C provider completes', async () => {
  /** B's provider limit is the resource under test; A's physical completion is independent. */
  const owners = [owner(), owner(), owner()] as const
  /** Both sources retain their ordinary provider and transport ownership. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Synchronization observes genuine C business entry and completion without timer delays. */
  let enter!: () => void, release!: () => void
  /** C signals only after receiving the forwarded notification. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** Actual provider work remains pending until the test explicitly completes it. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** This independent method proves the next admitted request really executes after release. */
  let calls = 0
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            hold: async () => {
              enter()
              await held
            },
            echo: () => ++calls
          }
        }
      )
    )
    carriers.push(
      await attach(
        owners[0],
        owners[1],
        'b',
        'a',
        {},
        {
          expose: ['c.hold', 'c.echo'],
          providerLimits: { maxGlobal: 1, maxPerPeer: 1 }
        }
      )
    )
    await owners[0].thread!.notify('b', 'c.hold')
    await entered
    await assert.rejects(owners[0].thread!.request('b', 'c.echo'), { code: 'OVERLOADED' })
    assert.equal(calls, 0)
    release()
    await vi.waitFor(async () => assert.equal(await owners[0].thread!.request('b', 'c.echo'), 1))
    assert.equal(calls, 1)
  } finally {
    release()
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A108] a forwarded native call retires once and a fresh call uses C replacement', async () => {
  /** A-to-B uses an ordinary source while B owns a genuine supervised Worker connection. */
  const owners = [owner(), owner()] as const
  /** Cleanup covers A-to-B independently of the native execution budget. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The real unit budget must return to zero after all native generations close. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** Native handles provide authoritative termination and exit observations. */
  const launcher = createNodeThreadLauncher()
  /** Every acquired Worker remains in the test's final cleanup set. */
  const handles: INodeThreadHandle[] = []
  /** A forwarded execution must never enter a caller-supplied retry implementation. */
  let retryCalls = 0
  /** The final provider uses the existing parent reverse route to signal actual execution. */
  let enter!: () => void
  /** No process is terminated before the business provider has definitely started. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  try {
    await owners[1].use(
      definePlugin({
        name: 'parent',
        features: { data: defineFeature(() => ({ echo: () => 42, started: () => enter() })) },
        install: () => ({})
      })
    )
    await owners[1].use(
      createThreadPlugin({
        name: 'c',
        expose: ['parent'],
        report: () => undefined,
        retryPort: {
          dispatch: async (input) => {
            retryCalls += 1
            return input.sendOnce({
              expectedGeneration: input.generation,
              key: input.key,
              remainingMs: input.timeoutMs
            })
          }
        },
        spawn: {
          spec: {
            entry: fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url)),
            data: { advanced: true, crash: true }
          },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (...args: Parameters<typeof launcher.launch>) => {
              const handle = await launcher.launch(
                {
                  ...args[0],
                  data: { ...(args[0].data as object), sequence: handles.length + 1 }
                },
                args[1]
              )
              handles.push(handle)
              return handle
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
          report: () => undefined
        }
      })
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c'] }))
    /** The first success independently establishes the final native business path. */
    const first = readRuntimeOutletConnection(owners[1].thread, 'c')!.instanceId
    assert.equal(
      await owners[0].thread!.request('b', 'c.service.data.read', 'ordinary'),
      'ordinary'
    )
    const pending = owners[0]
      .thread!.request('b', 'c.service.data.read', 'retry', { timeoutMs: 3000 })
      .catch((error) => error)
    await entered
    await handles[0]!.exited
    const failure = await pending
    assert.equal(failure.code, 'PROVIDER_GENERATION_RETIRED')
    assert.equal(failure.source, '@migaia/rpc/core')
    assert.equal(retryCalls, 0, '[A108] an idempotent forward never enters custom retry')
    /** The next logical call may target the genuine replacement; the old call cannot replay. */
    await vi.waitFor(
      async () => {
        assert.equal(
          await owners[0].thread!.request('b', 'c.service.data.read', 'replacement'),
          'replacement'
        )
        assert.notEqual(readRuntimeOutletConnection(owners[1].thread, 'c')!.instanceId, first)
      },
      { timeout: 3000 }
    )
    assert.equal(handles.length, 2)
    assert.equal(retryCalls, 0)
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
}, 15_000)

it('[A115] unUse withdraws the forward slot and a same-name connection restores new calls', async () => {
  /** A-to-B retains its compiled method table while B replaces only the downstream connection. */
  const owners = [owner(), owner(), owner()] as const
  /** Each real source closes after its original registration scope. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** The original and replacement final providers have separate execution counts. */
  const calls = [0, 0]
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            echo: () => {
              calls[0]! += 1
              return 'old'
            }
          }
        }
      )
    )
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.echo'] }))
    assert.equal(await owners[0].thread!.request('b', 'c.echo'), 'old')
    await owners[1].unUse('c')
    await assert.rejects(owners[0].thread!.request('b', 'c.echo'), (error) => {
      assert.equal((error as any).source, '@migaia/rpc/core')
      assert.equal((error as any).code, 'TARGET_UNKNOWN')
      assert.equal((error as any).cause.code, 'PLUGIN_NOT_INSTALLED')
      return true
    })
    assert.deepEqual(calls, [1, 0])
    await owners[2].unUse('b')
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            echo: () => {
              calls[1]! += 1
              return 'replacement'
            }
          }
        }
      )
    )
    assert.equal(await owners[0].thread!.request('b', 'c.echo'), 'replacement')
    assert.deepEqual(calls, [1, 1])
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it('[A115] closing B cancels its actual downstream provider before scope release completes', async () => {
  /** C observes the original provider signal independently of the upstream Promise. */
  const owners = [owner(), owner(), owner()] as const
  /** Keep both actual physical sources live until all scope cleanup completes. */
  const carriers: ReturnType<typeof runtimeSources>[] = []
  /** Provider entry and abort observation require no timer or synthetic completion. */
  let enter!: () => void, cancel!: () => void
  /** Only real C business entry allows this fixture to request B closure. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** The original C abort signal must settle this observation before B closes. */
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve
  })
  try {
    carriers.push(
      await attach(
        owners[1],
        owners[2],
        'c',
        'b',
        {},
        {
          provide: {
            hold: (_payload, context) =>
              new Promise<void>((resolve) => {
                context.signal.addEventListener(
                  'abort',
                  () => {
                    cancel()
                    resolve()
                  },
                  { once: true }
                )
                enter()
              })
          }
        }
      )
    )
    /** This source owns physical close, so the remote caller observes the native transport failure. */
    const carrier = runtimeSources()
    const closing = {
      ...carrier,
      sources: [
        carrier.sources[0],
        async (context: Parameters<(typeof carrier.sources)[1]>[0]) => ({
          ...(await carrier.sources[1](context)),
          close: async () => {
            carrier.close()
            return undefined
          }
        })
      ] as const
    }
    carriers.push(await attach(owners[0], owners[1], 'b', 'a', {}, { expose: ['c.hold'] }, closing))
    const pending = owners[0]
      .thread!.request('b', 'c.hold', null, { timeoutMs: 3000 })
      .catch((error) => error)
    await entered
    await owners[1].dispose()
    await cancelled
    const failure = await pending
    assert.equal(failure.source, '@migaia/rpc/core')
    assert.equal(failure.code, 'TRANSPORT')
  } finally {
    for (const host of owners) await host.dispose()
    for (const carrier of carriers) carrier.close()
  }
})

it.each(['process', 'thread'] as const)(
  '[A111/A113] %s forwarding keeps one inbound normalization, native encoding and two signatures',
  async (kind) => {
    /** The original Host and Plugin owners execute both authenticated hops. */
    const owners = [owner(), owner(), owner()] as const
    /** Raw carrier ownership is unchanged by counters around canonical codec methods. */
    const carriers: ReturnType<typeof runtimeSources>[] = []
    /** Only this exact fixture object marks business payloads in the normalization counter. */
    const marker = 'a113-forward-payload'
    /** Observing the existing export changes no normalization behavior. */
    const normalize = vi.spyOn(portable, 'normalizePortable')
    /** Only whole business request JSON, excluding auth wrappers, counts as process encoding. */
    const stringify = vi.spyOn(JSON, 'stringify')
    /** The true provider count distinguishes authentication refusal from replay admission. */
    let calls = 0
    /** Real authentication callbacks expose success and signature failures independently. */
    const signs = [0, 0],
      verifies = [0, 0]
    /** Reports are bounded to this fixture and contain no key or payload snapshot. */
    const failures: unknown[] = []
    /** Enable business counters only after both actual directories are ready. */
    let counting = false
    /** A final signed outbound frame is retained only for the requested tamper discriminator. */
    let signedFrame: unknown
    /** Codec decode and encode bracket the exact B forwarding interval. */
    let incomingAt = 0,
      forwardedNormalizations = -1
    /** Identity carrier must pass B's admitted payload reference directly into its physical send. */
    let admitted: unknown, outbound: unknown
    /** Each connection has a distinct public fixture key, proving independent hop authentication. */
    const signature = (hop: number, value: unknown) =>
      createHmac('sha256', `a113-public-key-${hop}`).update(JSON.stringify(value)).digest('hex')
    /** Decode observation reads the actual protected semantic envelope without acting as a receiver. */
    const semantic = (value: unknown): any => {
      const bound = readAuthenticationEnvelope(value)
      return typeof bound.payload === 'string' ? JSON.parse(bound.payload) : bound.payload
    }
    /**
     * Custom factories select the existing Runtime API preset and its original authentication
     * owner.
     */
    const factory =
      (id: string, hop: number, side: number) =>
      async (channel: IRemoteChannel): Promise<IRemoteServeEndpoint> => {
        const endpoint = await createRuntimeApiEndpoint(
          {
            id,
            scheduler: channel.scheduler,
            targetIds: [channel.peerId],
            transport: channel.transport,
            middlewares: [
              codec(channel.pipeline.codec),
              framer(channel.pipeline.framer),
              connect({ transport: channel.transport }),
              abort(),
              timeout(),
              ping(),
              hooks(),
              authentication({
                sign(value) {
                  const request = semantic(value)
                  if (counting && side === 0 && request.kind === 'request') signs[hop]! += 1
                  const frame = { value, signature: signature(hop, value) }
                  const encoded = kind === 'process' ? JSON.stringify(frame) : frame
                  if (counting && hop === 1 && side === 0 && request.method === 'echo')
                    signedFrame = encoded
                  return encoded
                },
                verify(value) {
                  const frame = (typeof value === 'string' ? JSON.parse(value) : value) as {
                    value: unknown
                    signature: string
                  }
                  assert.equal(
                    frame.signature,
                    signature(hop, frame.value),
                    '[A111] signed route cannot be changed'
                  )
                  const request = semantic(frame.value)
                  if (counting && side === 1 && request.kind === 'request') verifies[hop]! += 1
                  return frame.value
                }
              })
            ]
          },
          { supports: () => true },
          true
        )
        const original = endpoint as unknown as IRpcEndpoint
        original.hooks.on((event) => {
          if (event.name === 'failure') failures.push(event.error)
        })
        return { endpoint: original, oneWay: endpoint, stream: endpoint.stream }
      }
    /** Counter wrappers delegate exact registered codecs; they add no normalization or encoding. */
    const sourcePair = (hop: number) => {
      const carrier = runtimeSources()
      const pipeline = kind === 'process' ? byteProcessPipeline : messageProcessPipeline
      const sources = carrier.sources.map(
        (source, side) => async (context: Parameters<typeof source>[0]) => {
          const channel = await source(context)
          const codec = {
            ...pipeline.codec,
            encode(value: unknown) {
              if (counting && hop === 1 && side === 0 && (value as any).method === 'echo') {
                outbound = (value as any).data.payload
                const entries = normalize.mock.calls
                  .slice(incomingAt)
                  .filter(([input]) => (input as any)?.marker === marker)
                forwardedNormalizations = entries.length - 1
                admitted =
                  normalize.mock.results[
                    incomingAt +
                      normalize.mock.calls
                        .slice(incomingAt)
                        .findIndex(([input]) => (input as any)?.marker === marker)
                  ]?.value
              }
              return pipeline.codec.encode(value)
            },
            decode(value: unknown) {
              const decoded = pipeline.codec.decode(value)
              if (counting && hop === 0 && side === 1 && (decoded as any).kind === 'request')
                incomingAt = normalize.mock.calls.length
              return decoded
            }
          }
          registerFastCodec(codec)
          return {
            ...channel,
            pipeline: { codec, framer: pipeline.framer },
            agreement: { ...channel.agreement, codec: codec.id }
          }
        }
      ) as unknown as ReturnType<typeof runtimeSources>['sources']
      return { ...carrier, sources }
    }
    try {
      carriers.push(
        await attach(
          owners[1],
          owners[2],
          'c',
          'b',
          {
            endpointFactory: factory('c-caller', 1, 0)
          },
          {
            endpointFactory: factory('b-caller', 1, 1),
            provide: { echo: () => ++calls }
          },
          sourcePair(1)
        )
      )
      carriers.push(
        await attach(
          owners[0],
          owners[1],
          'b',
          'a',
          {
            endpointFactory: factory('b-caller', 0, 0)
          },
          {
            endpointFactory: factory('a-caller', 0, 1),
            expose: ['c.echo']
          },
          sourcePair(0)
        )
      )
      normalize.mockClear()
      stringify.mockClear()
      counting = true
      assert.equal(await owners[0].thread!.request('b', 'c.echo', { marker }), 1)
      assert.equal(
        forwardedNormalizations,
        0,
        '[A113] B adds no normalization after inbound admission'
      )
      assert.equal(
        outbound,
        admitted,
        '[A113] B outbound uses its original admitted payload reference'
      )
      assert.equal(
        stringify.mock.calls.filter(
          ([value]) => (value as any)?.kind === 'request' && (value as any)?.method === 'echo'
        ).length,
        kind === 'process' ? 1 : 0,
        '[A113] only the process codec encodes the whole forwarded request'
      )
      assert.deepEqual(signs, [1, 1])
      assert.deepEqual(verifies, [1, 1])
      assert.equal(failures.length, 0)
      /**
       * Delete a signed node while retaining the old signature; cryptographic verification must
       * fail.
       */
      const frame = (typeof signedFrame === 'string' ? JSON.parse(signedFrame) : signedFrame) as {
        value: unknown
        signature: string
      }
      const bound = readAuthenticationEnvelope(frame.value)
      const request = structuredClone(semantic(frame.value))
      request.data.route.forwardRoute.pop()
      const changed = wrapAuthenticationEnvelope(
        kind === 'process' ? JSON.stringify(request) : request,
        bound.nonce,
        BigInt(bound.counter)
      )
      const tampered = { value: changed, signature: frame.signature }
      carriers[0]!.transports[0].send(kind === 'process' ? JSON.stringify(tampered) : tampered)
      await vi.waitFor(() =>
        assert.equal(
          failures.filter((error) => (error as any)?.code === 'AUTHENTICATION_FAILED').length,
          1
        )
      )
      assert.equal(calls, 1, '[A111] changed route is rejected before the final provider')
      assert.deepEqual(
        verifies,
        [1, 1],
        '[A111] the changed signature never reaches replay admission'
      )
    } finally {
      counting = false
      for (const host of owners) await host.dispose()
      for (const carrier of carriers) carrier.close()
      vi.restoreAllMocks()
    }
  }
)
