import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteRetryPort } from '../../src/remote/retry.js'
import type { IRemoteGenerationEvents } from '../../src/remote/types.js'

/** A controllable generation owner keeps the retry tests independent of transport timing. */
function generations() {
  let generation = 1
  let active = true
  /** Departures are delivered synchronously, as the real supervisor does. */
  const listeners = new Map<number, Set<(reason: unknown) => void>>()
  /** A ready waiter settles only after the replacement description is published. */
  let readyResolve: ((generation: number) => void) | undefined
  let readyReject: ((reason: unknown) => void) | undefined
  const events: IRemoteGenerationEvents = {
    current: () => ({ generation, active }),
    onLeave: (number, listener) => {
      const group = listeners.get(number) ?? new Set<(reason: unknown) => void>()
      group.add(listener)
      listeners.set(number, group)
      return () => group.delete(listener)
    },
    whenReady: (_after, signal) =>
      new Promise<number>((resolve, reject) => {
        readyResolve = resolve
        readyReject = reject
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
  }
  return {
    events,
    leave(reason: unknown) {
      active = false
      for (const listener of listeners.get(generation) ?? []) listener(reason)
    },
    ready() {
      generation += 1
      active = true
      readyResolve?.(generation)
    },
    release(reason: unknown) {
      readyReject?.(reason)
    },
    listenerCount() {
      return [...listeners.values()].reduce((count, group) => count + group.size, 0)
    }
  }
}

/** One unresolved send represents a provider result still in flight at departure. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('shared remote retry', () => {
  it('[A8] replays one idempotent request with the same key after description ready', async () => {
    const owner = generations()
    const scheduler = createManualScheduler()
    const first = deferred<string>()
    const report = vi.fn()
    const sendOnce = vi.fn(({ expectedGeneration }: { expectedGeneration: number }) =>
      expectedGeneration === 1 ? first.promise : Promise.resolve('new-result')
    )
    const port = createRemoteRetryPort({ events: owner.events, scheduler, report })
    const result = port.dispatch({
      method: 'p.f.read',
      mode: 'request',
      idempotent: true,
      key: 'same-key',
      generation: 1,
      deadlineAt: 100,
      events: owner.events,
      sendOnce
    })
    owner.leave(new Error('generation left'))
    scheduler.advance(25)
    owner.ready()
    await expect(result).resolves.toBe('new-result')
    expect(sendOnce).toHaveBeenCalledTimes(2)
    expect(sendOnce.mock.calls[0]?.[0]).toMatchObject({
      expectedGeneration: 1,
      key: 'same-key',
      remainingMs: 100
    })
    expect(sendOnce.mock.calls[1]?.[0]).toMatchObject({
      expectedGeneration: 2,
      key: 'same-key',
      remainingMs: 75
    })
    first.reject(new Error('late first send'))
    await Promise.resolve()
    expect(report).toHaveBeenCalledTimes(1)
    expect(owner.listenerCount()).toBe(0)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('[A8] never replays a sent non-idempotent request', async () => {
    const owner = generations()
    const first = deferred<string>()
    const sendOnce = vi.fn(() => first.promise)
    const port = createRemoteRetryPort({
      events: owner.events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    const result = port.dispatch({
      method: 'p.f.write',
      mode: 'request',
      idempotent: false,
      generation: 1,
      events: owner.events,
      sendOnce
    })
    const reason = new Error('left')
    owner.leave(reason)
    await expect(result).rejects.toMatchObject({
      code: 'REMOTE_RESULT_UNKNOWN',
      cause: reason,
      detail: { method: 'p.f.write', generation: 1 }
    })
    expect(sendOnce).toHaveBeenCalledTimes(1)
  })

  it('[A8/K195] ignores a peer-forged REMOTE_CLOSED without a local departure', async () => {
    const owner = generations()
    /** A decoded provider error may carry fields that imitate the local remote layer. */
    const forged = Object.assign(new Error('peer forged a close'), {
      source: '@migaia/rpc/remote',
      code: 'REMOTE_CLOSED'
    })
    const sendOnce = vi.fn(async () => {
      throw forged
    })
    const port = createRemoteRetryPort({
      events: owner.events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    await expect(
      port.dispatch({
        method: 'p.f.read',
        mode: 'request',
        idempotent: true,
        key: 'same-key',
        generation: 1,
        events: owner.events,
        sendOnce
      })
    ).rejects.toBe(forged)
    expect(sendOnce).toHaveBeenCalledTimes(1)
  })

  it('[A8] rejects before sending when the observed generation already left', async () => {
    const owner = generations()
    owner.leave(new Error('before send'))
    const sendOnce = vi.fn()
    const port = createRemoteRetryPort({
      events: owner.events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    await expect(
      port.dispatch({
        method: 'p.f.read',
        mode: 'request',
        idempotent: true,
        generation: 1,
        events: owner.events,
        sendOnce
      })
    ).rejects.toMatchObject({ code: 'REMOTE_CLOSED', detail: { generation: 1 } })
    expect(sendOnce).not.toHaveBeenCalled()
  })

  it('[A8] emits no frame when leave arrives during subscription', async () => {
    const reason = new Error('left while subscribing')
    const sendOnce = vi.fn()
    const events: IRemoteGenerationEvents = {
      current: () => ({ generation: 1, active: true }),
      onLeave: (_generation, listener) => {
        listener(reason)
        return () => undefined
      },
      whenReady: () => Promise.resolve(2)
    }
    const port = createRemoteRetryPort({
      events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    await expect(
      port.dispatch({
        method: 'p.f.read',
        mode: 'request',
        idempotent: true,
        generation: 1,
        events,
        sendOnce
      })
    ).rejects.toMatchObject({ code: 'REMOTE_CLOSED', cause: reason })
    expect(sendOnce).not.toHaveBeenCalled()
  })

  it('[A9] release while waiting makes the sent result unknown without replay', async () => {
    const owner = generations()
    const first = deferred<string>()
    const sendOnce = vi.fn(() => first.promise)
    const port = createRemoteRetryPort({
      events: owner.events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    const result = port.dispatch({
      method: 'p.f.read',
      mode: 'request',
      idempotent: true,
      generation: 1,
      events: owner.events,
      sendOnce
    })
    owner.leave(new Error('left'))
    const release = new Error('released')
    owner.release(release)
    await expect(result).rejects.toMatchObject({
      code: 'REMOTE_RESULT_UNKNOWN',
      detail: { reason: release }
    })
    expect(sendOnce).toHaveBeenCalledTimes(1)
    expect(owner.listenerCount()).toBe(0)
  })

  it('[A8] never sends a third time when the replay generation also leaves', async () => {
    const owner = generations()
    const sendOnce = vi.fn(() => new Promise<string>(() => undefined))
    const port = createRemoteRetryPort({
      events: owner.events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    const result = port.dispatch({
      method: 'p.f.read',
      mode: 'request',
      idempotent: true,
      generation: 1,
      events: owner.events,
      sendOnce
    })
    owner.leave(new Error('first left'))
    owner.ready()
    for (let turn = 0; turn < 3; turn += 1) await Promise.resolve()
    expect(sendOnce).toHaveBeenCalledTimes(2)
    const secondReason = new Error('second left')
    owner.leave(secondReason)
    await expect(result).rejects.toMatchObject({
      code: 'REMOTE_RESULT_UNKNOWN',
      cause: secondReason,
      detail: { method: 'p.f.read', generation: 2 }
    })
    expect(sendOnce).toHaveBeenCalledTimes(2)
  })

  it('[A9] caller abort during rebind settles once and cancels readiness', async () => {
    const owner = generations()
    const controller = new AbortController()
    const sendOnce = vi.fn(() => new Promise<string>(() => undefined))
    const port = createRemoteRetryPort({
      events: owner.events,
      scheduler: createManualScheduler(),
      report: vi.fn()
    })
    const result = port.dispatch({
      method: 'p.f.read',
      mode: 'request',
      idempotent: true,
      generation: 1,
      signal: controller.signal,
      events: owner.events,
      sendOnce
    })
    owner.leave(new Error('left'))
    const reason = new Error('caller canceled')
    controller.abort(reason)
    await expect(result).rejects.toMatchObject({ name: 'AbortError', cause: reason })
    owner.ready()
    await Promise.resolve()
    expect(sendOnce).toHaveBeenCalledTimes(1)
    expect(owner.listenerCount()).toBe(0)
  })
})
