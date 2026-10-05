import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { createProcessPeer, createProcessPlugin } from '../../src/process/index.js'
import { createThreadPeer, createThreadPlugin } from '../../src/threads/index.js'
import type { IRpcContext } from '../../src/core/typing.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  type IRuntimePeerSourceContext
} from '../../src/remote/runtime-api/peer.js'
import { RUNTIME_API_CAPABILITIES } from '../../src/remote/runtime-api/constants.js'
import { connected, runtimeSources, RuntimeApiFixtureText } from './fixture.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'

/** Capture only real timer registration; the original host clock and callbacks still execute. */
async function timeoutPair(defaultTimeoutMs?: number) {
  /** Both real source offers independently negotiate the original endpoint's actual capabilities. */
  const channel = runtimeSources(RUNTIME_API_CAPABILITIES, RUNTIME_API_CAPABILITIES)
  /** The caller's real scheduler observations exclude remote timers and bootstrap preparation. */
  const delays: number[] = []
  /** Actual business contexts expose whether a default before-start timer aborts a started handler. */
  const signals: IRpcContext['signal'][] = []
  const source = async (context: IRuntimePeerSourceContext) => ({
    ...(await channel.sources[0](context)),
    scheduler: {
      now: () => systemScheduler.now(),
      schedule: (callback: () => void, delay: number) => {
        delays.push(delay)
        return systemScheduler.schedule(callback, delay)
      }
    }
  })
  /** A plain configuration preserves an actual runtime RED before the new option is declared. */
  const options = {
    self: { name: 'timeout-caller', instanceId: 'timeout-caller' },
    connect: source,
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
    report: () => undefined
  }
  const peers = await Promise.all([
    createRuntimePeer(options),
    createRuntimePeer({
      self: { name: 'timeout-provider', instanceId: 'timeout-provider' },
      connect: channel.sources[1],
      provide: {
        echo: (payload: unknown) => payload,
        delayed: async (payload: unknown, context: IRpcContext) => {
          signals.push(context.signal)
          await new Promise<void>((resolve) => systemScheduler.schedule(resolve, Number(payload)))
          return 7
        },
        delayedValues: async function* (payload: unknown, context: IRpcContext) {
          signals.push(context.signal)
          await new Promise<void>((resolve) => systemScheduler.schedule(resolve, Number(payload)))
          yield 7
        },
        values: async function* () {
          yield 1
          yield 2
        }
      },
      report: () => undefined
    })
  ])
  delays.length = 0
  return {
    peer: peers[0],
    delays,
    signals,
    close: async () => {
      await Promise.all(peers.map((peer) => peer.close()))
      channel.close()
    }
  }
}

it.each([
  [undefined, 30_000],
  [1_600, 1_600],
  [80, 80]
] as const)(
  '[A79] request uses factory default %s in the original timeout scope',
  async (configured, expected) => {
    const fixture = await timeoutPair(configured)
    try {
      assert.equal(await fixture.peer.request('echo', 7), 7)
      assert.ok(
        fixture.delays.some((delay) => delay > expected * 0.9 && delay <= expected),
        `[A79] expected original deadline ${expected}; observed ${fixture.delays}`
      )
    } finally {
      await fixture.close()
    }
  }
)

it('[A79] explicit per-call deadline and false override stay in the original request and stream scope', async () => {
  const fixture = await timeoutPair(80)
  try {
    await assert.rejects(fixture.peer.request('delayed', 120), {
      code: RpcCoreErrorCode.deadlineExceeded
    })
    assert.equal(await fixture.peer.request('delayed', 120, { timeoutMs: false }), 7)
    assert.equal(await fixture.peer.request('delayed', 120, { timeoutMs: 300 }), 7)
    await assert.rejects(fixture.peer.request('delayed', 120, { timeoutMs: 40 }), {
      code: RpcCoreErrorCode.deadlineExceeded
    })
    const expired = fixture.peer.stream('delayedValues', 120)
    await assert.rejects(expired.next(), { code: RpcCoreErrorCode.deadlineExceeded })
    const unbounded = fixture.peer.stream('delayedValues', 120, { timeoutMs: false })
    assert.deepEqual(await unbounded.next(), { done: false, value: 7 })
    await unbounded.return!(undefined)
    await fixture.peer.notify('echo', 1, { timeoutMs: false })
  } finally {
    await fixture.close()
  }
})

it.each(['request', 'stream'] as const)(
  '[A80] default deadline cannot discard a %s whose before-start permission already won',
  async (mode) => {
    const fixture = await timeoutPair(80)
    try {
      const options = { cancel: 'before-start' as const }
      if (mode === 'request') assert.equal(await fixture.peer.request('delayed', 160, options), 7)
      else {
        const stream = fixture.peer.stream('delayedValues', 160, options)
        assert.deepEqual(await stream.next(), { done: false, value: 7 })
        assert.equal(fixture.signals[0]!.aborted, false)
        await stream.return!(undefined)
      }
      if (mode === 'request') assert.equal(fixture.signals[0]!.aborted, false)
    } finally {
      await fixture.close()
    }
  }
)

it('[A80] queued default expiry never starts the final provider', async () => {
  const fixture = await timeoutPair(80)
  const holding = fixture.peer.request('delayed', 160, { orderKey: 'same', timeoutMs: false })
  try {
    await vi.waitFor(() => assert.equal(fixture.signals.length, 1), { interval: 5 })
    await assert.rejects(
      fixture.peer.request('delayed', 1, { orderKey: 'same', cancel: 'before-start' }),
      { code: RpcCoreErrorCode.deadlineExceeded }
    )
    assert.equal(fixture.signals.length, 1, '[A80] expiry before final start leaves provider0')
    assert.equal(await holding, 7)
  } finally {
    await holding.catch(() => undefined)
    await fixture.close()
  }
})

it('[A79][A74] a default ordered deadline requires the real bilateral capability while false remains valid', async () => {
  /** Explicit missing deadline is preserved instead of silently completing the peer's offer. */
  const capabilities = RUNTIME_API_CAPABILITIES.filter((value) => value !== RpcCapability.deadline)
  let effects = 0
  const fixture = await connected({}, { echo: () => ++effects }, capabilities, capabilities)
  const send = vi.spyOn(readRuntimePeerConnection(fixture.peers[0]).channel.transport, 'send')
  try {
    await assert.rejects(fixture.peers[0].request('echo', undefined, { orderKey: 'same' }), {
      code: RpcCoreErrorCode.capabilityUnsupported
    })
    assert.equal(send.mock.calls.length, 0)
    assert.equal(effects, 0)
    assert.equal(
      await fixture.peers[0].request('echo', undefined, { orderKey: 'same', timeoutMs: false }),
      1
    )
  } finally {
    send.mockRestore()
    await fixture.close()
  }
})

it.each([
  ['process-peer', createProcessPeer],
  ['thread-peer', createThreadPeer],
  ['process-plugin', createProcessPlugin],
  ['thread-plugin', createThreadPlugin]
] as const)(
  '[A79] %s rejects an invalid default before source acquisition',
  async (_name, factory) => {
    /** All four public entries use the same real source acquisition boundary. */
    let opens = 0
    const options = {
      name: 'invalid-default',
      defaultTimeoutMs: 0,
      connect: async () => {
        opens++
        throw new RangeError(RuntimeApiFixtureText.businessRange)
      },
      report: () => undefined
    }
    await assert.rejects(
      Promise.resolve().then(() => Reflect.apply(factory, undefined, [options])),
      {
        code: RpcCoreErrorCode.invalidConfig
      }
    )
    assert.equal(opens, 0)
  }
)

it('[A79][A80] stream starts one total factory deadline at first next, while notify and group have no implicit deadline', async () => {
  const fixture = await timeoutPair(80)
  try {
    const stream = fixture.peer.stream('values')
    assert.deepEqual(fixture.delays, [], '[A80] constructing a lazy iterator starts no timer')
    assert.deepEqual(await stream.next(), { value: 1, done: false })
    assert.equal(fixture.delays.filter((delay) => delay > 72 && delay <= 80).length, 1)
    assert.deepEqual(await stream.next(), { value: 2, done: false })
    assert.equal(fixture.delays.filter((delay) => delay > 72 && delay <= 80).length, 1)
    await stream.return!(undefined)
    fixture.delays.length = 0
    await fixture.peer.notify('echo', 8)
    await fixture.peer.group([{ method: 'echo', payload: 9 }])
    assert.equal(
      fixture.delays.some((delay) => delay > 72 && delay <= 80),
      false
    )
  } finally {
    await fixture.close()
  }
})

it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN, false, '30000', null])(
  '[A79] invalid factory default %s rejects before opening the source',
  async (defaultTimeoutMs) => {
    /** Source invocation is a real construction side effect, never a fake provider counter. */
    let opened = 0
    const options = {
      defaultTimeoutMs,
      self: { name: 'invalid-timeout', instanceId: 'invalid-timeout' },
      connect: async () => {
        opened++
        throw new RangeError(RuntimeApiFixtureText.businessRange)
      },
      report: () => undefined
    }
    /** Invalid JS input is deliberately outside the future public number-only declaration. */
    const failure: unknown = await Reflect.apply(createRuntimePeer, undefined, [options]).then(
      () => undefined,
      (error: unknown) => error
    )
    assert.equal(opened, 0, '[A79] invalid defaults cannot acquire a channel')
    assert.equal(Reflect.get(failure as object, 'code'), RpcCoreErrorCode.invalidConfig)
  }
)
