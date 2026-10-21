import { describe, expect, it, vi } from 'vitest'
import {
  createEventChannel,
  createEventHub,
  EventAdmissionPolicy,
  EventDelivery,
  EventDispatchPolicy,
  EventSubscriberErrorCode,
  invokeEachLive,
  invokeTaskSettled,
  withSnapshotEntries,
  type IEventChannelLike
} from '../src/index.js'

describe('value delivery', () => {
  it('preserves payload identity and mixed listener order across all dispatch entry points', () => {
    /** The payload must cross every entry point unchanged, alongside context listeners. */
    const payload = { label: 'payload' }
    /** Captures invocation order without exposing either registration's ownership. */
    const order: string[] = []
    /** Both argument modes use the same owner list and snapshot invocation function. */
    const channel = createEventChannel<typeof payload>()
    channel.subscribe((event) => {
      expect(event.value).toBe(payload)
      order.push('context')
    })
    channel.subscribe(
      (value) => {
        /** Assignment proves the listener receives the payload type rather than a context. */
        const typed: typeof payload = value
        expect(typed).toBe(payload)
        order.push('value')
      },
      { delivery: EventDelivery.value }
    )

    channel.publish(payload)
    withSnapshotEntries(channel, payload, (entries) => {
      for (const entry of entries) entry.invoke()
    })
    invokeEachLive(channel, payload, (entry) => {
      entry.invoke()
    })

    expect(order).toEqual(['context', 'value', 'context', 'value', 'context', 'value'])
  })

  it('forwards value delivery through styled channels, chains, structural sources, and Hub chains', () => {
    /** Literal style aliases must preserve payload inference in both independent and chained calls. */
    const channel = createEventChannel<number>({ style: 'listen-fire' })
    /** Records each public entry point's payload-only delivery. */
    const values: number[] = []
    /** Structural subscription contracts expose the same explicit value overload. */
    const source: IEventChannelLike<number> = channel
    source.subscribe(
      (value) => {
        values.push(value)
      },
      { delivery: EventDelivery.value }
    )
    /** One chain owns both its value listener and its default context listener. */
    const chain = channel.listen(
      (value) => {
        values.push(value)
      },
      { delivery: EventDelivery.value }
    )
    chain.listen(
      (event) => {
        values.push(event.value)
      },
      { delivery: EventDelivery.context }
    )
    channel.fire(7)
    expect(values).toEqual([7, 7, 7])
    chain.unlisten()
    expect(channel.size).toBe(1)

    /** Finite Hub chains retain their key-specific payload types in both delivery modes. */
    const hub = createEventHub<{ count: number; label: string; ready: boolean }>({
      style: 'on-emit'
    })
    /** Mixed payload types make a lost key association visible to the type checker. */
    const received: Array<number | string | boolean> = []
    /** Hub aliases and chained aliases use the same third options argument. */
    const hubChain = hub
      .on(
        'count',
        (value) => {
          received.push(value)
        },
        { delivery: EventDelivery.value }
      )
      .on(
        'label',
        (value) => {
          received.push(value)
        },
        { delivery: EventDelivery.value }
      )
      .on('ready', (event) => {
        received.push(event.value)
      })
    hub.emit('count', 8)
    hub.emit('label', 'ready')
    hub.emit('ready', true)
    expect(received).toEqual([8, 'ready', true])
    hubChain.off()
    expect(hub.size()).toBe(0)
  })

  it('keeps task selection and unique conflicts on the existing registration owner', async () => {
    /** Unique mode still shares listener identity and rejects incompatible registration metadata. */
    const channel = createEventChannel<number, number>({
      admissionPolicy: EventAdmissionPolicy.unique
    })
    /** A zero-argument listener is valid in both modes, making delivery the only conflict. */
    const listener = vi.fn(() => 11)
    /** The first handle and a matching duplicate own the same registration. */
    const first = channel.subscribe(listener, { delivery: EventDelivery.value, taskId: 'chosen' })
    first.subscribe(listener, { delivery: EventDelivery.value, taskId: 'chosen' })
    expect(channel.size).toBe(1)
    expect(() => channel.subscribe(listener, { taskId: 'chosen' })).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
    )
    expect(() =>
      first.subscribe(listener, { delivery: EventDelivery.context, taskId: 'chosen' })
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions }))
    expect(await invokeTaskSettled(channel, 'chosen', 4)).toEqual({
      status: 'fulfilled',
      value: 11
    })
    expect(listener).toHaveBeenCalledExactlyOnceWith(4)
    first()
    expect(channel.size).toBe(0)
  })

  it('retains synchronous failure identity and creates report contexts for late and projection failures', async () => {
    /** Listener failure identities must survive aggregation and deferred reporting. */
    const failure = new Error('value listener failure')
    /** Ordinary value delivery uses the existing synchronous publish failure aggregation. */
    const channel = createEventChannel<number>()
    channel.subscribe(
      () => {
        throw failure
      },
      { delivery: EventDelivery.value }
    )
    /** Capture the coded aggregate without replacing the original listener error. */
    let thrown: unknown
    try {
      channel.publish(1)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: EventSubscriberErrorCode.publishFailed })
    expect((thrown as AggregateError).errors).toContain(failure)

    /** A missing projection emits its usual diagnostic while payload delivery still succeeds. */
    const payload: { data?: { leaf: number } } = {}
    /** Collects both report paths, each of which must retain a context with the original value. */
    const report = vi.fn()
    /** Projection remains channel-owned even when no listener needs a context argument. */
    const projected = createEventChannel<
      typeof payload,
      void,
      undefined,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    projected.subscribe(
      (value) => {
        expect(value).toBe(payload)
        return Promise.reject(failure)
      },
      { delivery: EventDelivery.value, taskId: 'reported' }
    )
    projected.publish(payload)
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2))
    expect(report.mock.calls[0]?.[0].error).toMatchObject({
      code: EventSubscriberErrorCode.valueProjectionFailed
    })
    expect(report.mock.calls[1]?.[0].error).toBe(failure)
    for (const [diagnostic] of report.mock.calls) {
      expect(diagnostic.event.value).toBe(payload)
      expect(diagnostic.event.taskId).toBe('reported')
      expect(diagnostic.event.resource).toBeUndefined()
      expect(diagnostic.event.abort).toBeTypeOf('function')
    }
  })

  it.each([EventDispatchPolicy.recursive, EventDispatchPolicy.queued])(
    'preserves %s reentry and publish budget for value listeners',
    (dispatchPolicy) => {
      /** Nested dispatch ordering and invocation limits remain owned by the canonical dispatcher. */
      const channel = createEventChannel<number>({ dispatchPolicy, publishBudget: 4 })
      /** Mixed argument modes make any separate value-dispatch path observable. */
      const order: string[] = []
      channel.subscribe(
        (value) => {
          order.push(`value:${value}`)
          if (value === 1) channel.publish(2)
        },
        { delivery: EventDelivery.value }
      )
      channel.subscribe((event) => {
        order.push(`context:${event.value}`)
      })
      channel.publish(1)
      expect(order).toEqual(
        dispatchPolicy === EventDispatchPolicy.recursive
          ? ['value:1', 'value:2', 'context:2', 'context:1']
          : ['value:1', 'context:1', 'value:2', 'context:2']
      )

      /** A third listener exceeds the same budget without introducing a value-specific error. */
      channel.subscribe(() => undefined, { delivery: EventDelivery.value })
      expect(() => channel.publish(1)).toThrowError(
        expect.objectContaining({ code: EventSubscriberErrorCode.publishFailed })
      )
    }
  )
})
