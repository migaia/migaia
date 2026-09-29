import { describe, expect, it, vi } from 'vitest'
import {
  createEventChannel,
  EventAdmissionPolicy,
  EventSubscriberErrorCode,
  invokeTask
} from '../src/index.js'

describe('channel admission policies', () => {
  it('ES-T189 ESUA A8 exports the stable admission modes without a sync error policy', () => {
    expect(EventAdmissionPolicy).toEqual({ multiple: 'multiple', unique: 'unique' })
  })

  it('ES-T190 ESUA A9 rejects an invalid mode and preserves default duplicate and throw behavior', () => {
    /** Runtime validation must reject a value that TypeScript already excludes. */
    let invalid: unknown
    try {
      // @ts-expect-error invalid policy is also rejected at runtime
      createEventChannel<number>({ admissionPolicy: 'x' })
    } catch (error) {
      invalid = error
    }
    expect(invalid).toBeInstanceOf(TypeError)
    expect(invalid).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
    expect(() => {
      // @ts-expect-error null is an invalid runtime option, not the default mode
      createEventChannel<number>({ admissionPolicy: null })
    }).toThrowError(TypeError)

    /** The default mode still owns one registration per subscription. */
    const channel = createEventChannel<number>()
    const listener = () => undefined
    channel.subscribe(listener)
    channel.subscribe(listener)
    expect(channel.size).toBe(2)

    /** Synchronous listener failures still leave the package as aggregate publish failures. */
    const failure = new Error('fixture listener failure')
    channel.subscribe(() => {
      throw failure
    })
    try {
      channel.publish(1)
      throw new Error('publish should fail')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect(error).toMatchObject({ code: EventSubscriberErrorCode.publishFailed })
      expect((error as AggregateError).errors).toContain(failure)
    }
  })

  it('ES-T191 ESUA A1 admits one listener identity across direct, chained, styled, and reentrant calls', () => {
    /** Invocation order exposes both duplicate admission and reentrant insertion. */
    const order: string[] = []
    const channel = createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })
    let repeatedDuringPublish = false
    const f = () => {
      order.push('f')
      if (repeatedDuringPublish) return
      repeatedDuringPublish = true
      channel.subscribe(f)
    }
    const g = () => {
      order.push('g')
    }
    const handle = channel.subscribe(f)
    channel.subscribe(g)
    channel.subscribe(f)
    handle.subscribe(f)
    expect(channel.size).toBe(2)
    channel.publish(1)
    expect(order).toEqual(['f', 'g'])
    expect(channel.size).toBe(2)
    channel.publish(2)
    expect(order).toEqual(['f', 'g', 'f', 'g'])

    /** Identity indexes are channel local, and the default remains multiple. */
    const other = createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })
    other.subscribe(f)
    expect(other.size).toBe(1)
    const multiple = createEventChannel<number>()
    multiple.subscribe(f).subscribe(f)
    expect(multiple.size).toBe(2)

    /** A style alias reaches the same unique admission path as subscribe. */
    const styled = createEventChannel<number>({
      style: 'on-emit',
      admissionPolicy: EventAdmissionPolicy.unique
    })
    styled.on(f).on(f)
    expect(styled.size).toBe(1)
  })

  it('ES-T192 ESUA A2 binds every disposer to its original registration generation', () => {
    const channel = createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })
    const listener = vi.fn()
    const d1 = channel.subscribe(listener)
    const d2 = channel.subscribe(listener)
    expect(channel.size).toBe(1)
    d2()
    d1()
    d2()
    expect(channel.size).toBe(0)
    channel.publish(1)
    expect(listener).not.toHaveBeenCalled()

    const d3 = channel.subscribe(listener)
    d1()
    d2()
    expect(channel.size).toBe(1)
    channel.publish(2)
    expect(listener).toHaveBeenCalledTimes(1)
    channel.clear()
    channel.subscribe(listener)
    d3()
    expect(channel.size).toBe(1)

    /** Unique ownership also prevents a stale listener-all disposer from scanning a new owner. */
    const listenerAll = createEventChannel<number>({
      admissionPolicy: EventAdmissionPolicy.unique,
      removalPolicy: 'listener-all'
    })
    const old = listenerAll.subscribe(listener)
    listenerAll.clear()
    listenerAll.subscribe(listener)
    old()
    expect(listenerAll.size).toBe(1)
  })

  it('ES-T193 ESUA A3 keeps the existing owner when a duplicate handle projection fails', () => {
    const channel = createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })
    const listener = vi.fn()
    channel.subscribe(listener)
    /** The factory rolls back its failed handle; duplicate admission must defer its release. */
    const projectionFailure = new Error('fixture projection failure')
    const projection = vi.spyOn(Object, 'defineProperties').mockImplementationOnce(() => {
      throw projectionFailure
    })
    let thrown: unknown
    try {
      channel.subscribe(listener)
    } catch (error) {
      thrown = error
    } finally {
      projection.mockRestore()
    }
    expect(thrown).toBeInstanceOf(TypeError)
    expect(thrown).toMatchObject({
      code: EventSubscriberErrorCode.subscriptionHandleProjectionFailed,
      cause: projectionFailure
    })
    expect(channel.size).toBe(1)
    channel.publish(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ES-T194 ESUA A4 rejects conflicting task labels without changing the owner', async () => {
    const channel = createEventChannel<number>({ admissionPolicy: EventAdmissionPolicy.unique })
    const listener = vi.fn()
    channel.subscribe(listener, { taskId: 'a' })
    for (const options of [{ taskId: 'b' }, undefined]) {
      let thrown: unknown
      try {
        channel.subscribe(listener, options)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(TypeError)
      expect(thrown).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
      expect(channel.size).toBe(1)
    }
    expect(() => channel.subscribe(listener, { taskId: 'a' })).not.toThrow()
    expect(channel.size).toBe(1)
    await invokeTask(channel, 'a', 1)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
