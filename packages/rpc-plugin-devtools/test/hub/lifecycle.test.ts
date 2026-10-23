import { describe, expect, it } from 'vitest'
import { serializeRpcError } from '@migaia/rpc-contract/errors'
import {
  encodeRpcDevtoolsRecord,
  RpcDevtoolsErrorCode,
  RpcDevtoolsRecordFormat,
  RPC_DEVTOOLS_SOURCE
} from '../../src/contract/index.js'
import { createRpcDevtoolsHub, type IRpcDevtoolsTargetClient } from '../../src/hub/index.js'
import { deferred, drain, event, fakeTarget, until } from './helpers.js'

describe('hub lifecycle', () => {
  it('awaits pending removal cleanup when its removed-status listener reenters close', async () => {
    /** Iterator release stays pending while the status callback initiates hub-wide close. */
    const gate = deferred<void>()
    /** Capture close initiated inside iterator return or status dispatch for completion assertions. */
    let closing: Promise<void> | undefined
    /** A settled close would falsely claim no remaining owned watch resources. */
    let closed = false
    /** Iterator return reenters synchronously before handing its pending cleanup promise to the hub. */
    const target = fakeTarget([], {
      releaseGate: gate.promise,
      onRelease: () => {
        closing = hub.close().then(() => {
          closed = true
        })
      }
    })
    /** Both reentrant calls must collect the same release promise already owned by removeTarget. */
    const hub = createRpcDevtoolsHub()
    await hub.addTarget('A', target.client)
    hub.on('status', (_name, status) => {
      if (status === 'removed') {
        closing = hub.close().then(() => {
          closed = true
        })
      }
    })
    /** Removal publishes its state before asynchronous release finishes. */
    const removing = hub.removeTarget('A')
    try {
      await until(() => target.releases === 1 && closing !== undefined)
      await drain()
      expect(closed).toBe(false)
      gate.resolve(undefined)
      await removing
      await closing
      expect(closed).toBe(true)
      expect(target.releases).toBe(1)
    } finally {
      gate.resolve(undefined)
      await removing
      await hub.close()
    }
  })

  it('keeps a synchronous watch-next failure disconnected without a late connected status', async () => {
    /** Synchronous iterator failures are runtime stream failures with original identity. */
    const original = new Error('fixture synchronous next failure')
    /** Fake request methods provide valid describe/query payloads for the supported stream setup. */
    const target = fakeTarget()
    /** Reporter must observe the watch error without changing its original instance. */
    const reports: unknown[] = []
    /** A connected transition after failure would resurrect a stream that has already stopped. */
    const statuses: string[] = []
    /** Only next differs from the normal client; it throws before returning its first promise. */
    const client: IRpcDevtoolsTargetClient = {
      request: target.client.request,
      /** Return a valid async iterator whose first next fails synchronously. */
      stream() {
        return {
          /** This target owns the throwing iterator and its normal cleanup method. */
          [Symbol.asyncIterator]() {
            return {
              /** Model a supported client failure before an asynchronous read can start. */
              next() {
                throw original
              },
              /** Failed streams still release normally when the hub closes. */
              return() {
                return Promise.resolve({ done: true as const, value: undefined })
              }
            }
          }
        }
      }
    }
    /** Hub runtime failure policy must retain the disconnected state established by the watch. */
    const hub = createRpcDevtoolsHub({ onError: (error) => reports.push(error) })
    hub.on('status', (_name, status) => statuses.push(status))
    try {
      await hub.addTarget('A', client)
      expect(reports).toContain(original)
      expect(hub.status('A')).toBe('disconnected')
      expect(statuses).toEqual(['connecting', 'disconnected'])
    } finally {
      await hub.close()
    }
  })

  it('closes twice harmlessly and rejects all public calls after close with CLOSED', async () => {
    /** A live target exercises release ownership before the closed-state entry guards. */
    const target = fakeTarget()
    /** The hub must guard every public entry after one completed close. */
    const hub = createRpcDevtoolsHub()
    await hub.addTarget('A', target.client)
    await hub.close()
    await hub.close()
    expect(target.releases).toBe(1)
    /** Every method classifies the same closed state with the registered semantic code. */
    const closed = expect.objectContaining({
      source: RPC_DEVTOOLS_SOURCE,
      code: RpcDevtoolsErrorCode.closed
    })
    expect(() => hub.status()).toThrowError(closed)
    expect(() => hub.timeline()).toThrowError(closed)
    expect(() => hub.interactions()).toThrowError(closed)
    expect(() => hub.importRecord('offline', '')).toThrowError(closed)
    expect(() => hub.on('event', () => {})).toThrowError(closed)
    expect(() => hub.on('status', () => {})).toThrowError(closed)
    await expect(async () => hub.addTarget('B', target.client)).rejects.toThrowError(closed)
    await expect(async () => hub.removeTarget('A')).rejects.toThrowError(closed)
    await expect(async () => hub.stats()).rejects.toThrowError(closed)
  })

  it('reports ordered AggregateError release failures and keeps original errors first', async () => {
    /** First release failure must remain first regardless of asynchronous cleanup scheduling. */
    const first = new TypeError('fixture first release')
    /** The second original error must remain reachable as an aggregate member too. */
    const second = new RangeError('fixture second release')
    /** Reporter observes the aggregate without replacing either member instance. */
    const reports: unknown[] = []
    /** Registration order determines the cleanup order and the aggregate's original-first contract. */
    const hub = createRpcDevtoolsHub({ onError: (error) => reports.push(error) })
    await hub.addTarget('A', fakeTarget([], { releaseError: first }).client)
    await hub.addTarget('B', fakeTarget([], { releaseError: second }).client)
    /** Close's collected error must remain observable rather than being silently swallowed. */
    let failure: unknown
    try {
      await hub.close()
    } catch (error) {
      failure = error
    }
    /**
     * The report is mandatory whether close also rejects with its aggregate or resolves after
     * reporting.
     */
    const reported = reports.find((error) => error instanceof AggregateError) as
      | AggregateError
      | undefined
    expect(reported).toBeInstanceOf(AggregateError)
    expect(reported?.errors[0]).toBe(first)
    expect(reported?.errors[1]).toBe(second)
    if (failure !== undefined) expect(failure).toBe(reported)
    await hub.close()
  })

  it('reports a listener failure while still invoking later listeners', async () => {
    /** Listener code can fail; its original error must go to the hub reporter. */
    const original = new Error('fixture listener failure')
    /** Runtime failures are observed independently of the successful listeners. */
    const reports: unknown[] = []
    /** Status and event listeners both preserve dispatch after a preceding listener throws. */
    const statuses: string[] = []
    /** Successful event listener retains the original service payload for identity assertions. */
    const received: unknown[] = []
    /** All listener dispatch uses the same isolated failure policy. */
    const hub = createRpcDevtoolsHub({ onError: (error) => reports.push(error) })
    hub.on('status', () => {
      throw original
    })
    hub.on('status', (_name, status) => statuses.push(status))
    hub.on('event', () => {
      throw original
    })
    hub.on('event', (item) => received.push(item.event))
    /** One catch-up event is sufficient to exercise listener isolation. */
    const input = event(1, 1)
    await hub.addTarget('A', fakeTarget([input]).client)
    expect(statuses).toContain('connected')
    expect(received).toEqual([input])
    expect(received[0]).toBe(input)
    expect(reports).toContain(original)
    await hub.close()
  })

  it('reports describe failure with original identity and disconnected status', async () => {
    /** Remote call failure must never be rewritten into a hub configuration error. */
    const original = new Error('fixture describe failure')
    /** Reporter captures the same instance that addTarget rejects with. */
    const reports: unknown[] = []
    /** The registered target remains inspectable as disconnected after connection failure. */
    const hub = createRpcDevtoolsHub({ onError: (error) => reports.push(error) })
    await expect(
      hub.addTarget('A', fakeTarget([], { describeError: original }).client)
    ).rejects.toBe(original)
    expect(hub.status('A')).toBe('disconnected')
    expect(reports).toContain(original)
    await hub.close()
  })

  it('removes a target while describe is pending without starting a late watch', async () => {
    /** External promise controls the currently in-flight describe request. */
    const gate = deferred<void>()
    /** The target cannot complete alignment until the test releases its first remote request. */
    const target = fakeTarget([event(1, 1)], { describeGate: gate.promise })
    /** A removed target must not be resurrected by delayed connection work. */
    const hub = createRpcDevtoolsHub()
    /** Status observations distinguish removal from a forbidden late connected transition. */
    const statuses: string[] = []
    hub.on('status', (_name, status) => statuses.push(status))
    /** Hold the add operation until after remove has invalidated its target ownership. */
    const adding = hub.addTarget('A', target.client)
    await until(() => target.requests.some((request) => request.method === 'describe'))
    await hub.removeTarget('A')
    gate.resolve(undefined)
    await Promise.allSettled([adding])
    expect(hub.status('A')).toBe('removed')
    expect(statuses).toEqual(['connecting', 'removed'])
    expect(target.watchInputs).toEqual([])
    expect(hub.timeline()).toEqual([])
    await hub.close()
  })

  it('awaits asynchronous iterator return and ignores a stale watch batch after removal', async () => {
    /** Releasing the iterator remains pending until the cleanup owner finishes. */
    const gate = deferred<void>()
    /** The pending next can resolve after return so stale data isolation is observable. */
    const target = fakeTarget([], { releaseGate: gate.promise })
    /** Removed target records must not re-enter its interaction index. */
    const hub = createRpcDevtoolsHub()
    await hub.addTarget('A', target.client)
    /** Keep a completion flag separate from release initiation. */
    let completed = false
    /** Remove must await return, while its state invalidation happens before any stale delivery. */
    const removing = hub.removeTarget('A').then(() => {
      completed = true
    })
    await until(() => target.releases === 1)
    expect(completed).toBe(false)
    target.push([event(1, 1, { senderId: 'A', messageId: 'stale', trace: 'stale' })])
    await drain()
    expect(hub.timeline()).toEqual([])
    expect(hub.interactions('stale')).toEqual([])
    gate.resolve(undefined)
    await removing
    expect(completed).toBe(true)
    await hub.close()
  })

  it('supports reentrant target removal from an event listener without restoring stale records', async () => {
    /** Reentrant listener starts removal inside catch-up dispatch. */
    const removals: Promise<void>[] = []
    /** Later listeners must still observe the same successfully ingested event wrapper. */
    const seen: unknown[] = []
    /** The hub invalidates target state before resuming the interrupted insertion loop. */
    const hub = createRpcDevtoolsHub()
    hub.on('event', () => removals.push(hub.removeTarget('A')))
    hub.on('event', (item) => seen.push(item.event))
    /** A second same-page event exposes any insertion loop that ignores removed ownership. */
    const first = event(1, 1, { senderId: 'A', messageId: 'first' })
    /** This event must be skipped after the first event listener removes the target. */
    const second = event(2, 2, { senderId: 'A', messageId: 'second' })
    await hub.addTarget('A', fakeTarget([first, second]).client)
    await Promise.all(removals)
    expect(seen).toEqual([first])
    expect(hub.status('A')).toBe('removed')
    expect(hub.timeline()).toEqual([])
    expect(hub.interactions()).toEqual([])
    await hub.close()
  })

  it('serializes native offline errors through the canonical Contract owner without losing the chain', async () => {
    /** Native cause stack and semantic metadata must survive the offline-to-wire boundary. */
    const cause = new TypeError('fixture original cause')
    Object.defineProperties(cause, {
      source: { value: '@fixture/offline', enumerable: true },
      code: { value: 'ORIGINAL', enumerable: true }
    })
    /** Aggregate membership and cause both refer to the same native original error. */
    const original = new AggregateError([cause], 'fixture recorded error', { cause })
    Object.defineProperties(original, {
      source: { value: '@fixture/offline', enumerable: true },
      code: { value: 'RECORDED', enumerable: true }
    })
    /** Encode permits native errors while the hub timeline exposes the frozen wire-error type. */
    const text = encodeRpcDevtoolsRecord({
      header: RpcDevtoolsRecordFormat,
      events: [{ ...event(1, 1), error: original }]
    })
    /**
     * Public import must convert restored native errors exactly once through Contract
     * serialization.
     */
    const hub = createRpcDevtoolsHub()
    hub.importRecord('offline', text)
    /** Expected wire graph comes from its canonical owner rather than a second handwritten codec. */
    const wire = serializeRpcError(original, {
      report: (failure) => {
        throw failure.error
      }
    })
    expect(hub.timeline()[0].event.error).toEqual(wire)
    expect(hub.timeline()[0].event.error).not.toBeInstanceOf(Error)
    expect(hub.timeline()[0].event.error?.stack).toBe(original.stack)
    await hub.close()
  })
})
