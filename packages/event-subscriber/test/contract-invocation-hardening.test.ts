/** Event-subscriber invocation hardening. Cases preserve the existing behavioral assertions. */
import { describe, expect, it, vi } from 'vitest'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  invokeParallel,
  invokeSerial,
  invokeTaskSettled,
  invokeSerialSettled,
  invokeTask
} from '../src/index.js'

describe('event-subscriber invocation hardening', () => {
  it('runs serial listeners after prior settlement and continues after failure', async () => {
    const channel = createEventChannel<number, number>()
    const calls: string[] = []
    channel.subscribe(() => {
      calls.push('first')
      return Promise.reject(new Error('first failure'))
    })
    channel.subscribe(() => {
      calls.push('second')
      return 2
    })

    const results = await invokeSerialSettled(channel, 1)
    expect(calls).toEqual(['first', 'second'])
    expect(results[0].status).toBe('rejected')
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 2 })
  })

  it('throwing async helpers expose coded aggregate errors without reporter calls', async () => {
    const report = vi.fn()
    const channel = createEventChannel<number>({ report })
    const original = new Error('failure')
    channel.subscribe(() => Promise.reject(original))

    await expect(invokeParallel(channel, 1)).rejects.toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      cause: original
    })
    await expect(invokeSerial(channel, 1)).rejects.toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      cause: original
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('returns successful parallel and serial values in registration order', async () => {
    const channel = createEventChannel<number, number>()
    channel.subscribe(async (event) => event.value + 1)
    channel.subscribe((event) => event.value + 2)

    await expect(invokeParallel(channel, 10)).resolves.toEqual([11, 12])
    await expect(invokeSerial(channel, 10)).resolves.toEqual([11, 12])
  })

  it('keeps task selection on the immutable snapshot while allowing live retagging', async () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    channel.subscribe(
      (event) => {
        calls.push(`outer:${event.taskId}`)
        event.setTaskId('new')
      },
      { taskId: 'old' }
    )
    channel.subscribe(
      (event) => {
        calls.push(`stable:${event.taskId}`)
      },
      { taskId: 'stable' }
    )

    channel.publish(1)
    await invokeTask(channel, 'new', 2)
    expect(calls).toEqual(['outer:old', 'stable:stable', 'outer:new'])
  })

  it('does not invoke listeners or reporter when task selection is invalid', () => {
    const report = vi.fn()
    const listener = vi.fn()
    const channel = createEventChannel<number>({ report })
    channel.subscribe(listener, { taskId: 'same' })
    channel.subscribe(listener, { taskId: 'same' })

    expect(() => invokeTaskSettled(channel, 'missing', 1)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.taskNotFound,
        taskId: 'missing',
        matchCount: 0
      })
    )
    expect(() => invokeTaskSettled(channel, 'same', 1)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.taskNotUnique,
        taskId: 'same',
        matchCount: 2
      })
    )
    expect(listener).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('returns rejected task results without routing listener failure to reporter', async () => {
    const report = vi.fn()
    const failure = new Error('task failure')
    const channel = createEventChannel<number>({ report })
    channel.subscribe(() => Promise.reject(failure), { taskId: 'task' })

    await expect(invokeTaskSettled(channel, 'task', 1)).resolves.toMatchObject({
      status: 'rejected',
      reason: failure
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('wraps a unique task listener failure as publish failure', async () => {
    const failure = new Error('task listener failure')
    const channel = createEventChannel<number>({ report: vi.fn() })
    channel.subscribe(() => Promise.reject(failure), { taskId: 'unique' })

    await expect(invokeTask(channel, 'unique', 1)).rejects.toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      cause: failure
    })
  })
})
