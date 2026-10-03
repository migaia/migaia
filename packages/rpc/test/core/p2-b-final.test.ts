import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { describe, it, vi } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '../../src/contract/framing/message-framer.js'
import { normalizeRpcEnvelope, rpcProtocolV1, type IRpcEnvelope } from '../../src/contract/index.js'
import { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../src/core/internal/endpoint-options.js'
import { createIpcSendQueueFeature } from '../../src/core/plugins/send-queue.js'
import { createFullOneWayEndpoint, connect } from '../../src/core/index.js'
import type { IRpcAuthenticationCapability } from '../../src/core/typing.js'
import { createWebWorkerTransport } from '../../src/browser/adapters/web-worker.js'

/** Valid fixtures preserve the ordinary semantic contract independently of physical grouping. */
function envelope(
  id: string,
  kind: 'request' | 'response' = 'request',
  payload: unknown = id
): IRpcEnvelope {
  return normalizeRpcEnvelope({
    kind,
    id,
    ...(kind === 'request' ? { method: 'echo' } : { ok: true }),
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: kind,
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        receiverId: 'b',
        sentAt: 0,
        ...(kind === 'response' ? { receiverId: 'b', method: 'echo' } : {})
      },
      payload
    }
  })
}

/** The canonical sender receives the same private decision as the actual outbound attachment. */
function fixture(
  batch = true,
  gated = false,
  delayedMs = 0,
  authentication?: IRpcAuthenticationCapability
) {
  /** Actual write invocation order, not Promise completion order, is the physical FIFO oracle. */
  const frames: unknown[] = []
  /** The first real write remains busy while subsequent envelopes become ready. */
  let release!: () => void
  /** One host write Promise keeps its completion independently observable. */
  const first = new Promise<void>((resolve) => {
    release = resolve
  })
  /** Existing gate owns envelope capacity and closure; the sender owns physical grouping. */
  const { gate } = createIpcSendQueueFeature({ connectionId: 'p2b-physical-fixture' })
  /** Original foundational components do not add user interceptors or codec estimates. */
  const components: IRpcSelectedComponents = {
    protocol: rpcProtocolV1,
    codec: identityCodecV1 as unknown as IRpcSelectedComponents['codec'],
    framer: messageFramerV1,
    ingressPrepare: (frame) => ({ frame, messageId: 'whole' }),
    shadowed: []
  }
  /** The internal constructor adds no public endpoint configuration switch. */
  const Sender = RpcOutboundSender as unknown as new (...args: unknown[]) => RpcOutboundSender
  /** Real transport promises model writability without introducing another queue. */
  const transport = {
    platform: 'Memory' as const,
    send(frame: unknown) {
      frames.push(frame)
      if (frames.length === 1) return first
      if (delayedMs) return new Promise<void>((resolve) => setTimeout(resolve, delayedMs))
    }
  }
  return {
    frames,
    release,
    gate,
    sender: new Sender(
      transport,
      'a',
      components,
      authentication,
      'Memory',
      gated ? gate : undefined,
      undefined,
      true,
      batch
    )
  }
}

/** Waits for the actual baseline write, so a setup/import failure never substitutes for red. */
async function started(run: ReturnType<typeof fixture>): Promise<void> {
  for (let index = 0; index < 30 && run.frames.length === 0; index++) await Promise.resolve()
  assert.equal(run.frames.length, 1, 'physical busy positive control really started')
}

/** Reads member identity without normalizing or encoding any production input a second time. */
function members(frame: unknown): readonly IRpcEnvelope[] {
  /** Frames are recorded after the canonical sender, so these fixture-only fields are plain data. */
  const value = frame as { kind?: string; envelopes?: IRpcEnvelope[] }
  return value.kind === 'batch' ? value.envelopes! : [frame as IRpcEnvelope]
}

describe('P2-B optimal physical writer', () => {
  it('[A26] explicit gate closure immediately rejects queued work with the original reason', async () => {
    /** A live physical write must remain independent of cancellation of not-yet-started members. */
    const run = fixture(true, true)
    /** One active accepted envelope keeps the actual writer blocked. */
    const first = run.sender.send(envelope('active'))
    await started(run)
    /** Catch before close so the rejection identity is observable without unhandled work. */
    let observed: unknown
    const queued = Promise.resolve(run.sender.send(envelope('queued'))).catch((error: unknown) => {
      observed = error
      return error
    })
    /** The existing close contract preserves caller-provided error identity. */
    const reason = new Error('fixture explicit gate close')
    run.gate.close(reason)
    try {
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      assert.equal(
        observed,
        reason,
        '[A26] queued rejection does not wait for active physical completion'
      )
      assert.equal(run.frames.length, 1)
    } finally {
      run.release()
      await first
      await queued
      await run.gate.whenIdle()
    }
  })
  it('[A25] idle ordinary request invokes the existing single writer synchronously', async () => {
    /** Idle qualification must not schedule a coalescing microtask before the first write. */
    const run = fixture()
    /** Return identity is observed after the real synchronous writer invocation. */
    const sent = run.sender.send(envelope('idle'))
    assert.equal(run.frames.length, 1, '[A25] idle writer sends immediately without queueMicrotask')
    assert.equal(members(run.frames[0]).length, 1)
    run.release()
    await sent
    await run.sender.send(envelope('sequential'))
    assert.equal(
      run.frames.length,
      2,
      '[A25] dependent settled calls retain single physical frames'
    )
    assert.equal(members(run.frames[1]).length, 1)
  })

  it('[A25] busy writer flushes all ready responses as one frame in original order', async () => {
    /** Response emission uses the same physical owner as requests. */
    const run = fixture(true, true)
    /** One real write is active before the candidate response group is admitted. */
    const first = run.sender.send(envelope('first'))
    await started(run)
    /** No response Promise must prevent another ready response entering the group. */
    const inputs = Array.from({ length: 16 }, (_, index) => envelope(String(index), 'response'))
    /** All logical writes retain independent completion Promises. */
    const sent = inputs.map((input) => run.sender.send(input))
    run.release()
    await Promise.all([first, ...sent])
    assert.equal(
      run.frames.length,
      2,
      '[A25] busy response queue flushes once, not one frame per response'
    )
    assert.deepEqual(members(run.frames[1]), inputs)
    await run.gate.whenIdle()
  })

  it('[A26] per-position response completion has one physical delay, not a linear tail', async () => {
    /**
     * The existing gate plus a five-millisecond transport makes positional serialization
     * observable.
     */
    const run = fixture(true, true, 5)
    /** First active write is independent of the measured response position. */
    const first = run.sender.send(envelope('first'))
    await started(run)
    /** Each logical position records its actual completion on the same monotonic host clock. */
    const completed: number[] = []
    /** Responses become ready together while the initial physical write is held. */
    const sent = Array.from({ length: 16 }, (_, index) =>
      Promise.resolve(run.sender.send(envelope(String(index), 'response'))).then(() => {
        completed[index] = performance.now()
      })
    )
    run.release()
    await Promise.all([first, ...sent])
    assert.equal(completed.length, 16)
    assert.ok(
      Math.max(...completed) - Math.min(...completed) < 10,
      '[A26] completion spread must not grow by one five-ms physical wait per batch position'
    )
    assert.equal(run.frames.length, 2)
  })

  it('[A27] only an oversize whole encoded frame is split at member boundaries', async () => {
    /** Two individually valid large envelopes exceed the actual sixteen-MiB batch cap. */
    const run = fixture()
    /** The initial small writer permits both large members to accumulate before drain. */
    const first = run.sender.send(envelope('first'))
    await started(run)
    /** The spy counts real size encodings without changing JSON behavior. */
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      /** Native portable strings avoid a fixture-specific byte estimator. */
      const inputs = [
        envelope('big-one', 'response', 'x'.repeat(9 * 1024 * 1024)),
        envelope('big-two', 'response', 'x'.repeat(9 * 1024 * 1024))
      ]
      /** Oversize preparation and both emitted subgroups are distinguished. */
      const sent = inputs.map((input) => run.sender.send(input))
      run.release()
      await Promise.all([first, ...sent])
      /**
       * Each stringify input corresponds to a complete physical representation, never a member
       * estimate.
       */
      const encoded = stringify.mock.calls.map(([value]) => value)
      assert.ok(
        encoded.some((value) => (value as { envelopes?: unknown[] }).envelopes?.length === 2),
        '[A27] whole frame is encoded before deciding to split'
      )
      assert.equal(run.frames.length, 3)
      assert.deepEqual(run.frames.slice(1).flatMap(members), inputs)
      for (const frame of run.frames.slice(1))
        assert.ok(new TextEncoder().encode(JSON.stringify(frame)).byteLength <= 16_777_216)
    } finally {
      stringify.mockRestore()
    }
  })

  it('[A28] absent private batch agreement preserves one single frame per envelope', async () => {
    /** False qualification exercises the old gate and conversion path. */
    const run = fixture(false, true)
    /** Old capacity remains counted per logical envelope. */
    const first = run.sender.send(envelope('first'))
    await started(run)
    /** No batch capability is inferred from a transport shape. */
    const sent = ['one', 'two', 'three'].map((id) => run.sender.send(envelope(id)))
    run.release()
    await Promise.all([first, ...sent])
    assert.equal(run.frames.length, 4)
    assert.ok(run.frames.every((frame) => members(frame).length === 1))
  })

  it('[A28] one bad member cannot block valid siblings or serialize provider execution', async () => {
    /** Both canonical factories belong to the same explicit static deployment. */
    const listeners = [
      new Set<(event: MessageEvent) => void>(),
      new Set<(event: MessageEvent) => void>()
    ]
    /** Physical frames and delivery are visible without replacing the core receiver. */
    const ports = [0, 1].map((side) => ({
      postMessage(value: unknown) {
        queueMicrotask(() => {
          for (const listener of listeners[1 - side]!) listener({ data: value } as MessageEvent)
        })
      },
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === 'message') listeners[side]!.add(listener)
      },
      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === 'message') listeners[side]!.delete(listener)
      }
    }))
    /** The actual canonical transport grants source/identity behavior on each endpoint. */
    const transport = createWebWorkerTransport(ports[1] as never, { peerId: 'a' })
    /** Provider work is held to distinguish admission order from completion order. */
    const endpoint = await createFullOneWayEndpoint({
      id: 'b',
      transport,
      middlewares: [connect({ transport })]
    })
    /** Concurrent entries must be observable before either provider completes. */
    const seen: string[] = []
    /** One business hold is released only after both semantic admissions are checked. */
    let release!: () => void
    /** Ordinary asynchronous provider execution uses the existing provider owner. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    endpoint.provide('echo', async (context) => {
      seen.push(context.data as string)
      await held
      return context.success(context.data)
    })
    try {
      ports[0]!.postMessage({
        kind: 'batch',
        envelopes: [envelope('good-one'), { kind: 'request', id: 'bad' }, envelope('good-two')]
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      assert.deepEqual(
        seen,
        ['good-one', 'good-two'],
        '[A28] valid siblings enter before either provider completes'
      )
    } finally {
      release()
      await endpoint.dispose()
    }
  })
  it('[A26] cancellation rebuild preserves physical FIFO and authentication counter order', async () => {
    /** Genuine async protection pauses the first multi-member group, never the preceding host drain. */
    let releaseProtect!: () => void
    let protecting!: () => void
    const entered = new Promise<void>((resolve) => {
      protecting = resolve
    })
    const held = new Promise<void>((resolve) => {
      releaseProtect = resolve
    })
    let counter = 0
    const run = fixture(true, true, 0, {
      enabled: true,
      encodedType: 'any',
      async protect(value) {
        const current = ++counter
        if (current === 2) {
          protecting()
          await held
        }
        return { counter: current, value }
      },
      unprotect: (value) => value
    })
    const first = run.sender.send(envelope('first'))
    await started(run)
    const controller = new AbortController()
    const reason = new Error('fixture queued cancellation')
    const cancelled = Promise.resolve(
      run.sender.send(envelope('cancelled'), undefined, {
        queueSignal: controller.signal,
        signals: [controller.signal],
        assertCanSend() {
          if (controller.signal.aborted) throw reason
        }
      })
    ).catch((error: unknown) => error)
    const survivor = run.sender.send(envelope('survivor'))
    const boundary = normalizeRpcEnvelope({
      kind: 'variation',
      id: 'boundary',
      data: {
        route: {
          profile: 'migaia.rpc.route',
          type: 'variation',
          variation: 'ping',
          applicationVersion: '1',
          senderId: 'a',
          targetId: 'b',
          receiverId: 'b',
          sentAt: 0
        }
      }
    })
    const boundarySent = run.sender.send(boundary)
    const last = run.sender.send(envelope('last', 'response'))
    run.release()
    await entered
    controller.abort(reason)
    releaseProtect()
    await Promise.all([first, survivor, boundarySent, last])
    assert.equal(await cancelled, reason, '[A26] only cancelled member retains its original reason')
    const protectedFrames = run.frames as Array<{ counter: number; value: IRpcEnvelope }>
    assert.deepEqual(
      protectedFrames.map((frame) => frame.value.id),
      ['first', 'survivor', 'boundary', 'last'],
      '[A26] rebuilt preceding group invokes the writer before the later boundary'
    )
    assert.deepEqual(
      protectedFrames.map((frame) => frame.counter),
      [1, 3, 4, 5],
      '[A26] protection counters follow actual invocation order; discarded preparation is explicit'
    )
  })

  it('[A26/A27] waiting cancellation reclaims capacity and transfer getters remain deferred', async () => {
    const run = fixture(true, true)
    const first = run.sender.send(envelope('first'))
    const controller = new AbortController()
    const reason = new Error('fixture waiting cancellation')
    let reads = 0
    const cancelled = Promise.resolve(
      run.sender.send(
        envelope('cancelled'),
        {
          get transfer() {
            reads++
            return []
          }
        },
        {
          queueSignal: controller.signal,
          signals: [controller.signal],
          assertCanSend() {
            if (controller.signal.aborted) throw reason
          }
        }
      )
    ).catch((error: unknown) => error)
    assert.equal(reads, 0, '[A27] a waiting member does not read the transfer getter')
    controller.abort(reason)
    assert.equal(await cancelled, reason)
    assert.equal(reads, 0, '[A27] cancelled waiting member never reads its transfer getter')
    const sent = Array.from({ length: 255 }, (_, index) => run.sender.send(envelope(String(index))))
    const rejected = Promise.resolve(run.sender.send(envelope('over-capacity'))).catch(
      (error: unknown) => error
    )
    assert.equal(
      ((await rejected) as { code: string }).code,
      'OVERLOADED',
      '[A26] data capacity remains exactly 256 envelopes'
    )
    run.release()
    await Promise.all([first, ...sent])
    assert.equal(run.frames.length, 2)
    assert.equal(members(run.frames[1]).length, 255)
    await run.gate.whenIdle()
  })

  it('[A26/A27] transfer boundaries invoke in FIFO order without waiting on earlier physical completion', async () => {
    const run = fixture(true, true, 5)
    const first = run.sender.send(envelope('first'))
    const sent = [
      run.sender.send(envelope('one')),
      run.sender.send(envelope('two')),
      run.sender.send(envelope('transfer'), { transfer: [new ArrayBuffer(8)] }),
      run.sender.send(envelope('three')),
      run.sender.send(envelope('four'))
    ]
    run.release()
    for (let index = 0; index < 30 && run.frames.length < 4; index++) await Promise.resolve()
    assert.equal(
      run.frames.length,
      4,
      '[A26] later physical invocation does not await five-ms completion'
    )
    assert.deepEqual(
      run.frames.flatMap(members).map((frame) => frame.id),
      ['first', 'one', 'two', 'transfer', 'three', 'four']
    )
    assert.equal(
      members(run.frames[2]).length,
      1,
      '[A27] transfer retains its own single physical frame'
    )
    await Promise.all([first, ...sent])
  })

  it('[A26] gate close rejects waiting members before flush without an endpoint admission', async () => {
    const run = fixture(true, true)
    const first = run.sender.send(envelope('first'))
    const queued = Promise.resolve(run.sender.send(envelope('waiting'))).catch(
      (error: unknown) => error
    )
    run.gate.close()
    run.release()
    await first
    assert.equal(((await queued) as { code: string }).code, 'ENDPOINT_DISPOSED')
    assert.equal(run.frames.length, 1, '[A26] gate-owned closed guard prevents a queued write')
    await run.gate.whenIdle()
  })
})
