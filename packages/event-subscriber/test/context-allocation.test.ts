import { describe, expect, it } from 'vitest'
import { createEventChannel, type IEventContext } from '../src/index.ts'
import { channelCapabilities } from '../src/internal/channel-capability.ts'

describe('escaping event context', () => {
  it('retains distinct payloads, fixed task labels and detached controls after dispatch', () => {
    /** Retained contexts expose accidental pooling or shared dispatch state. */
    const contexts: IEventContext<object>[] = []
    /** A single registration survives two publishes before its detached abort is called. */
    const channel = createEventChannel<object>()
    channel.subscribe(
      (event) => {
        contexts.push(event)
      },
      { taskId: 'first' }
    )
    /** Payload identities remain owned by their original dispatch. */
    const first = {}
    /** A later payload must never replace the first context's value. */
    const second = {}
    channel.publish(first)
    /** Detached callbacks retain the original registration instead of depending on call-site this. */
    const retag = contexts[0]!.setTaskId
    retag('second')
    channel.publish(second)
    expect(contexts[0]).not.toBe(contexts[1])
    expect(contexts[0]!.value).toBe(first)
    expect(contexts[1]!.value).toBe(second)
    expect(contexts.map((event) => event.taskId)).toEqual(['first', 'second'])
    /** Cancellation updates every retained context's live control and remains idempotent. */
    const abort = contexts[0]!.abort
    /** Exact reason identity survives cancellation after both listener invocations return. */
    const reason = {}
    abort(reason)
    abort('ignored')
    expect(contexts.every((event) => event.aborted && event.abortReason === reason)).toBe(true)
    expect(channel.size).toBe(0)
  })

  it('keeps projection data immutable and contexts independent across selected listeners', () => {
    /** Projection aliases retain their existing own descriptor on each fresh context. */
    const channel = createEventChannel<
      { data: object },
      void,
      undefined,
      { readonly readPath: 'data'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data', alias: 'resource' } })
    /** A shared payload leaf must not imply a shared listener context. */
    const contexts: IEventContext<{ data: object }>[] = []
    channel.subscribe((event) => {
      contexts.push(event)
    })
    channel.subscribe((event) => {
      contexts.push(event)
    })
    /** This leaf is observed unchanged through both alias properties. */
    const data = {}
    channel.publish({ data })
    expect(contexts[0]).not.toBe(contexts[1])
    for (const context of contexts) {
      expect(Object.getOwnPropertyDescriptor(context, 'resource')).toEqual({
        value: data,
        enumerable: true,
        writable: false,
        configurable: false
      })
      expect(Object.isFrozen(context)).toBe(false)
    }
  })

  it('keeps frozen control descriptors and isolates each registration owner', () => {
    /** Internal controls keep their existing shape while sharing implementation functions. */
    const channel = createEventChannel<number>()
    channel.subscribe(() => undefined, { taskId: 'first' })
    channel.subscribe(() => undefined, { taskId: 'second' })
    /** The existing capability exposes controls to this package test without adding a public seam. */
    const capability = channelCapabilities.get(channel)!
    /** Separate controls must continue targeting their original registration. */
    const controls = capability.snapshot().map((snapshot) => snapshot.control)
    expect(controls[0]).not.toBe(controls[1])
    for (const control of controls) {
      expect(Object.isFrozen(control)).toBe(true)
      expect(Object.getPrototypeOf(control)).toBe(Object.prototype)
      expect(Reflect.ownKeys(control)).toEqual([
        'active',
        'aborted',
        'abortReason',
        'abort',
        'setTaskId'
      ])
      for (const key of ['active', 'aborted', 'abortReason']) {
        expect(Object.getOwnPropertyDescriptor(control, key)).toEqual({
          get: expect.any(Function),
          set: undefined,
          enumerable: true,
          configurable: false
        })
      }
      for (const key of ['abort', 'setTaskId']) {
        expect(Object.getOwnPropertyDescriptor(control, key)).toEqual({
          value: expect.any(Function),
          writable: false,
          enumerable: true,
          configurable: false
        })
      }
    }
    controls[0]!.setTaskId('retagged')
    expect(capability.snapshot().map((snapshot) => snapshot.taskId)).toEqual(['retagged', 'second'])
    controls[0]!.abort('first-only')
    controls[0]!.abort('ignored')
    expect(controls[0]!.abortReason).toBe('first-only')
    expect(controls[0]!.active).toBe(false)
    expect(controls[1]!.active).toBe(true)
    expect(channel.size).toBe(1)
  })
})
