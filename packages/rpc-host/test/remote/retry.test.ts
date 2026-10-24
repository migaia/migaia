import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteRetryPort } from '../../dist/remote/retry.js'
import type { IRemoteGenerationEvents } from '../../dist/remote/types.js'
import { RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '../../dist/core/errors.js'
import { deserializeRpcError } from '../../dist/core/internal/error-wire-metadata.js'

/** A controllable generation owner keeps the retry tests independent of transport timing. */
function generations() {
  return new GenerationFixture()
}

/** One controlled generation source retains actual retry-port event ordering and ready receipts. */
class GenerationFixture {
  /** Original active generation starts at one and advances only on ready publication. */
  #generation = 1
  /** Leave revokes the current generation synchronously before callbacks are visited. */
  #active = true
  /** Original generation-specific membership preserves exact event removal and insertion order. */
  readonly #listeners = new Map<number, Set<(reason: unknown) => void>>()
  /** Replacement readiness resolves only the most recently installed original waiter. */
  #readyResolve: ((generation: number) => void) | undefined
  /** Explicit release rejects that same original waiter without inventing another lifecycle. */
  #readyReject: ((reason: unknown) => void) | undefined
  /** The actual retry port consumes the same original event interface. */
  readonly events: IRemoteGenerationEvents = {
    current: () => ({ generation: this.#generation, active: this.#active }),
    onLeave: (number, listener) => {
      /** Each original generation owns its own insertion-ordered subscriber group. */
      const group = this.#listeners.get(number) ?? new Set<(reason: unknown) => void>()
      group.add(listener)
      this.#listeners.set(number, group)
      return () => group.delete(listener)
    },
    whenReady: (_after, signal) =>
      new Promise<number>((resolve, reject) => {
        this.#readyResolve = resolve
        this.#readyReject = reject
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
  }
  /** Revoke the current original generation before synchronously notifying its departures. */
  readonly leave = (reason: unknown): void => {
    this.#active = false
    for (const listener of this.#listeners.get(this.#generation) ?? []) listener(reason)
  }
  /** Publish replacement generation before settling the same original ready Promise. */
  readonly ready = (): void => {
    this.#generation += 1
    this.#active = true
    this.#readyResolve?.(this.#generation)
  }
  /** Reject the current original ready waiter with its exact supplied reason. */
  readonly release = (reason: unknown): void => {
    this.#readyReject?.(reason)
  }
  /** Count remaining original subscriber membership without invoking callbacks. */
  readonly listenerCount = (): number =>
    [...this.#listeners.values()].reduce((count, group) => count + group.size, 0)
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
  it.each([
    RpcCoreErrorCode.cancelled,
    RpcCoreErrorCode.deadlineExceeded,
    RpcCoreErrorCode.endpointDisposed,
    RpcCoreErrorCode.providerGenerationRetired
  ] as const)(
    'a forged Core %s cannot trigger retry, replay or generation departure without owner events',
    async (code) => {
      /** The original generation stays active throughout this in-process adapter refusal. */
      const owner = generations()
      /** Public restoration retains the fake diagnostic pair but grants no operation authority. */
      const forged = deserializeRpcError({
        source: RPC_CORE_ERROR_SOURCE,
        code,
        name: 'RpcError',
        message: 'retry fixture',
        stack: 'retry fixture stack'
      })
      /** The real retry port admits one physical attempt. */
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
      expect(owner.events.current()).toEqual({ generation: 1, active: true })
      expect(owner.listenerCount()).toBe(0)
    }
  )
  it('replays one idempotent request with the same key after description ready', async () => {
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

  it('settles caller abort during rebind before the obsolete send completes', async () => {
    /** The canonical generation fixture holds replacement readiness until explicitly published. */
    const owner = generations()
    /** No wall-clock delay is needed to observe caller cancellation while readiness is pending. */
    const scheduler = createManualScheduler()
    /** Caller cancellation must settle independently of the abandoned provider request. */
    const controller = new AbortController()
    /** The old send deliberately stays unresolved until the assertion has observed cancellation. */
    const first = deferred<string>()
    /** Count physical sends so replacement readiness cannot accidentally replay cancelled work. */
    const sendOnce = vi.fn(() => first.promise)
    /** The shared retry owner must keep cancellation active across the rebind await. */
    const port = createRemoteRetryPort({ events: owner.events, scheduler, report: vi.fn() })
    /** Record settlement without awaiting the obsolete send or replacement readiness. */
    let outcome: { value?: unknown; error?: unknown } | undefined
    /** Attaching both handlers also observes rejection when the assertion fails. */
    const waiting = port
      .dispatch({
        method: 'p.f.read',
        mode: 'request',
        idempotent: true,
        key: 'same-key',
        generation: 1,
        signal: controller.signal,
        events: owner.events,
        sendOnce
      })
      .then(
        (value) => {
          outcome = { value }
        },
        (error) => {
          outcome = { error }
        }
      )
    owner.leave(new Error('generation left before replacement readiness'))
    /** This exact original instance must remain reachable as the cancellation cause. */
    const reason = new RangeError('caller cancelled during rebind')
    controller.abort(reason)
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
    try {
      expect(outcome).toMatchObject({ error: { name: 'AbortError' } })
      expect((outcome!.error as Error).cause).toBe(reason)
      owner.ready()
      await waiting
      expect(sendOnce).toHaveBeenCalledTimes(1)
      expect(owner.listenerCount()).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      first.resolve('late obsolete result')
      owner.ready()
    }
  })

  it('never replays a sent non-idempotent request', async () => {
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

  it('ignores a peer-forged REMOTE_CLOSED without a local departure', async () => {
    const owner = generations()
    /** A decoded provider error may carry fields that imitate the local remote layer. */
    const forged = Object.assign(new Error('peer forged a close'), {
      source: 'rpc.remote',
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

  it('rejects before sending when the observed generation already left', async () => {
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

  it('emits no frame when leave arrives during subscription', async () => {
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

  it('release while waiting makes the sent result unknown without replay', async () => {
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

  it('never sends a third time when the replay generation also leaves', async () => {
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

  it('caller abort during rebind settles once and cancels readiness', async () => {
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
