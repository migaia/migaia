import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRpcHost } from '@migaia/rpc-host'
import { limitsFeature, type IRpcProviderRejection } from '@migaia/rpc-host/plugins/limits'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import { coreMemoryServer } from '../../host/core-fixture.ts'
import { LimitsGovernor } from '../../../dist/features/limits/governor.js'

/** One real business hold keeps fixture state in an explicit owner rather than captured callbacks. */
class HeldBusiness {
  /** First entry proves the actual provider owns the original concurrency lease. */
  readonly entered = deferred<void>()
  /** The original business completion alone releases work and its admission lease. */
  readonly release = deferred<void>()
  /** Public provider call counts remain observable without a private dispatcher spy. */
  readonly invoke = vi.fn(async () => {
    this.entered.resolve()
    await this.release.promise
    return 'done'
  })
}

/** Original request/notify refusal behavior now runs through real public namespaces and flow setup. */
describe('limits provider concurrency observer', () => {
  it.each(['none', 'ok', 'throw', 'reject'] as const)(
    'preserves request and one-way refusals with observer: %s',
    async (mode) => {
      /** Native observer failures retain their exact original object under the INTERNAL wrapper. */
      const original = new Error('observer fixture failure')
      /** The callback itself never sees the held request or its secret fixture payload. */
      const observer = vi.fn((_rejection: IRpcProviderRejection) => {
        if (mode === 'throw') throw original
        if (mode === 'reject') return Promise.reject(original)
      })
      /** The public reporter also receives no-caller notify failures under the new error policy. */
      const diagnostics: unknown[] = []
      /** Real provider activity remains pending until the fixture explicitly completes it. */
      const business = new HeldBusiness()
      /** Existing native carrier/codec fixture is reused without another transport abstraction. */
      const listener = coreMemoryServer('overload-server')
      /** Limits is a real native flow install before the existing transport startup. */
      const server = await createRpcHost({
        ...listener.options,
        plugins: [
          limitsFeature({
            maxGlobal: 1,
            maxPerPeer: 1,
            ...(mode === 'none' ? {} : { onRejected: observer })
          }),
          ...listener.options.plugins!
        ],
        provide: { hold: business.invoke },
        report: (error) => diagnostics.push(error)
      })
      /** The public client decodes actual correlated terminals over the same carrier pair. */
      const client = await listener.connect('overload-client')
      /** Capture the original pending call before issuing any refusal. */
      const first = client.host.memory.request('hold', null)
      try {
        await business.entered.promise
        for (let attempt = 0; attempt < 2; attempt += 1)
          await expect(client.host.memory.request('hold', null)).rejects.toMatchObject({
            code: 'OVERLOADED'
          })
        await client.host.memory.notify('hold', 'secret-fixture-payload')
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(observer).toHaveBeenCalledTimes(mode === 'none' ? 0 : 3)
        for (const [rejection] of observer.mock.calls) {
          expect(Object.keys(rejection).sort()).toEqual([
            'controllerKey',
            'method',
            'reason',
            'verifiedPeerKey'
          ])
          expect(rejection).toMatchObject({ method: 'hold', reason: 'concurrency' })
          expect(JSON.stringify(rejection)).not.toContain('secret-fixture-payload')
          expect(Object.isFrozen(rejection)).toBe(true)
        }
        expect(business.invoke).toHaveBeenCalledTimes(1)
        /** Wire v2 changes the frame shape; the original two refusals and no notify ACK remain. */
        const replies = client.pair[0].written.filter(
          (frame) => frame.kind === 'error' && frame.task.method === 'hold'
        )
        expect(replies).toHaveLength(2)
        for (const response of replies) {
          if (response.kind !== 'error') continue
          expect(deserializeRpcWireError(response.error)).toMatchObject({
            code: 'OVERLOADED',
            message: 'Provider admission limit reached'
          })
        }
        /**
         * The deleted hooks.failure total is retired; this new channel explicitly selects observer
         * diagnostics.
         */
        const reports = diagnostics.filter(
          (error) => (error as { code?: string }).code === 'INTERNAL'
        )
        if (mode === 'throw' || mode === 'reject') {
          expect(reports).toHaveLength(3)
          for (const report of reports) {
            expect(report).toMatchObject({ code: 'INTERNAL', source: 'rpc.endpoint' })
            expect((report as Error).cause).toBe(original)
          }
        } else expect(reports).toEqual([])
        business.release.resolve()
        await expect(first).resolves.toBe('done')
      } finally {
        business.release.resolve()
        await first.catch(() => undefined)
        await client.host.close()
        await server.close()
      }
    }
  )
})

describe('limits accepted host policy', () => {
  it('shares the original global admission scope across two actual accepted sessions', async () => {
    /** An ordinary public method occupies the same global capacity across both physical sources. */
    const entered = deferred<void>()
    /** Original business completion controls lease release independently from request settlement. */
    const release = deferred<void>()
    /** Rejections retain the existing local reason channel. */
    const onRejected = vi.fn()
    /** The original value and provider call count survive the fixture's connection change. */
    const business = vi.fn(async (value: unknown) => {
      if (value === 1) {
        entered.resolve()
        await release.promise
      }
      return value
    })
    /** Both connections enter the same public server with one optional quota owner. */
    const listener = coreMemoryServer('server')
    /** Cold native plugin order installs optional policy before transport startup. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [
        limitsFeature({ maxGlobal: 1, maxPerPeer: 1, onRejected }),
        ...listener.options.plugins!
      ],
      provide: { business }
    })
    /** The original two clients have independent native source identity. */
    const first = await listener.connect('first')
    /** A second genuine physical source cannot bypass the shared global lease. */
    const second = await listener.connect('second')
    /** Original Promise remains active while the second client is refused. */
    const pending = first.host.memory.request('business', 1)
    try {
      await Promise.race([entered.promise, pending])
      await expect(second.host.memory.request('business', 2)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(business).toHaveBeenCalledTimes(1)
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: 'concurrency' }))
      release.resolve()
      expect(await pending).toBe(1)
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(await second.host.memory.request('business', 2)).toBe(2)
      expect(business).toHaveBeenCalledTimes(2)
    } finally {
      release.resolve()
      await pending.catch(() => undefined)
      await first.host.close()
      await second.host.close()
      await server.close()
    }
  })

  it('rejects oversized scalar and stream inputs before business starts while another session stays usable', async () => {
    /** The original scalar and generator call counts prove quota checks happen before business. */
    const scalar = vi.fn((value: unknown) => value)
    /** This is the original one-item real generator, not a stream transport fixture. */
    const stream = vi.fn(async function* (value: unknown) {
      yield value
    })
    /** Existing native memory carrier fixture runs the same public namespace for both peers. */
    const listener = coreMemoryServer('server')
    /** Only this installed plugin contributes the original payload policy. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [limitsFeature({ maxPayloadBytes: 4096 }), ...listener.options.plugins!],
      provide: { scalar, stream }
    })
    /** Two genuine client sources retain isolation after one input is refused. */
    const first = await listener.connect('first')
    /** Independent accepted source remains usable. */
    const second = await listener.connect('second')
    try {
      await expect(first.host.memory.request('scalar', 'x'.repeat(5000))).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      await expect(
        (
          first.host.memory.stream('stream', 'x'.repeat(5000)) as AsyncIterableIterator<unknown>
        ).next()
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(scalar).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
      expect(await second.host.memory.request('scalar', 42)).toBe(42)
      /** The actual public iterator retains its original item and final terminal assertions. */
      const iterator = second.host.memory.stream('stream', 7) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toMatchObject({ done: false, value: 7 })
      expect(await iterator.next()).toMatchObject({ done: true })
    } finally {
      await first.host.close()
      await second.host.close()
      await server.close()
    }
  })

  it('reserves an entire group in the original rate bucket and does not charge prepaid members twice', async () => {
    /** Only actual application calls consume rate credit after the old implicit describe retired. */
    const business = vi.fn((value: unknown) => value)
    /** A separate one-off business fixture replaces the retired implicit describe's original debit. */
    const listener = coreMemoryServer('server')
    /** The same three-credit policy exercises the original remaining two-credit group boundary. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [limitsFeature({ maxCallsPerMinute: 3 }), ...listener.options.plugins!],
      provide: { business, warmup: () => null }
    })
    /** This genuine native source uses only the new public namespace. */
    const client = await listener.connect('client')
    try {
      await client.host.memory.request('warmup')
      await expect(
        client.host.memory.group([
          { method: 'business', payload: 1 },
          { method: 'business', payload: 2 },
          { method: 'business', payload: 3 }
        ])
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(business).not.toHaveBeenCalled()
      expect(
        await client.host.memory.group([
          { method: 'business', payload: 1 },
          { method: 'business', payload: 2 }
        ])
      ).toMatchObject([
        { state: 'success', result: 1 },
        { state: 'success', result: 2 }
      ])
      expect(business).toHaveBeenCalledTimes(2)
      await expect(client.host.memory.request('business', 3)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(business).toHaveBeenCalledTimes(2)
    } finally {
      await client.host.close()
      await server.close()
    }
  })
})

describe('limits governor retirement reasons', () => {
  it('retires quota violations with the exact original refusal and explicit liquidation kind', () => {
    /** The existing deterministic scheduler executes the original deferred retirement callback. */
    const scheduler = createManualScheduler()
    /** Session retirement is borrowed unchanged; this assertion observes its genuine producer. */
    const retire = vi.fn(async () => undefined)
    /** One original governor owns the rate bucket and violation threshold. */
    const governor = new LimitsGovernor(
      'quota-source',
      { maxCallsPerMinute: 1, violationLimit: 1 },
      { scheduler, retire, report: () => undefined, release: () => undefined }
    )
    governor.reserve([null])
    /** Catch retains identity of the actual error thrown by the quota admission owner. */
    let original: unknown
    try {
      governor.reserve([null])
    } catch (error) {
      original = error
    }
    expect(original).toMatchObject({ code: 'OVERLOADED' })
    scheduler.advance(0)
    expect(retire).toHaveBeenCalledExactlyOnceWith('quota-source', original, 'liquidated')
    governor.close()
  })

  it('passes the exact proven deadline object to liquidation without changing its cause', () => {
    /** Timeout provenance is checked by the existing lease before this governor entry. */
    const original = new Error('original provider deadline', { cause: new Error('business wait') })
    /** Native scheduling and retirement are the same collaborators used by installed policy. */
    const scheduler = createManualScheduler()
    /** This receipt captures the original port arguments, not a reconstructed diagnostic. */
    const retire = vi.fn(async () => undefined)
    /** Only the selected consecutive-timeout threshold can invoke this retirement. */
    const governor = new LimitsGovernor(
      'deadline-source',
      { maxConsecutiveTimeouts: 1 },
      { scheduler, retire, report: () => undefined, release: () => undefined }
    )
    governor.timeout(original)
    scheduler.advance(0)
    expect(retire).toHaveBeenCalledExactlyOnceWith('deadline-source', original, 'liquidated')
    governor.close()
  })

  it('retires an actually ready quiet source with an explicit idle lifecycle reason', () => {
    /** Idle scheduling shares the original monotonic deadline and creates no parallel timer. */
    const scheduler = createManualScheduler()
    /** The real owner supplies both the local reason and the transport-neutral retirement kind. */
    const retire = vi.fn(async () => undefined)
    /** No active business lease prevents this configured idle deadline. */
    const governor = new LimitsGovernor(
      'idle-source',
      { idleTimeoutMs: 10 },
      { scheduler, retire, report: () => undefined, release: () => undefined }
    )
    governor.ready()
    scheduler.advance(10)
    expect(retire).toHaveBeenCalledExactlyOnceWith(
      'idle-source',
      expect.objectContaining({ code: 'ENDPOINT_DISPOSED', message: 'Connection idle timeout' }),
      'idle'
    )
    expect(scheduler.pendingCount).toBe(0)
    governor.close()
  })
})

it('keeps one idle deadline task while inbound activity advances its due time', () => {
  /** Count scheduling operations through the same deterministic scheduler used by the governor. */
  const scheduler = createManualScheduler()
  const schedule = vi.spyOn(scheduler, 'schedule')
  /** An idle retirement remains the ordinary existing source port. */
  const retire = vi.fn(async () => undefined)
  const governor = new LimitsGovernor(
    'activity-source',
    { idleTimeoutMs: 10 },
    { scheduler, retire, report: () => undefined, release: () => undefined }
  )
  try {
    governor.ready()
    for (let frame = 0; frame < 4; frame++) {
      scheduler.advance(1)
      governor.touch()
    }
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(6)
    expect(retire).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledTimes(2)
    scheduler.advance(4)
    expect(retire).toHaveBeenCalledExactlyOnceWith(
      'activity-source',
      expect.objectContaining({ message: 'Connection idle timeout' }),
      'idle'
    )
    expect(scheduler.pendingCount).toBe(0)
  } finally {
    governor.close()
    schedule.mockRestore()
  }
})

it('queues one liquidation when several refusals reach the same violation threshold', () => {
  /** A burst can add several violations before the original deferred retirement begins. */
  const scheduler = createManualScheduler()
  /** The first threshold refusal remains the exact reason selected for physical retirement. */
  const retire = vi.fn(async () => undefined)
  const governor = new LimitsGovernor(
    'burst-source',
    { violationLimit: 1 },
    { scheduler, retire, report: () => undefined, release: () => undefined }
  )
  const first = new Error('first threshold refusal')
  try {
    governor.violate(first)
    governor.violate(new Error('later refusal'))
    governor.violate(new Error('last refusal'))
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(0)
    expect(retire).toHaveBeenCalledExactlyOnceWith('burst-source', first, 'liquidated')
  } finally {
    governor.close()
  }
})
