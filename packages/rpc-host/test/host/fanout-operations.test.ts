import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { coreMemoryServer } from './core-fixture.ts'
import { idempotencyFeature } from '@migaia/rpc-host/plugins/idempotency'
import { key, fanout, items, containsCause, nativeHosts } from './fanout-fixture.ts'

it.each([false, true])(
  'honors an explicit native grant independently of other payload binary (binary=%s)',
  async (withBinary) => {
    /** Real MessagePorts prove detachment under the existing HMAC-authenticated public path. */
    const pair = await nativeHosts({ note: () => 'accepted' })
    /**
     * Explicit transfer may hand off a backing independently from whether the receiver references
     * it.
     */
    const transferred = new ArrayBuffer(3)
    /** This ungranted small backing belongs to signed-inline policy, not the explicit grant. */
    const payload = withBinary ? Uint8Array.of(1) : undefined
    try {
      expect(
        await pair.caller.native.send('native-1', 'note', payload, { transfer: [transferred] })
      ).toBe('accepted')
      expect(transferred.byteLength).toBe(0)
    } finally {
      await Promise.all([pair.caller.close(), pair.provider.close()])
      pair.writes.mockRestore()
      pair.replies.mockRestore()
    }
  }
)

it('context broadcasts retain each selected peer when another name equals its instanceId', async () => {
  /** A provider dispatches through the genuine business context and accepted namespace index. */
  const server = coreMemoryServer('notification-hub')
  /** Each receiver records actual provider execution, independently of physical write completion. */
  const delivered: string[] = []
  /** Fire-and-report failures remain independently visible. */
  const reports: unknown[] = []
  /** The original caller is excluded while the other two native connections receive one call each. */
  const host = await createRpcHost({
    ...server.options,
    report: (error) => reports.push(error),
    provide: {
      broadcast: (_value, context: IRpcContext) => {
        context.dispatchTo({ method: 'notice', data: 42 })
        return true
      }
    }
  })
  /** Logical name priority must not reinterpret an already selected sibling's physical identity. */
  const first = await server.connect(
    'first',
    { provide: { notice: () => delivered.push('first') } },
    'second-name'
  )
  /** This peer's display name deliberately matches the first peer's separate instance address. */
  const second = await server.connect(
    'second-name',
    { provide: { notice: () => delivered.push('second') } },
    'second-id'
  )
  /** The initiating public Host has its own identity and notification provider. */
  const caller = await server.connect('caller', {
    provide: { notice: () => delivered.push('caller') }
  })
  try {
    expect(await caller.host.memory.send('notification-hub', 'broadcast')).toBe(true)
    await nextTurn()
    expect(delivered).toEqual(['first', 'second'])
    expect(reports).toEqual([])
  } finally {
    await Promise.all([caller.host.close(), second.host.close(), first.host.close(), host.close()])
  }
})

it('reports a missing directed dispatch synchronously once on the genuine public namespace', async () => {
  /** Only the actual configured public reporter contributes the original diagnostic. */
  const reports: unknown[] = []
  /** A cold real listener publishes the namespace without manufacturing a target connection. */
  const server = coreMemoryServer('missing-dispatch-server')
  /** Native installation still owns the actual namespace and its directed target selection. */
  const host = await createRpcHost({
    ...server.options,
    report: (error) => reports.push(error)
  })
  try {
    expect(host.memory.dispatch('not-direct', 'value')).toBeUndefined()
    expect(reports).toEqual([expect.objectContaining({ code: 'TARGET_UNKNOWN' })])
    /** A later turn must not report the same synchronous selection failure a second time. */
    await nextTurn()
    expect(reports).toHaveLength(1)
  } finally {
    await host.close()
  }
})

describe('host direct-target broadcast operations', () => {
  it('streamTo selects one actual target and preserves lazy iterator admission', async () => {
    /** Two accepted sources share the same real namespace and independent provider state. */
    const server = coreMemoryServer('direct-stream-server')
    /** The original public Host owns target selection and stream credit. */
    const host = await createRpcHost(server.options)
    /** Only the explicitly selected original provider may begin iteration. */
    const firstCalls = vi.fn()
    /** A sibling source must remain untouched by the directed stream. */
    const secondCalls = vi.fn()
    /** Both methods are real compiled provider generators, not precomputed iterators. */
    const first = await server.connect('first', {
      provide: {
        sequence: function* () {
          firstCalls()
          yield 1
          yield 2
        }
      }
    })
    /** The other accepted peer advertises the same method to expose accidental fanout. */
    const second = await server.connect('second', {
      provide: {
        sequence: function* () {
          secondCalls()
          yield 3
        }
      }
    })
    try {
      /** Construction fixes the selected generation without opening its lazy business call. */
      const stream = host.memory.streamTo('first', 'sequence')
      expect(firstCalls).not.toHaveBeenCalled()
      expect(secondCalls).not.toHaveBeenCalled()
      expect(stream[Symbol.asyncIterator]()).toBe(stream)
      expect(await items(stream)).toEqual([1, 2])
      expect(firstCalls).toHaveBeenCalledTimes(1)
      expect(secondCalls).not.toHaveBeenCalled()
    } finally {
      await second.host.close()
      await first.host.close()
      await host.close()
    }
  })

  it('executes all five operations for zero, one and two sessions on one actual server endpoint', async () => {
    /** The server's one listener accepts additional channels without replacing its endpoint. */
    const server = coreMemoryServer('matrix-server')
    /** Actual application notification effects are distinct from physical-send settlement. */
    const notifications: string[] = []
    /** Each notification barrier observes real provider execution without sleeps. */
    const firstNotified = deferred<void>()
    /** The second session has an independent provider execution barrier. */
    const secondNotified = deferred<void>()
    /** A later directed dispatch must invoke only the first target's real provider. */
    const firstDispatched = deferred<void>()
    /** Reports retain dispatch failure while request/notify failures remain on returned Promises. */
    const reports: unknown[] = []
    /** The host is the public new entry, backed by one actual native installation. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [idempotencyFeature(), server.transport],
      report: (error) => {
        reports.push(error)
      }
    })
    /** Every returned connection is closed even if a later matrix assertion fails. */
    const clients: Awaited<ReturnType<typeof server.connect>>[] = []
    try {
      for (const empty of [
        await host.memory.request('value'),
        await host.memory.notify('note'),
        host.memory.stream('sequence'),
        await host.memory.group([{ method: 'value' }]),
        await host.memory.outcome('absent')
      ]) {
        /** Zero peers means no scalar placeholder and no physical request. */
        const result = fanout(empty)
        expect(Object.keys(result.fulfilled)).toEqual([])
        expect(Object.keys(result.rejected)).toEqual([])
      }
      /** The first peer supplies actual business methods for every admitted mode. */
      const first = await server.connect('first', {
        plugins: [idempotencyFeature()],
        provide: {
          value: (value?: unknown) => `first:${value ?? 'none'}`,
          note: () => {
            notifications.push('first')
            firstNotified.resolve()
            if (notifications.filter((name) => name === 'first').length === 3)
              firstDispatched.resolve()
          },
          sequence: async function* () {
            yield 'first:1'
            yield 'first:2'
          }
        }
      })
      clients.push(first)
      expect(await host.memory.request('value', 1)).toBe('first:1')
      expect(await host.memory.notify('note')).toBeUndefined()
      await firstNotified.promise
      expect(await items(host.memory.stream('sequence') as AsyncIterable<unknown>)).toEqual([
        'first:1',
        'first:2'
      ])
      expect(
        await host.memory.group([{ method: 'value', payload: 2 }], {
          idempotencyKey: 'single-group'
        })
      ).toEqual([{ state: 'success', result: 'first:2' }])
      expect(await host.memory.outcome('single-group')).toMatchObject({
        state: 'done',
        outcome: {
          mode: 'group',
          completion: { ok: true, result: [{ state: 'success', result: 'first:2' }] }
        }
      })
      /** Punctuation in a peer name must remain one canonical target key. */
      const secondName = 'second["peer"]'
      /** The second accepted directory contributes its own independent application handlers. */
      const second = await server.connect(secondName, {
        plugins: [idempotencyFeature()],
        provide: {
          value: (value?: unknown) => `second:${value ?? 'none'}`,
          note: () => {
            notifications.push('second')
            secondNotified.resolve()
          },
          sequence: async function* () {
            yield 'second:1'
          }
        }
      })
      clients.push(second)
      expect(fanout(await host.memory.request('value', 3))).toEqual({
        fulfilled: { [key('first')]: 'first:3', [key(secondName)]: 'second:3' },
        rejected: {}
      })
      expect(fanout(await host.memory.notify('note'))).toEqual({
        fulfilled: { [key('first')]: undefined, [key(secondName)]: undefined },
        rejected: {}
      })
      await secondNotified.promise
      expect(notifications.toSorted()).toEqual(['first', 'first', 'second'])
      /** Broadcast stream creates independent original iterators rather than one shared consumer. */
      const streams = fanout<AsyncIterable<unknown>>(host.memory.stream('sequence'))
      expect(streams.rejected).toEqual({})
      expect(Object.keys(streams.fulfilled)).toEqual([key('first'), key(secondName)])
      expect(await items(streams.fulfilled[key('first')]!)).toEqual(['first:1', 'first:2'])
      expect(await items(streams.fulfilled[key(secondName)]!)).toEqual(['second:1'])
      expect(
        fanout(
          await host.memory.group([{ method: 'value', payload: 4 }], {
            idempotencyKey: 'both-group'
          })
        )
      ).toEqual({
        fulfilled: {
          [key('first')]: [{ state: 'success', result: 'first:4' }],
          [key(secondName)]: [{ state: 'success', result: 'second:4' }]
        },
        rejected: {}
      })
      /** Each result belongs to the queried target's actual canonical outcome store. */
      const outcomes = fanout<{ state: string; outcome: { completion: { result: unknown } } }>(
        await host.memory.outcome('both-group')
      )
      expect(outcomes.rejected).toEqual({})
      expect(outcomes.fulfilled[key('first')]).toMatchObject({
        state: 'done',
        outcome: { completion: { result: [{ state: 'success', result: 'first:4' }] } }
      })
      expect(outcomes.fulfilled[key(secondName)]).toMatchObject({
        state: 'done',
        outcome: { completion: { result: [{ state: 'success', result: 'second:4' }] } }
      })
      expect(await host.memory.send('first', 'value', 5)).toBe('first:5')
      /** Directed dispatch returns void while its selected provider still executes asynchronously. */
      const otherWrites = vi.spyOn(second.pair[0], 'write')
      expect(host.memory.dispatch('first', 'note')).toBeUndefined()
      await firstDispatched.promise
      await nextTurn()
      expect(otherWrites).not.toHaveBeenCalled()
      expect(notifications.toSorted()).toEqual(['first', 'first', 'first', 'second'])
      otherWrites.mockRestore()
      await expect(host.memory.send('not-direct', 'value')).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
      host.memory.dispatch('not-direct', 'value')
      expect(reports).toEqual([expect.objectContaining({ code: 'TARGET_UNKNOWN' })])
      /**
       * A legal punctuation-bearing peer name remains usable through a normal explicit provider
       * alias.
       */
      host.provide({ relayed: host.memory.peers[secondName]!.value })
      /** A third actual listen session still borrows the same original server endpoint. */
      const third = await server.connect('third', {
        plugins: [idempotencyFeature()],
        provide: { value: () => 'third' }
      })
      clients.push(third)
      expect(await host.memory.send('third', 'value')).toBe('third')
      expect(await third.host.memory.send('matrix-server', 'relayed', 6)).toBe('second:6')
    } finally {
      for (const client of clients.reverse()) await client.host.close()
      await host.close()
    }
  })

  it.each(['request', 'notify', 'group', 'outcome'] as const)(
    '%s isolates one actual physical send failure from the other target settlement',
    async (operation) => {
      /** Both sessions are fully accepted before the original physical write is made to fail. */
      const server = coreMemoryServer(`failure-${operation}`)
      /** Provider invocation distinguishes a fulfilled send from merely exposing a method property. */
      const executed = deferred<void>()
      /** The host contains the same one canonical endpoint throughout this operation. */
      const host = await createRpcHost({
        ...server.options,
        plugins: [idempotencyFeature(), server.transport]
      })
      /** A's source fails locally, without closing the independently live B source. */
      const first = await server.connect('first', {
        plugins: [idempotencyFeature()],
        provide: { value: () => 'first', note: () => undefined }
      })
      /** B's actual provider must still execute and settle normally. */
      const second = await server.connect('second', {
        plugins: [idempotencyFeature()],
        provide: {
          value: () => {
            executed.resolve()
            return 'second'
          },
          note: () => {
            executed.resolve()
          }
        }
      })
      /** The same native error remains reachable in the local target's rejected record. */
      const original = new RangeError('selected physical write failed')
      /** Failure is injected into the existing actual sender, after successful native handshakes. */
      const write = vi.spyOn(first.pair[0], 'write').mockImplementation(() => {
        throw original
      })
      try {
        /** Every operation uses the same public facade; no fake peer supplies a precomputed result. */
        const value =
          operation === 'request'
            ? await host.memory.request('value')
            : operation === 'notify'
              ? await host.memory.notify('note')
              : operation === 'group'
                ? await host.memory.group([{ method: 'value' }])
                : await host.memory.outcome('unknown-key')
        /** Fanout retains exact canonical keys even when only one target rejects. */
        const result = fanout(value)
        expect(Object.keys(result.rejected)).toEqual([key('first')])
        expect(Object.keys(result.fulfilled)).toEqual([key('second')])
        expect(containsCause(result.rejected[key('first')], original)).toBe(true)
        if (operation === 'request') expect(result.fulfilled[key('second')]).toBe('second')
        else if (operation === 'group')
          expect(result.fulfilled[key('second')]).toEqual([{ state: 'success', result: 'second' }])
        else if (operation === 'outcome')
          expect(result.fulfilled[key('second')]).toMatchObject({ state: 'unknown' })
        else expect(result.fulfilled[key('second')]).toBeUndefined()
        if (operation !== 'outcome') await executed.promise
      } finally {
        write.mockRestore()
        await second.host.close()
        await first.host.close()
        await host.close()
      }
    }
  )

  it('a failing returned stream does not cancel the independently successful sibling iterator', async () => {
    /** Both original provider iterators run through real host stream admission and credit control. */
    const server = coreMemoryServer('stream-isolation')
    /** The host remains one endpoint while two independent physical sessions supply generators. */
    const host = await createRpcHost(server.options)
    /** A's failure occurs after yielding, so its iterator already exists in fulfilled. */
    const first = await server.connect('first', {
      provide: {
        sequence: async function* () {
          yield 1
          throw new RangeError('stream business failure')
        }
      }
    })
    /** B must finish after A's failure without cancellation or lost items. */
    const second = await server.connect('second', {
      provide: {
        sequence: async function* () {
          yield 2
          yield 3
        }
      }
    })
    try {
      /** Iterator creation succeeds for both; a later generator error belongs to that iterator. */
      const streams = fanout<AsyncIterable<unknown>>(host.memory.stream('sequence'))
      expect(streams.rejected).toEqual({})
      expect(Object.keys(streams.fulfilled)).toEqual([key('first'), key('second')])
      await expect(items(streams.fulfilled[key('first')]!)).rejects.toMatchObject({
        message: 'stream business failure'
      })
      expect(await items(streams.fulfilled[key('second')]!)).toEqual([2, 3])
    } finally {
      await second.host.close()
      await first.host.close()
      await host.close()
    }
  })

  it('notify awaits the original physical write and does not await or receive a business reply', async () => {
    /** The provider deliberately stays in progress after its notification has been delivered. */
    const businessEntered = deferred<void>()
    /** Caller-owned release makes remote business completion independently observable. */
    const releaseBusiness = deferred<void>()
    /** Provider completion proves that no response frame appears even after the handler settles. */
    const businessDone = deferred<void>()
    /** A real native-style memory source exposes its original physical completion Promise. */
    const server = coreMemoryServer('notify-send')
    /** One target returns scalar void while preserving the same canonical sender owner. */
    const host = await createRpcHost(server.options)
    /** The actual provider receives the notification without returning an acknowledgement. */
    const client = await server.connect('client', {
      provide: {
        note: async () => {
          businessEntered.resolve()
          await releaseBusiness.promise
          businessDone.resolve()
        }
      }
    })
    /** Hold only physical completion; the actual existing transport still performs delivery. */
    const physicalEntered = deferred<void>()
    /** The caller's notify Promise must remain pending until this original write completes. */
    const releasePhysical = deferred<void>()
    /**
     * Capture the real method through an arrow, preserving its original receiver-free
     * implementation.
     */
    const original = client.pair[0].write
    /** Actual provider-to-caller frames remain observable independently of business execution. */
    const replies = vi.spyOn(client.pair[1], 'write')
    /** One explicit write context lends the original completion and independent fixture barriers. */
    const heldPhysical = { original, entered: physicalEntered, release: releasePhysical }
    /** Only this current public notify's one actual write is held. */
    const write = vi.spyOn(client.pair[0], 'write').mockImplementationOnce((frame, options) =>
      heldPhysical.original(frame, options).then(() => {
        heldPhysical.entered.resolve()
        return heldPhysical.release.promise
      })
    )
    try {
      /** Settlement observation is registered before the native write or provider can run. */
      let settled = false
      /** No request/reply channel is substituted for the new facade notification. */
      const pending = host.memory.notify('note').then((result) => {
        settled = true
        return result
      })
      await physicalEntered.promise
      await businessEntered.promise
      expect(settled).toBe(false)
      releasePhysical.resolve()
      expect(await pending).toBeUndefined()
      releaseBusiness.resolve()
      await businessDone.promise
      await nextTurn()
      expect(replies).not.toHaveBeenCalled()
    } finally {
      releasePhysical.resolve()
      releaseBusiness.resolve()
      write.mockRestore()
      replies.mockRestore()
      await client.host.close()
      await host.close()
    }
  })

  it('notify transfers an actual native backing through postMessage and preserves native write failure cause', async () => {
    /**
     * The receiver records its actual restored business backing, rather than inspecting a wire
     * marker.
     */
    const received = deferred<unknown>()
    /** Both hosts use real canonical MessagePort resources and public host/plugin entries. */
    const pair = await nativeHosts({
      note: (value: unknown) => {
        received.resolve(value)
      }
    })
    try {
      /** The complete signed backing exceeds inlining while retaining the original business bytes. */
      const backing = new ArrayBuffer(16385)
      /** Independent expected bytes retain ArrayBuffer delivery and the complete zero-filled suffix. */
      const expected = new Uint8Array(16385)
      expected[0] = 42
      new Uint8Array(backing).set(expected)
      await pair.caller.native.notify('note', backing, { transfer: [backing] })
      expect(backing.byteLength).toBe(0)
      expect(pair.writes.mock.calls.some(([, transfer]) => transfer?.includes(backing))).toBe(true)
      /** Canonical restoration delivers an actual ArrayBuffer with its original bytes. */
      const value = await received.promise
      expect(value).toBeInstanceOf(ArrayBuffer)
      expect(new Uint8Array(value as ArrayBuffer)).toEqual(expected)
      await nextTurn()
      expect(pair.replies).not.toHaveBeenCalled()
      /**
       * A native postMessage exception must reject locally with the exact original on its cause
       * path.
       */
      const original = new RangeError('native postMessage refused')
      pair.writes.mockImplementationOnce(() => {
        throw original
      })
      /** Catch at the caller only; no hand-written transport Promise simulates the failure result. */
      const failure = await pair.caller.native.notify('note', 1).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
      expect(containsCause(failure, original)).toBe(true)
    } finally {
      pair.writes.mockRestore()
      pair.replies.mockRestore()
      await pair.caller.close()
      await pair.provider.close()
      pair.port1.close()
      pair.port2.close()
    }
  })
})
