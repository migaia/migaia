import { describe, expect, it } from 'vitest'
import assert from 'node:assert/strict'
import { deferred } from '@migaia/utils/promise'
import {
  RpcWireKind,
  RpcWireProfile,
  serializeRpcWireError,
  type IRpcEnvelope,
  type IRpcTask
} from '@migaia/rpc-contract/protocol'
import type { IRpcAttempt, IRpcRetryFeature } from '@migaia/rpc-contract/interfaces'
import { FeatureScope } from '../../dist/feature/scope.js'
import { CallTable, type ICallTargetRef, type ICallWriteOptions } from '../../dist/call/table.js'

/** One accepted source supplies actual handoff and optional synchronous native delivery. */
class CallFixture {
  /** Captured wire traffic exposes business effects without private pending-table assertions. */
  readonly frames: IRpcEnvelope[] = []
  /** Secondary failures stay visible instead of changing a call's primary settlement. */
  readonly reports: unknown[] = []
  /** Each synchronous real terminal records whether its pending task was already admitted. */
  readonly acceptedReplies: boolean[] = []
  /** Concrete complete features use the same namespace resolution owner as real callers. */
  readonly features = new FeatureScope()
  /** Controlled physical completion permits cancellation during an actual queued send. */
  readonly #gate = deferred<void>()
  /** Every owned physical continuation can be joined without timers or polling. */
  readonly #writes: Promise<void>[] = []
  /** Only tests explicitly selecting a gate delay physical handoff. */
  gated = false
  /** Native delivery may synchronously reenter the table before send returns. */
  synchronousReply = false
  /** One physical failure is consumed by the next invocation. */
  failure: unknown
  /** Controlled elapsed monotonic time proves retry never renews inherited time. */
  #now = 0
  /** Replacement updates current selection without mutating a prior attempt's identity. */
  target: ICallTargetRef = {
    namespace: 'fixture',
    carrierId: 'carrier-1',
    peerId: 'peer-1',
    name: 'peer',
    generation: { kind: 'session', value: 1, providerId: 'peer-1' }
  }
  /** The actual source under test owns no Session or provider fixture framework. */
  readonly table: CallTable

  /** All callbacks capture only this named fixture owner. */
  constructor() {
    this.features.register('fixture')
    this.table = new CallTable({
      assertTransfer: () => undefined,
      features: this.features,
      self: () => ({
        instanceId: 'caller',
        applicationVersion: 'fixture',
        generation: { kind: 'session', value: 1, providerId: 'caller' }
      }),
      report: (error) => {
        this.reports.push(error)
      },
      now: () => this.#now,
      timestamp: () => 1000 + this.#now,
      refreshTarget: () => this.target,
      send: (source, frame, options) => this.#send(source, frame, options)
    })
  }

  /** Change only elapsed time; no production scheduler or backoff is emulated here. */
  tick(milliseconds: number): void {
    this.#now += milliseconds
  }

  /** Return a proper closed-shape result with the selected full task and response direction. */
  reply(frame: IRpcEnvelope, result: unknown = 7, task: IRpcTask = frame.task): IRpcEnvelope {
    return {
      profile: RpcWireProfile,
      kind: RpcWireKind.result,
      id: frame.id,
      task,
      route: {
        ...frame.route,
        senderId: frame.route.targetId,
        receiverId: frame.route.senderId,
        targetId: frame.route.senderId
      },
      result: result as number
    }
  }

  /** Join finite fixture-owned writes, including an expected cancelled queued continuation. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.#writes)
  }

  /** Allow a queued physical sender to run its final onWriteStart admission guard. */
  async release(): Promise<void> {
    this.#gate.resolve()
    await this.flush()
  }

  /** The gate delays invocation, not a fake completion receipt. */
  #send(source: string, frame: IRpcEnvelope, options?: ICallWriteOptions): Promise<void> {
    /** One explicit operation owns only data needed until its physical handoff completes. */
    const write = { source, frame, options }
    /** The continuation captures its operation and fixture owner, with no shared closure state. */
    const writing = (this.gated ? this.#gate.promise : Promise.resolve()).then(() =>
      this.#physical(write.source, write.frame, write.options)
    )
    this.#writes.push(writing)
    return writing
  }

  /** Physical handoff precedes delivery; a failed guard cannot append either call or cancel. */
  #physical(source: string, frame: IRpcEnvelope, options?: ICallWriteOptions): void {
    options?.onWriteStart?.()
    this.frames.push(frame)
    if (this.failure !== undefined) {
      /** Clearing the fixture failure models a repaired carrier for a later explicit retry. */
      const failure = this.failure
      this.failure = undefined
      throw failure
    }
    if (this.synchronousReply && frame.kind !== RpcWireKind.cancel)
      this.acceptedReplies.push(
        this.table.accept(source, this.reply(frame, 'payload' in frame ? frame.payload : 7))
      )
  }
}

describe('CallTable owner transitions (public Namespace migration is tracked separately)', () => {
  it('synchronous transport response reentry sees pending before every physical send', async () => {
    /** The existing original sender delivers its actual correlated response before returning. */
    const fixture = new CallFixture()
    fixture.synchronousReply = true
    assert.deepEqual(
      await Promise.all([
        fixture.table.invoke(fixture.target, { mode: 'request', method: 'echo', payload: 1 }),
        fixture.table.invoke(fixture.target, { mode: 'request', method: 'echo', payload: 2 })
      ]),
      [1, 2]
    )
    assert.deepEqual(
      fixture.acceptedReplies,
      [true, true],
      'pending precedes synchronous transport reentry'
    )
    assert.deepEqual(
      fixture.frames.map((frame) => fixture.table.accept('carrier-1', fixture.reply(frame))),
      [true, true],
      'late replies are consumed without a second settlement'
    )
    fixture.table.close(new Error('fixture close'))
  })

  it('registers before synchronous native replies and returns the original result', async () => {
    /** Native delivery is allowed within the actual send invocation. */
    const fixture = new CallFixture()
    fixture.synchronousReply = true
    await expect(
      fixture.table.invoke(fixture.target, { mode: 'request', method: 'read' })
    ).resolves.toBe(7)
    expect(fixture.frames).toHaveLength(1)
    fixture.table.close(new Error('fixture close'))
  })

  it('ignores another source and a changed task before accepting its exact terminal', async () => {
    /** A deferred reply exposes correlation checks without private-state inspection. */
    const fixture = new CallFixture()
    /** Only this original promise can be settled by the authenticated tuple. */
    const result = fixture.table.invoke(fixture.target, { mode: 'request', method: 'read' })
    await fixture.flush()
    /** The actual outbound task supplies the expected correlation. */
    const sent = fixture.frames[0]!
    expect(fixture.table.accept('other-carrier', fixture.reply(sent))).toBe(false)
    expect(
      fixture.table.accept('carrier-1', fixture.reply(sent, 9, { ...sent.task, method: 'other' }))
    ).toBe(false)
    expect(fixture.table.accept('carrier-1', fixture.reply(sent, 11))).toBe(true)
    await expect(result).resolves.toBe(11)
    expect(fixture.table.accept('carrier-1', fixture.reply(sent, 12))).toBe(true)
  })

  it('preserves the native physical failure object and its existing cause', async () => {
    /** Existing write-error parity requires identity, not just a matching code. */
    const fixture = new CallFixture()
    /** The lower-level failure must remain the same cause. */
    const cause = new TypeError('fixture write cause')
    /** The exact native instance is classified without replacement. */
    const failure = new RangeError('fixture write failure', { cause })
    fixture.failure = failure
    await expect(
      fixture.table.invoke(fixture.target, { mode: 'request', method: 'read' })
    ).rejects.toBe(failure)
    expect(failure).toBeInstanceOf(RangeError)
    expect(failure.cause).toBe(cause)
    expect(fixture.frames).toHaveLength(1)
  })

  it('uses the exact one close reason for pending and later calls', async () => {
    /** Two active operations demonstrate shared lifecycle error identity. */
    const fixture = new CallFixture()
    /** Both results are observed before close to avoid detached rejected Promises. */
    const results = Promise.allSettled([
      fixture.table.invoke(fixture.target, { mode: 'request', method: 'a' }),
      fixture.table.invoke(fixture.target, { mode: 'request', method: 'b' })
    ])
    /** The host owns this one reason; CallTable must not create cancellation replacements. */
    const reason = new Error('fixture close')
    fixture.table.close(reason)
    expect(await results).toEqual([
      { status: 'rejected', reason },
      { status: 'rejected', reason }
    ])
    await expect(
      fixture.table.invoke(fixture.target, { mode: 'request', method: 'c' })
    ).rejects.toBe(reason)
    await fixture.flush()
    expect(fixture.frames).toHaveLength(0)
  })

  it('retires only the captured source and never reroutes its old pending call', async () => {
    /** Independent source keys retain independent cancellation membership. */
    const fixture = new CallFixture()
    /** Observe the first rejection before retiring its physical binding. */
    const first = fixture.table.invoke(fixture.target, { mode: 'request', method: 'a' })
    /** This distinct binding remains live after source one leaves. */
    const secondTarget = {
      ...fixture.target,
      carrierId: 'carrier-2',
      peerId: 'peer-2',
      generation: { kind: 'session' as const, value: 1, providerId: 'peer-2' }
    }
    fixture.target = secondTarget
    /** This call selects source two rather than inheriting source one's pending identity. */
    const second = fixture.table.invoke(secondTarget, { mode: 'request', method: 'b' })
    await fixture.flush()
    /** Every record belonging to source one receives this exact original reason. */
    const reason = new Error('fixture retirement')
    /** Attach the rejection assertion before the terminal operation. */
    const rejected = expect(first).rejects.toBe(reason)
    /** This source-departure oracle supplies the actual physical fact, distinct from local close. */
    fixture.table.retire('carrier-1', reason, true)
    await rejected
    fixture.table.accept('carrier-2', fixture.reply(fixture.frames[1]!, 19))
    await expect(second).resolves.toBe(19)
  })

  it('pre-aborted and queued-aborted calls write no call or cancel and keep the original cause', async () => {
    /** The queued and pre-abort paths share exactly the public business expectation. */
    const fixture = new CallFixture()
    /** The original reason remains the local AbortError cause. */
    const reason = new RangeError('fixture abort')
    /** This caller has already withdrawn before admission. */
    const pre = new AbortController()
    pre.abort(reason)
    await expect(
      fixture.table.invoke(
        fixture.target,
        { mode: 'request', method: 'read' },
        { signal: pre.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError', cause: reason })
    fixture.gated = true
    /** A real queued write still observes cancellation at its final handoff check. */
    const queued = new AbortController()
    /** Attach before triggering cancellation. */
    const result = expect(
      fixture.table.invoke(
        fixture.target,
        { mode: 'request', method: 'read' },
        { signal: queued.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError', cause: reason })
    queued.abort(reason)
    await result
    await fixture.release()
    expect(fixture.frames).toHaveLength(0)
  })

  it('notify resolves at physical completion and a later actual caller abort emits one cancel', async () => {
    /** No provider terminal or new acknowledgement is supplied to this notification. */
    const fixture = new CallFixture()
    /** Only this actual caller signal authorizes a post-write cancellation subscription. */
    const controller = new AbortController()
    await expect(
      fixture.table.invoke(
        fixture.target,
        { mode: 'notify', method: 'work', payload: { retained: 'business' } },
        { signal: controller.signal }
      )
    ).resolves.toBeUndefined()
    /** The original call identity must be echoed by the cancellation. */
    const call = fixture.frames[0]!
    controller.abort(new RangeError('fixture later abort'))
    await fixture.flush()
    expect(fixture.frames).toHaveLength(2)
    expect(fixture.frames[1]).toMatchObject({
      kind: RpcWireKind.cancel,
      id: call.id,
      task: call.task
    })
    expect(fixture.frames[1]).not.toHaveProperty('payload')
    expect(fixture.frames[1]).not.toHaveProperty('options')
  })

  it('a legitimate notify terminal removes its post-write cancel authority', async () => {
    /** An already existing ordered/refusal terminal may retire metadata without being awaited. */
    const fixture = new CallFixture()
    /** The caller is deliberately aborted after that actual terminal. */
    const controller = new AbortController()
    await fixture.table.invoke(
      fixture.target,
      { mode: 'notify', method: 'work' },
      { signal: controller.signal }
    )
    expect(fixture.table.accept('carrier-1', fixture.reply(fixture.frames[0]!))).toBe(true)
    controller.abort(new Error('fixture late abort'))
    await fixture.flush()
    expect(fixture.frames).toHaveLength(1)
  })

  it('forwarded notify retains its internal completion through write and abort until its real terminal', async () => {
    /** Transit already receives a real downstream terminal; no new acknowledgement is introduced. */
    const fixture = new CallFixture()
    /** The incoming provider owns this cancellation authority until downstream business ends. */
    const controller = new AbortController()
    /** Observe settlement without replacing the original internal invocation Promise. */
    const results = Promise.allSettled([
      fixture.table.invoke(
        fixture.target,
        { mode: 'notify', method: 'work' },
        {
          origin: false,
          forwardRoute: ['upstream'],
          signal: controller.signal
        }
      )
    ])
    /** Physical completion and forwarded abort must both precede actual business completion. */
    let finished = false
    void results.then(() => {
      finished = true
    })
    await fixture.flush()
    expect(finished).toBe(false)
    controller.abort(new Error('fixture forwarded abort'))
    await fixture.flush()
    expect(fixture.frames[1]?.kind).toBe(RpcWireKind.cancel)
    expect(finished).toBe(false)
    fixture.table.accept('carrier-1', fixture.reply(fixture.frames[0]!))
    expect(await results).toEqual([{ status: 'fulfilled', value: undefined }])
  })

  it('before-start cancellation waits for the original already-started result', async () => {
    /** This fixture supplies a real reply only after cancellation was physically sent. */
    const fixture = new CallFixture()
    /** The caller asks to prevent only not-yet-started provider work. */
    const controller = new AbortController()
    /** Its original promise remains pending until the original result is delivered. */
    const result = fixture.table.invoke(
      fixture.target,
      { mode: 'request', method: 'work' },
      { signal: controller.signal, cancel: 'before-start' }
    )
    await fixture.flush()
    controller.abort(new Error('fixture cancel intent'))
    await fixture.flush()
    expect(fixture.frames[1]?.kind).toBe(RpcWireKind.cancel)
    fixture.table.accept('carrier-1', fixture.reply(fixture.frames[0]!, 23))
    await expect(result).resolves.toBe(23)
  })

  it('restores remote native class, source/code, original stack and cause chain', async () => {
    /** The source is external, so restoration cannot rely on local factory metadata. */
    const fixture = new CallFixture()
    /** Native cause diagnostics must cross the flat graph unchanged. */
    const cause = Object.assign(new TypeError('fixture remote cause'), {
      source: 'fixture',
      code: 'CAUSE'
    })
    /** This source/code pair models a declared application failure. */
    const error = Object.assign(new RangeError('fixture remote', { cause }), {
      source: 'fixture',
      code: 'CASE'
    })
    /** The receiving Promise is owned before the remote terminal arrives. */
    const result = fixture.table.invoke(fixture.target, { mode: 'request', method: 'read' })
    await fixture.flush()
    /** Only direction and kind change; the full selected task remains identical. */
    const reply = fixture.reply(fixture.frames[0]!)
    fixture.table.accept('carrier-1', {
      profile: reply.profile,
      id: reply.id,
      task: reply.task,
      route: reply.route,
      kind: RpcWireKind.error,
      error: serializeRpcWireError(error, {
        report: (failure) => fixture.reports.push(failure.error)
      })
    })
    await expect(result).rejects.toBeInstanceOf(RangeError)
    await expect(result).rejects.toMatchObject({
      source: 'fixture',
      code: 'CASE',
      stack: error.stack,
      cause: { name: 'TypeError', source: 'fixture', code: 'CAUSE', stack: cause.stack }
    })
  })

  it('retries only through a complete instance and shrinks inherited time while refreshing identity', async () => {
    /** Namespace replacement and monotonic time remain explicit fixture facts. */
    const fixture = new CallFixture()
    fixture.synchronousReply = true
    fixture.failure = new Error('fixture first write')
    /** This complete caller feature, rather than CallTable, chooses exactly two attempts. */
    const retry: IRpcRetryFeature = {
      kind: 'retry',
      run: async <T>(attempt: IRpcAttempt<T>): Promise<T> => {
        try {
          return await attempt.invoke(attempt.signal, 80)
        } catch {
          fixture.tick(25)
          fixture.target = {
            ...fixture.target,
            carrierId: 'carrier-2',
            peerId: 'peer-2',
            generation: { kind: 'session', value: 2, providerId: 'peer-2' }
          }
          return attempt.invoke(attempt.signal, 80)
        }
      }
    }
    await expect(
      fixture.table.invoke(
        fixture.target,
        { mode: 'request', method: 'read' },
        { retry, remainingMs: 100 }
      )
    ).resolves.toBe(7)
    expect(fixture.frames.map((frame) => frame.route.remainingMs)).toEqual([80, 75])
    expect(fixture.frames[1]!.task.targetGeneration.value).toBe(2)
    expect(fixture.frames[1]!.id).not.toBe(fixture.frames[0]!.id)
  })

  it('prepares stream headers with the same unique allocator without sending or adding a waiter', async () => {
    /** The stream owner receives only preparation, not a second scalar call operation. */
    const fixture = new CallFixture()
    /** Preparation performs no write or provider action. */
    const prepared = fixture.table.prepare(
      fixture.target,
      { mode: 'stream', method: 'items', payload: 3 },
      { remainingMs: 50 }
    )
    expect(prepared.envelope.task.mode).toBe('stream')
    expect(prepared.remainingMs).toBe(50)
    expect(fixture.frames).toHaveLength(0)
    fixture.synchronousReply = true
    await fixture.table.invoke(fixture.target, { mode: 'request', method: 'read' })
    expect(fixture.frames[0]!.id).not.toBe(prepared.envelope.id)
    expect(fixture.table.accept('carrier-1', fixture.reply(prepared.envelope))).toBe(false)
  })
})
