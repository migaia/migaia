import assert from 'node:assert/strict'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGenerationController } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { createEndpoint } from '../../src/core/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { OperationScope } from '../../src/core/internal/operation-scope.js'
import { RpcVariationCoordinator } from '../../src/core/internal/variation-coordinator.js'
import { messageFramerV1 } from '../../src/contract/framing/message-framer.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import type { IRpcContext } from '../../src/core/typing.js'

/** Counts genuine native instances while preserving native signal and reason behavior. */
function countControllers(): () => number {
  /** The original native constructor remains the parent of every observed instance. */
  const NativeController = globalThis.AbortController
  /** Only allocations during the concrete operation under observation are counted. */
  let count = 0
  vi.stubGlobal(
    'AbortController',
    class extends NativeController {
      constructor() {
        super()
        count++
      }
    }
  )
  return () => count
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('P2-F private qualification and canonical ownership', () => {
  it('[A16] unread scope cancellation allocates only on late read and preserves the first reason', () => {
    /** Prepare parents outside the controller observation. */
    const firstParent = new AbortController()
    const secondParent = new AbortController()
    /** Baseline ignores the fifth private argument, so its red is an allocation assertion. */
    const allocations = countControllers()
    /** Existing constructor remains executable before lazy implementation exists. */
    const local = Reflect.construct(OperationScope, [
      1,
      1000,
      firstParent.signal,
      () => 0,
      true
    ]) as OperationScope
    /** Native error identity must survive cancellation before materialization. */
    const first = new RangeError('local fixture reason')
    local.abort(first)
    assert.equal(allocations(), 0, '[A16] unread private scope must not construct a controller')
    firstParent.abort(new RangeError('later fixture parent'))
    assert.equal(local.signal.reason, first)
    assert.equal(local.signal.aborted, true)
    assert.equal(local.signal, local.signal)
    /** Conversely the parent reason wins when it precedes local cancellation. */
    const parentReason = new RangeError('parent fixture reason')
    const inherited = Reflect.construct(OperationScope, [
      1,
      1000,
      secondParent.signal,
      () => 0,
      true
    ]) as OperationScope
    secondParent.abort(parentReason)
    inherited.abort(new RangeError('later fixture local'))
    assert.equal(inherited.signal.reason, parentReason)
  })

  it('[A16] public generation stays eager with the original native reason identity', () => {
    /** Public lifecycle behavior is the negative control for RPC-only laziness. */
    const allocations = countControllers()
    /** This public owner must continue allocating during begin. */
    const controller = createGenerationController()
    /** Token and native signal are both returned by the canonical owner. */
    const request = controller.begin()
    assert.equal(allocations(), 1)
    /** Cancelling preserves the exact original native error instance. */
    const reason = new RangeError('public generation fixture')
    controller.supersede(reason)
    assert.equal(request.signal.reason, reason)
    assert.equal(request.signal.aborted, true)
    assert.equal(request.signal, request.signal)
    controller.dispose()
  })

  it('[A16] endpoint-derived deadlines share registration and release the final native task', () => {
    /** Only this derived receiver owns the logical registrations. */
    const scheduler = Object.create(systemScheduler) as typeof systemScheduler
    /** Observe native registration rather than logical task count. */
    const registrations = vi.spyOn(globalThis, 'setTimeout')
    /** Cancellation must release the sole native registration exactly once. */
    const releases = vi.spyOn(globalThis, 'clearTimeout')
    /** Two real logical handles remain independently cancellable. */
    const first = scheduler.schedule(() => undefined, 1000)
    /** A later deadline must reuse the already armed earlier callback. */
    const second = scheduler.schedule(() => undefined, 1000)
    try {
      assert.equal(
        registrations.mock.calls.length,
        1,
        '[A16] native deadline registration must be shared'
      )
    } finally {
      first.cancel()
      second.cancel()
    }
    assert.equal(releases.mock.calls.length, 1)
  })

  it('[A16] both native and shared same-due callbacks retain a microtask cancellation checkpoint', async () => {
    for (const scheduler of [
      systemScheduler,
      Object.create(systemScheduler) as typeof systemScheduler
    ]) {
      /** Registration order and the Promise checkpoint are observable cancellation semantics. */
      const events: string[] = []
      /** The first callback's reaction cancels this later task. */
      let second: ReturnType<typeof scheduler.schedule>
      scheduler.schedule(() => {
        events.push('first')
        void Promise.resolve().then(() => {
          events.push('microtask')
          second.cancel()
        })
      }, 0)
      second = scheduler.schedule(() => events.push('second'), 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 15))
      assert.deepEqual(events, ['first', 'microtask'])
    }
  })

  it('[A16] shared native liveness follows all logical unref and restores ref for new work', () => {
    /** Real host handles expose these methods; their exact receiver semantics remain native. */
    const native = { ref: vi.fn(), unref: vi.fn() }
    /** Preserve the native registration boundary while making liveness observable. */
    const register = vi.fn(() => native)
    vi.stubGlobal('setTimeout', register)
    vi.stubGlobal('clearTimeout', vi.fn())
    /** A distinct receiver limits sharing to this endpoint. */
    const scheduler = Object.create(systemScheduler) as typeof systemScheduler
    /** Individual unref cannot let another referenced logical task disappear. */
    const first = scheduler.schedule(() => undefined, 1000)
    /** The second deadline keeps the native task referenced until its own unref. */
    const second = scheduler.schedule(() => undefined, 1000)
    first.unref?.()
    assert.equal(
      native.unref.mock.calls.length,
      0,
      '[A16] one unref cannot release another referenced deadline'
    )
    second.unref?.()
    assert.equal(native.unref.mock.calls.length, 1)
    /** New referenced work restores the same native timer. */
    const third = scheduler.schedule(() => undefined, 1000)
    assert.equal(native.ref.mock.calls.length, 1)
    assert.equal(register.mock.calls.length, 1)
    third.cancel()
    assert.equal(native.unref.mock.calls.length, 2)
    first.cancel()
    second.cancel()
  })

  it('[A16] real canonical requests in both directions omit unread caller and provider signals', async () => {
    const [leftTransport, rightTransport] = createMemoryTransportPair()
    /** Both endpoints independently use their actual canonical request and provider owners. */
    const left = await createEndpoint({
      id: 'a',
      targetIds: ['b'],
      transport: leftTransport,
      middlewares: [connect(), abort()],
      provider: { echo: (context) => context.success(context.data) }
    })
    /** The second endpoint is also a real initiator, rather than a fake dispatch fixture. */
    const right = await createEndpoint({
      id: 'b',
      targetIds: ['a'],
      transport: rightTransport,
      middlewares: [connect(), abort()],
      provider: { echo: (context) => context.success(context.data) }
    })
    try {
      await left.send('b', 'echo', 'warm')
      await right.send('a', 'echo', 'warm')
      /** Warmup precedes observation so endpoint construction is not confused with scope allocation. */
      const allocations = countControllers()
      assert.equal(await left.send('b', 'echo', 'left'), 'left')
      assert.equal(await right.send('a', 'echo', 'right'), 'right')
      assert.equal(
        allocations(),
        0,
        '[A16] unread bidirectional requests must allocate no native scopes'
      )
    } finally {
      vi.unstubAllGlobals()
      await left.dispose()
      await right.dispose()
    }
  })

  it('[A16] real cancellation expires an unread provider while late signal keeps the routed reason', async () => {
    const [leftTransport, rightTransport] = createMemoryTransportPair()
    /** Retain the real provider context without accessing its signal during execution. */
    let retained: IRpcContext | undefined
    /** Readiness avoids estimating whether the provider was actually entered. */
    let enter: () => void = () => undefined
    /** Own the held provider's final settlement for deterministic cleanup. */
    let finish: () => void = () => undefined
    /** Enter is signalled only by the actual provider callback. */
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    /** Cancellation is observed while the provider remains genuinely active. */
    const hold = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** External caller signal exists before constructor observation. */
    const caller = new AbortController()
    /** Real caller owns abort routing. */
    const left = await createEndpoint({
      id: 'a',
      targetIds: ['b'],
      transport: leftTransport,
      middlewares: [connect(), abort()]
    })
    /** Real provider retains context until this fixture settles it. */
    const right = await createEndpoint({
      id: 'b',
      targetIds: ['a'],
      transport: rightTransport,
      middlewares: [connect(), abort()],
      provider: {
        echo: async (context) => {
          if (context.data === 'hold') {
            retained = context
            enter()
            await hold
          }
          return context.success(context.data)
        }
      }
    })
    try {
      await left.send('b', 'echo', 'warm')
      /** Capture only the held request and routed cancellation. */
      const allocations = countControllers()
      /** Observe the existing coordinator rather than manufacturing a provider reason. */
      const routed = vi.spyOn(RpcVariationCoordinator.prototype, 'abort')
      /** The same request promise must reject with the established cancellation code. */
      const request = left.send('b', 'echo', 'hold', { signal: caller.signal })
      await entered
      caller.abort('first cancellation')
      await expect(request).rejects.toMatchObject({ code: RpcCoreErrorCode.cancelled })
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      assert.equal(allocations(), 0, '[A16] unread provider cancellation must remain lazy')
      expect(retained!.success('late')).toMatchObject({ code: RpcCoreErrorCode.contextExpired })
      /** First read materializes one native signal with the coordinator's original reason. */
      const signal = retained!.signal
      assert.equal(signal.aborted, true)
      assert.ok(routed.mock.calls.length > 0)
      assert.equal(signal.reason, routed.mock.calls.at(-1)![3])
      expect(signal.reason).toMatchObject({ message: 'first cancellation' })
      assert.equal(retained!.signal, signal)
      assert.equal(allocations(), 1)
    } finally {
      finish()
      vi.unstubAllGlobals()
      await left.dispose()
      await right.dispose()
    }
  })

  it('[A16] copied canonical descriptors and tokens execute the original full codec and framer', async () => {
    const [leftTransport, rightTransport] = createMemoryTransportPair()
    /** Custom wrappers observe real encode/framing despite canonical public names. */
    const calls = { encode: 0, frame: 0, accept: 0 }
    /** Frozen copied identity cannot inherit package-private component proof. */
    const codec = Object.freeze({
      ...identityCodecV1,
      encode: (value: unknown) => {
        calls.encode++
        return identityCodecV1.encode(value)
      }
    })
    /** Both framing directions remain observable on the original complete pipeline. */
    const framer = Object.freeze({
      ...messageFramerV1,
      frame: (value: unknown, metadata: Parameters<typeof messageFramerV1.frame>[1]) => {
        calls.frame++
        return messageFramerV1.frame(value, metadata)
      },
      accept: (value: unknown, metadata: Parameters<typeof messageFramerV1.accept>[1]) => {
        calls.accept++
        return messageFramerV1.accept(value, metadata)
      }
    })
    /** Copied middleware token also loses its private factory identity. */
    const left = await createEndpoint({
      id: 'a',
      targetIds: ['b'],
      transport: leftTransport,
      codec,
      framer,
      middlewares: [{ ...connect() }, abort()],
      provider: { echo: (context) => context.success(context.data) }
    })
    /** Matching public configuration does not make either endpoint eligible. */
    const right = await createEndpoint({
      id: 'b',
      targetIds: ['a'],
      transport: rightTransport,
      codec,
      framer,
      middlewares: [{ ...connect() }, abort()],
      provider: { echo: (context) => context.success(context.data) }
    })
    try {
      assert.equal(await left.send('b', 'echo', 'copied'), 'copied')
      assert.equal(await right.send('a', 'echo', 'custom'), 'custom')
      assert.ok(calls.encode > 0 && calls.frame > 0 && calls.accept > 0)
    } finally {
      await left.dispose()
      await right.dispose()
    }
  })
})
