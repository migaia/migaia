import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { RpcContractErrorCode } from '../../src/contract/error-code.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from './fixture.js'
import { connected } from './fixture.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import type { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import type { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import { readRuntimeCarrier } from '../../src/contract/runtime-api/carrier.js'
import type { IRpcRuntimeEnvelope } from '../../src/contract/runtime-api/types.js'

it('[A67][A73] queued order-only stream rejects finish without turning it into a cancellation', async () => {
  /** A genuine earlier key owner leaves the original stream task queued before iterator creation. */
  let started = false
  let constructed = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const fixture = await connected(
    {},
    {
      hold: async () => {
        started = true
        await held
        return 9
      },
      values: () => {
        constructed++
        return (async function* () {
          yield 1
          return 42
        })()
      }
    },
    capabilities,
    capabilities
  )
  const endpoint = readRuntimePeerConnection(fixture.peers[0]).endpoint
  const sender = readEndpointOwner<RpcOutboundSender>(endpoint, 'outbound-pipeline')!
  const outbound = readEndpointOwner<RpcOutboundAttachment>(endpoint, 'outbound-attachment')!
  const send = vi.spyOn(sender.transport, 'send')
  const iterator = fixture.peers[0].stream('values', undefined, { orderKey: 'same' })
  const holding = fixture.peers[0].request('hold', undefined, { orderKey: 'same' })
  let opening: Promise<unknown> | undefined
  try {
    await vi.waitFor(() => assert.equal(started, true))
    opening = iterator.next().catch((error: unknown) => error)
    let opened: IRpcRuntimeEnvelope | undefined
    await vi.waitFor(() => {
      opened = send.mock.calls
        .map((args) => readRuntimeCarrier(args[0])?.frame as IRpcRuntimeEnvelope | undefined)
        .find((frame) => frame?.kind === 'runtime-call' && frame.task.mode === 'stream')
      assert.ok(opened)
    })
    await outbound.sendRuntimeFrame({
      profile: opened!.profile,
      kind: 'runtime-control',
      operation: 'stream',
      id: opened!.id,
      task: opened!.task,
      route: opened!.route,
      stream: { event: 'finish-without-items', seq: 0 }
    })
    release()
    assert.equal(await holding, 9)
    assert.deepEqual(
      await opening,
      { done: false, value: 1 },
      '[A67] forged finish cannot revoke an order-only queued stream'
    )
    assert.equal(constructed, 1)
    assert.ok(
      fixture.failures.some(
        (error) => Reflect.get(error as object, 'code') === RpcContractErrorCode.invalidStream
      )
    )
    assert.deepEqual(await iterator.next(), { done: true, value: 42 })
  } finally {
    release()
    await fixture.close()
    send.mockRestore()
    await holding.catch(() => undefined)
    await opening
  }
})

it('[A67][A73] finish intent cannot enable discard on a stream that selected only ordering', async () => {
  /** Each original next call advances a real finite producer; no consumer pull means no advance. */
  let pulls = 0
  const fixture = await connected(
    {},
    {
      baseline: () => 9,
      values: async function* () {
        pulls++
        yield 1
        pulls++
        yield 2
        return 42
      }
    },
    capabilities,
    capabilities
  )
  const endpoint = readRuntimePeerConnection(fixture.peers[0]).endpoint
  const sender = readEndpointOwner<RpcOutboundSender>(endpoint, 'outbound-pipeline')!
  const outbound = readEndpointOwner<RpcOutboundAttachment>(endpoint, 'outbound-attachment')!
  const send = vi.spyOn(sender.transport, 'send')
  const iterator = fixture.peers[0].stream('values', undefined, { orderKey: 'same' })
  try {
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    const opened = send.mock.calls
      .map((args) => readRuntimeCarrier(args[0])?.frame as IRpcRuntimeEnvelope | undefined)
      .find((frame) => frame?.kind === 'runtime-call')!
    assert.ok(opened)
    /** A supported source can send a control, but cannot change the already admitted mode options. */
    await outbound.sendRuntimeFrame({
      profile: opened.profile,
      kind: 'runtime-control',
      operation: 'stream',
      id: opened.id,
      task: opened.task,
      route: opened.route,
      stream: { event: 'finish-without-items', seq: 1 }
    })
    assert.equal(await fixture.peers[0].request('baseline'), 9)
    assert.equal(pulls, 1, '[A67] unselected finish must never drain the business iterator')
    assert.ok(
      fixture.failures.some(
        (error) => Reflect.get(error as object, 'code') === RpcContractErrorCode.invalidStream
      )
    )
    assert.deepEqual(await iterator.next(), { done: false, value: 2 })
    assert.deepEqual(await iterator.next(), { done: true, value: 42 })
  } finally {
    await fixture.close()
    send.mockRestore()
  }
})

/** The fixture explicitly opts into the profile while production offers remain unadvertised. */
const capabilities = [
  /** D40 default request/stream deadlines are genuinely offered by both source owners. */
  RpcCapability.deadline,
  ...RUNTIME_API_CAPABILITIES,
  RpcCapability.generation,
  RpcCapability.order,
  RpcCapability.cancelBeforeStart,
  RpcCapability.outcome
]

it.each([
  RpcCapability.generation,
  RpcCapability.stream,
  RpcCapability.cancelBeforeStart,
  RpcCapability.outcome
])(
  '[A73] stream missing %s fails before send and leaves the original consumer registry empty',
  async (missing) => {
    /** The actual offer intersection removes only the selected required capability. */
    const selected = capabilities.filter((capability) => capability !== missing)
    /** Provider construction proves that refusal cannot silently run a legacy generator. */
    let constructed = 0
    /** The actual factory and its ordinary request remain available on this source agreement. */
    const fixture = await connected(
      {},
      {
        values: () => {
          constructed += 1
          return (async function* () {
            yield 1
          })()
        },
        baseline: () => 42
      },
      selected,
      selected
    )
    /** Observe the actual physical sender only after genuine describe has completed. */
    const sender = readEndpointOwner<RpcOutboundSender>(
      readRuntimePeerConnection(fixture.peers[0]).endpoint,
      'outbound-pipeline'
    )!
    /** This existing send method proves zero physical frames for the refused operation. */
    const send = vi.spyOn(sender.transport, 'send')
    try {
      await assert.rejects(
        async () => {
          /**
           * Lazy opening must retain the same capability refusal without allocating a live
           * consumer.
           */
          const iterator = fixture.peers[0].stream('values', undefined, {
            cancel: 'before-start',
            idempotencyKey: 'unsupported-stream'
          })
          await iterator.next()
        },
        (error: unknown) =>
          Reflect.get(error as object, 'code') === RpcCoreErrorCode.capabilityUnsupported
      )
      assert.equal(send.mock.calls.length, 0)
      assert.equal(constructed, 0)
      /** The original consumer Map also proves partial scope construction was rolled back. */
      const consumers = readEndpointOwner<Map<string, unknown>>(
        readRuntimePeerConnection(fixture.peers[0]).endpoint,
        'stream-consumer-registry'
      )!
      assert.equal(consumers.size, 0)
      assert.equal(await fixture.peers[0].request('baseline'), 42)
    } finally {
      send.mockRestore()
      await fixture.close()
    }
  }
)

it('[A67] concurrent next/return shares one producer credit and returns the actual terminal after the start deadline', async () => {
  /** A custom supported async iterator exposes actual concurrent next calls without a second stream. */
  let active = 0
  /** Maximum belongs to the actual producer iterator, not caller in-flight promises. */
  let maximum = 0
  /** A finite iterator counts every actual credit through its real final result. */
  let pulls = 0
  /** Before-start return must never invoke this provider's interruption callback. */
  let returns = 0
  /** The actual run context proves that an elapsed start deadline does not abort started work. */
  let signal: IRpcAbortSignal | undefined
  /** Fixture releases the original outstanding next after return intent has been sent. */
  let finish!: () => void
  /** Only the first genuine producer credit waits on this business promise. */
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** Actual source negotiation and provider registry preserve normal RPC ownership. */
  const fixture = await connected(
    {},
    {
      values: (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
        signal = context.signal
        return {
          [Symbol.asyncIterator]() {
            return this
          },
          next: async () => {
            active += 1
            maximum = Math.max(maximum, active)
            try {
              pulls += 1
              if (pulls === 1) await held
              return pulls <= 3
                ? { done: false as const, value: pulls }
                : { done: true as const, value: 42 }
            } finally {
              active -= 1
            }
          },
          return: async () => {
            returns += 1
            return { done: true as const, value: -1 }
          }
        }
      }
    },
    capabilities,
    capabilities
  )
  /** This timer governs start permission only; the first real credit establishes started work. */
  const iterator = fixture.peers[0].stream('values', undefined, {
    cancel: 'before-start',
    timeoutMs: 100
  })
  /** Consumer pending next is observed throughout the same terminal settlement. */
  const next = iterator.next()
  void next.catch(() => undefined)
  try {
    await vi.waitFor(() => assert.equal(pulls, 1), { interval: 5 })
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    assert.equal(signal!.aborted, false)
    /** Both return calls target the same already running producer and terminal promise. */
    const returned = iterator.return!()
    const repeated = iterator.return!()
    finish()
    assert.deepEqual(await returned, { done: true, value: 42 })
    assert.deepEqual(await repeated, { done: true, value: 42 })
    assert.deepEqual(await next, { done: true, value: 42 })
    assert.equal(pulls, 4)
    assert.equal(maximum, 1)
    assert.equal(returns, 0)
  } finally {
    finish()
    await fixture.close()
    await next.catch(() => undefined)
  }
})

it.each(['cancel', 'return', 'throw', 'forged-order-only', 'forged-order-only-cancel'] as const)(
  '[A66] %s intent overtakes a physically started stream write before final provider start',
  async (intent) => {
    /** Only actual run construction counts execution, independent of transport send admission. */
    let constructed = 0
    /** The actual physical write can be in progress while control frames continue on the same owner. */
    let writing = false
    /** Fixture releases the already started write without replacing any RPC protocol owner. */
    let finish!: () => void
    /** One original physical send remains unfinished until its real payload is delivered. */
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** Both Peers use the genuine source offer and accepted generation bindings. */
    const fixture = await connected(
      {},
      {
        values: () => {
          constructed += 1
          return (async function* () {
            yield 1
            return 2
          })()
        },
        other: () => 9
      },
      capabilities,
      capabilities
    )
    /** The original send still delivers every actual frame after this one delayed write. */
    const sender = readEndpointOwner<RpcOutboundSender>(
      readRuntimePeerConnection(fixture.peers[0]).endpoint,
      'outbound-pipeline'
    )!
    /** Only this exact existing transport emits the tested stream task. */
    const original = sender.transport.send
    /** Only the first stream-open physical write pauses; subsequent task-bound control is genuine. */
    const send = vi.spyOn(sender.transport, 'send').mockImplementationOnce(async (...args) => {
      writing = true
      await held
      return Reflect.apply(original, sender.transport, args)
    })
    /** The caller's intent belongs to the original stream operation and generation tuple. */
    const cancel = new AbortController()
    /** Lazy first next initiates the one real stream task. */
    const iterator = fixture.peers[0].stream('values', undefined, {
      ...(intent.startsWith('forged-order-only') ? {} : { cancel: 'before-start' as const }),
      orderKey: 'early-intent',
      signal: cancel.signal
    })
    /** Capture terminal or item immediately so fixture failures cannot become unhandled rejections. */
    const next = iterator.next().catch((error: unknown) => error)
    /**
     * The original final result is observed immediately even when the initial open is still
     * pending.
     */
    let returned: Promise<unknown> | undefined
    try {
      await vi.waitFor(() => assert.equal(writing, true))
      if (intent.startsWith('forged-order-only')) {
        /** A real accepted task can carry an invalid finish while its call remains in ingress. */
        const opened = readRuntimeCarrier(send.mock.calls[0]![0])!.frame as IRpcRuntimeEnvelope
        const outbound = readEndpointOwner<RpcOutboundAttachment>(
          readRuntimePeerConnection(fixture.peers[0]).endpoint,
          'outbound-attachment'
        )!
        await outbound.sendRuntimeFrame({
          profile: opened.profile,
          kind: 'runtime-control',
          operation: 'stream',
          id: opened.id,
          task: opened.task,
          route: opened.route,
          stream: { event: 'finish-without-items', seq: 0 }
        })
        if (intent === 'forged-order-only-cancel') cancel.abort()
      } else if (intent === 'cancel') cancel.abort()
      else
        returned = (
          intent === 'return'
            ? iterator.return!()
            : iterator.throw!(new Error('early stream throw'))
        ).catch((error: unknown) => error)
      assert.equal(await fixture.peers[0].request('other'), 9)
      assert.equal(constructed, 0)
      finish()
      /** Original write completion and a genuine later reply prove the open passed ingress. */
      await send.mock.results[0]!.value
      assert.equal(await fixture.peers[0].request('other'), 9)
      if (intent === 'forged-order-only') {
        assert.equal(constructed, 1, '[A67] unselected early finish cannot cancel a valid stream')
        assert.deepEqual(await next, { done: false, value: 1 })
        assert.deepEqual(await iterator.next(), { done: true, value: 2 })
        assert.ok(
          fixture.failures.some(
            (error) => Reflect.get(error as object, 'code') === RpcContractErrorCode.invalidStream
          )
        )
        return
      }
      assert.equal(constructed, 0, '[A66] early return must cancel before provider construction')
      /**
       * Preserve the full actual failure classification while distinguishing fixture transport
       * errors.
       */
      const result = await next
      if (intent === 'forged-order-only-cancel') {
        /** Ordering alone preserves the local native reason instead of awaiting a remote wrapper. */
        assert.equal(result, cancel.signal.reason)
        assert.ok(result instanceof DOMException)
        assert.equal(result.name, 'AbortError')
      } else
        assert.equal(
          Reflect.get(result as object, 'code'),
          RpcCoreErrorCode.cancelled,
          `[A66] original result: ${String(result)}; cause: ${String(Reflect.get(result as object, 'cause'))}`
        )
      if (returned) {
        /** Finish must settle on the actual cancellation before fixture close can clean anything up. */
        const terminal = await returned
        if (intent === 'throw') {
          assert.ok(terminal instanceof AggregateError)
          assert.ok(
            terminal.errors.some(
              (error: unknown) =>
                Reflect.get(error as object, 'code') === RpcCoreErrorCode.cancelled
            )
          )
        } else assert.equal(Reflect.get(terminal as object, 'code'), RpcCoreErrorCode.cancelled)
      }
      assert.equal(constructed, 0)
    } finally {
      finish()
      await fixture.close()
      await next
      await returned
      send.mockRestore()
    }
  }
)

it('[A59][A67] ordered stream keeps ordinary return cleanup and its key lease until cleanup finishes', async () => {
  /** The original generator finally block owns its actual asynchronous cleanup. */
  const effects: string[] = []
  /** Fixture cleanup can pause without changing stream ownership or cancellation. */
  let finish!: () => void
  /** Only the business finally block waits on this controlled cleanup promise. */
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** The follower's execution remains observable through the genuine original pending request. */
  let follower: Promise<unknown> | undefined
  /** Both routes use one genuine Peer and the final provider's canonical admission scope. */
  const fixture = await connected(
    {},
    {
      values: async function* () {
        try {
          yield 1
        } finally {
          effects.push('cleanup-start')
          await held
          effects.push('cleanup-end')
        }
      },
      after: () => {
        effects.push('after')
        return 7
      },
      other: () => 9
    },
    capabilities,
    capabilities
  )
  /** Ordering alone does not opt into before-start discard semantics. */
  const iterator = fixture.peers[0].stream('values', undefined, { orderKey: 'same' })
  try {
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    /** Observe a rejected or resolved return without allowing an unhandled fixture failure. */
    const returned = iterator.return!().then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await vi.waitFor(() => assert.deepEqual(effects, ['cleanup-start']))
    follower = fixture.peers[0].request('after', undefined, { orderKey: 'same' })
    void follower.catch(() => undefined)
    assert.equal(await fixture.peers[0].request('other', undefined, { orderKey: 'other' }), 9)
    assert.deepEqual(
      effects,
      ['cleanup-start'],
      '[A59] cleanup remains part of the original stream lease'
    )
    finish()
    assert.deepEqual(await returned, { value: { done: true, value: undefined } })
    assert.equal(await follower, 7)
    assert.deepEqual(effects, ['cleanup-start', 'cleanup-end', 'after'])
  } finally {
    finish()
    await fixture.close()
    await follower?.catch(() => undefined)
  }
})

it('[A66][A67] started stream ignores start cancellation and return drains the same generator to its actual final value', async () => {
  /** The real provider exposes its actual context signal for start/cancel arbitration. */
  let signal: IRpcAbortSignal | undefined
  /** Every executed yield is an observable business effect, including discarded yields. */
  const effects: number[] = []
  /** A finite generator can pause without requiring another caller credit after return. */
  let finish!: () => void
  /** Only fixture business work waits on this promise; stream credit remains production-owned. */
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** The selected Peer owns genuine registration, framing, pending state, and the stream iterator. */
  const fixture = await connected(
    {},
    {
      values: async function* (_payload: unknown, context: { signal: IRpcAbortSignal }) {
        signal = context.signal
        effects.push(1)
        yield 1
        await held
        effects.push(2)
        yield 2
        effects.push(3)
        yield 3
        return 42
      }
    },
    capabilities,
    capabilities
  )
  /** Caller intent applies only before final provider start. */
  const cancel = new AbortController()
  /** This is the original stream surface returned by the real high-level Peer. */
  const iterator = fixture.peers[0].stream('values', undefined, {
    cancel: 'before-start',
    signal: cancel.signal,
    idempotencyKey: 'stream-completion'
  })
  try {
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    assert.ok(signal)
    cancel.abort()
    assert.equal(signal.aborted, false, '[A66] start wins without aborting the producer')
    /** Repeated return shares the original terminal settlement, never a second drain. */
    const returned = iterator.return!()
    const repeated = iterator.return!()
    finish()
    assert.deepEqual(await returned, { done: true, value: 42 })
    assert.deepEqual(await repeated, { done: true, value: 42 })
    assert.deepEqual(
      effects,
      [1, 2, 3],
      '[A67] return discards yields without generator.return interruption'
    )
    /** Only final generator completion is retained; yielded values do not become an outcome buffer. */
    const outcome = await fixture.peers[0].outcome('stream-completion')
    assert.equal(outcome.state, 'done')
    if (outcome.state !== 'done') assert.fail('[A69] stream final result must be sealed')
    assert.deepEqual(outcome.outcome.completion, { ok: true, result: 42 })
    assert.equal(fixture.failures.length, 0)
  } finally {
    finish()
    await fixture.close()
  }
})

it('[A59][A67] stream holds its original order lease until real producer terminal while another key progresses', async () => {
  /** Effects distinguish actual provider start from stream-open send completion. */
  const effects: string[] = []
  /** The genuine same-key follower remains observable through its original request promise. */
  let follower: Promise<unknown> | undefined
  /** A real producer has two yields and a final value. */
  const fixture = await connected(
    {},
    {
      values: async function* () {
        effects.push('stream')
        yield 1
        yield 2
        return 42
      },
      after: () => {
        effects.push('after')
        return 7
      },
      other: () => 9
    },
    capabilities,
    capabilities
  )
  /** Ordering is attached to the real stream open, not its individual pulls. */
  const iterator = fixture.peers[0].stream('values', undefined, { orderKey: 'same' })
  try {
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    follower = fixture.peers[0].request('after', undefined, { orderKey: 'same' })
    void follower.catch(() => undefined)
    assert.equal(await fixture.peers[0].request('other', undefined, { orderKey: 'other' }), 9)
    assert.deepEqual(
      effects,
      ['stream'],
      '[A59] stream-open completion cannot release its key lease'
    )
    assert.deepEqual(await iterator.next(), { done: false, value: 2 })
    assert.deepEqual(await iterator.next(), { done: true, value: 42 })
    assert.equal(await follower, 7)
    assert.deepEqual(effects, ['stream', 'after'])
  } finally {
    await fixture.close()
    await follower?.catch(() => undefined)
  }
})

it('[A66] queued stream cancellation prevents even iterator construction at the final provider', async () => {
  /** Constructor effects prove the final start point precedes calling the original run callback. */
  let constructed = 0
  /** A running genuine request owns the shared key before stream admission. */
  let started = false
  /** Fixture business work releases independently of cancellation intent. */
  let finish!: () => void
  /** The actual provider can deliberately keep its original execution lease. */
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** Both modes share the same original endpoint and logical provider owner. */
  const fixture = await connected(
    {},
    {
      hold: async () => {
        started = true
        await held
        return 1
      },
      values: () => {
        constructed += 1
        return (async function* () {
          yield 2
          return 3
        })()
      },
      other: () => 4
    },
    capabilities,
    capabilities
  )
  /** The original pending request is observed throughout cleanup. */
  const holding = fixture.peers[0].request('hold', undefined, { orderKey: 'same' })
  void holding.catch(() => undefined)
  /** This intent belongs exclusively to the waiting stream. */
  const cancel = new AbortController()
  /** Opening remains lazy; the first next performs the real stream admission. */
  const iterator = fixture.peers[0].stream('values', undefined, {
    orderKey: 'same',
    cancel: 'before-start',
    signal: cancel.signal
  })
  try {
    await vi.waitFor(() => assert.equal(started, true))
    /** Observing rejection immediately prevents an unhandled promise when cancellation wins. */
    const next = iterator.next().catch((error: unknown) => error)
    assert.equal(await fixture.peers[0].request('other'), 4)
    assert.equal(constructed, 0, '[A66] queued stream has not called its run callback')
    cancel.abort()
    assert.equal(Reflect.get((await next) as object, 'code'), RpcCoreErrorCode.cancelled)
    assert.equal(constructed, 0)
    finish()
    assert.equal(await holding, 1)
  } finally {
    finish()
    await fixture.close()
    await holding.catch(() => undefined)
  }
})
