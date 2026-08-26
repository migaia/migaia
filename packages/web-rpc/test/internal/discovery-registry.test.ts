import { describe, expect, it, vi } from 'vitest'
import { DiscoveryRegistry } from '../../src/internal/discovery-registry'
import { VerifiedPeerRegistry } from '../../src/internal/identity'

describe('DiscoveryRegistry', () => {
  it('settles an automatic waiter and owns its collection timer', () => {
    const registry = new DiscoveryRegistry()
    const clear = vi.fn()
    let resolved = false
    registry.setWaiter('target', {
      settled: false,
      taskId: 'task',
      timer: { clear },
      resolve: () => {
        resolved = true
      }
    })
    registry.setTask('task', 'target')
    registry.setTimer('task', { clear })
    registry.setResponseCount('task', 1)
    expect(registry.resolveAutomatic('target', () => ({ clear }))).toBe(true)
    expect(clear).toHaveBeenCalled()
    expect(resolved).toBe(true)
  })

  it('settles automatic waiter synchronously before same-turn responses', () => {
    const registry = new DiscoveryRegistry()
    const createTimer = vi.fn(() => ({ clear: vi.fn() }))
    registry.setWaiter('target', { settled: false, resolve: vi.fn() })

    expect(registry.resolveAutomatic('target', createTimer)).toBe(true)
    expect(registry.resolveAutomatic('target', createTimer)).toBe(false)
    expect(createTimer).toHaveBeenCalledOnce()
  })

  it('rejects the actual automatic waiter and cleans all state when timer creation fails', async () => {
    const registry = new DiscoveryRegistry()
    const clear = vi.fn()
    const primary = new Error('timer failed')
    let resolvePromise!: () => void
    let rejectPromise!: (error: unknown) => void
    const reject = vi.fn((error: unknown) => rejectPromise(error))
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    registry.setWaiter('target', {
      settled: false,
      taskId: 'task',
      timer: { clear },
      resolve: resolvePromise,
      reject
    })
    registry.setTask('task', 'target')
    registry.setTimer('task', { clear })
    registry.setResponseCount('task', 1)

    expect(() =>
      registry.resolveAutomatic('target', () => {
        throw primary
      })
    ).toThrow(primary)
    await expect(promise).rejects.toBe(primary)
    expect(reject).toHaveBeenCalledOnce()
    expect(registry.debugSnapshot()).toMatchObject({ waiters: 0, tasks: 0, timers: 0 })
    expect(registry.getResponseCount('task')).toBeUndefined()
    expect(registry.resolveAutomatic('target', () => ({ clear: vi.fn() }))).toBe(false)
  })

  it('releases manual waiter resources on failure', () => {
    const registry = new DiscoveryRegistry()
    const clear = vi.fn()
    const reject = vi.fn()
    const remove = vi.fn()
    const signal = { removeEventListener: remove } as unknown as AbortSignal
    registry.setManualWaiter('query', {
      timer: { clear },
      reject,
      signal,
      onAbort: () => undefined
    })
    expect(registry.rejectManualWaiter('query', new Error('send failed'))).toBe(true)
    expect(clear).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledOnce()
  })
  it('settles a manual waiter before reporting timer cleanup failure', () => {
    const timerError = new Error('manual timer cleanup failed')
    const primaryError = new Error('send failed')
    const report = vi.fn()
    let settleReject!: (reason: unknown) => void
    const promise = new Promise<void>((_resolve, reject) => {
      settleReject = reject
    })
    let rejected = false
    const registry = new DiscoveryRegistry(undefined, report)
    registry.setManualWaiter('query', {
      timer: {
        clear() {
          expect(registry.getManualWaiter('query')).toBeUndefined()
          expect(rejected).toBe(true)
          throw timerError
        }
      },
      reject: (error: unknown) => {
        rejected = true
        settleReject(error)
      }
    })

    expect(registry.rejectManualWaiter('query', primaryError)).toBe(true)
    return expect(promise)
      .rejects.toBe(primaryError)
      .then(() => {
        expect(rejected).toBe(true)
        expect(registry.getManualWaiter('query')).toBeUndefined()
        expect(report).toHaveBeenCalledWith(timerError)
      })
  })
  it('settles a manual waiter before reporting listener cleanup failure', () => {
    const listenerError = new Error('manual listener cleanup failed')
    const report = vi.fn()
    const reject = vi.fn()
    const registry = new DiscoveryRegistry(undefined, report)
    registry.setManualWaiter('query', {
      timer: { clear: vi.fn() },
      reject,
      signal: {
        removeEventListener() {
          throw listenerError
        }
      },
      onAbort: () => undefined
    })

    expect(registry.rejectManualWaiter('query', new Error('send failed'))).toBe(true)
    expect(reject).toHaveBeenCalledOnce()
    expect(registry.getManualWaiter('query')).toBeUndefined()
    expect(report).toHaveBeenCalledWith(listenerError)
  })
  it('resolves a manual waiter even when listener cleanup reports an error', () => {
    const cleanupError = new Error('manual listener cleanup failed')
    const report = vi.fn()
    const resolve = vi.fn()
    const registry = new DiscoveryRegistry(undefined, report)
    registry.setManualWaiter('query', {
      timer: { clear: vi.fn() },
      candidates: [{ value: 1 }],
      resolve,
      signal: {
        removeEventListener() {
          throw cleanupError
        }
      },
      onAbort: () => undefined
    })

    expect(registry.resolveManualWaiter('query')).toBe(true)
    expect(resolve).toHaveBeenCalledWith([{ value: 1 }])
    expect(report).toHaveBeenCalledWith(cleanupError)
    expect(registry.getManualWaiter('query')).toBeUndefined()
  })
  it('closes all manual waiters and releases their listeners', () => {
    const registry = new DiscoveryRegistry()
    const firstReject = vi.fn()
    const secondReject = vi.fn()
    const firstClear = vi.fn()
    const secondClear = vi.fn()
    registry.setManualWaiter('first', { timer: { clear: firstClear }, reject: firstReject })
    registry.setManualWaiter('second', { timer: { clear: secondClear }, reject: secondReject })
    registry.close(new Error('closed'))
    expect(firstReject).toHaveBeenCalledOnce()
    expect(secondReject).toHaveBeenCalledOnce()
    expect(firstClear).toHaveBeenCalledOnce()
    expect(secondClear).toHaveBeenCalledOnce()
  })

  it('continues settling manual waiters when one listener cleanup fails', () => {
    const registry = new DiscoveryRegistry()
    const firstReject = vi.fn()
    const secondReject = vi.fn()
    const removeFirst = vi.fn(() => {
      throw new Error('listener cleanup failed')
    })
    const removeSecond = vi.fn()
    const signal = (remove: () => void) =>
      ({ removeEventListener: remove }) as unknown as AbortSignal
    registry.setManualWaiter('first', {
      timer: { clear: vi.fn() },
      reject: firstReject,
      signal: signal(removeFirst),
      onAbort: () => undefined
    })
    registry.setManualWaiter('second', {
      timer: { clear: vi.fn() },
      reject: secondReject,
      signal: signal(removeSecond),
      onAbort: () => undefined
    })

    expect(() => registry.close(new Error('closed'))).toThrow('listener cleanup failed')
    expect(firstReject).toHaveBeenCalledOnce()
    expect(secondReject).toHaveBeenCalledOnce()
    expect(removeSecond).toHaveBeenCalledOnce()
  })

  it('collects every close failure in release order for the Host translator', () => {
    const firstRejectError = new Error('first reject failed')
    const timerError = new Error('timer clear failed')
    const bindingError = new Error('binding release failed')
    const registry = new DiscoveryRegistry({
      retain: () => true,
      release: () => {
        throw bindingError
      }
    })
    registry.setWaiter('first', {
      taskId: 'first-task',
      timer: { clear: () => undefined },
      reject: () => {
        throw firstRejectError
      }
    })
    registry.setTask('first-task', 'first')
    registry.setTimer('first-task', {
      clear: () => {
        throw timerError
      }
    })
    registry.setRemoteWithBinding('remote', {}, 'binding')

    expect(registry.closeAndCollect(new Error('closed'))).toEqual([
      firstRejectError,
      timerError,
      bindingError
    ])
    expect(registry.debugSnapshot()).toEqual({
      local: 0,
      remote: 0,
      waiters: 0,
      tasks: 0,
      timers: 0,
      manualWaiters: 0,
      inboundQueries: 0,
      inboundTimers: 0
    })
  })

  it('detaches state, finishes every close cleanup, and preserves the first failure', () => {
    const firstRejectError = new Error('first reject failed')
    const secondRejectError = new Error('second reject failed')
    const timerError = new Error('timer clear failed')
    const releaseError = new Error('binding release failed')
    const reported: unknown[] = []
    let observedDuringReject: ReturnType<DiscoveryRegistry['debugSnapshot']> | undefined
    const registry = new DiscoveryRegistry(
      {
        retain: () => true,
        release: () => {
          throw releaseError
        }
      },
      (error) => {
        reported.push(error)
        if (error === secondRejectError) throw new Error('reporter failed')
      }
    )
    const waiterTimer = { clear: vi.fn() }
    registry.setWaiter('first', {
      taskId: 'first-task',
      timer: waiterTimer,
      reject: () => {
        observedDuringReject = registry.debugSnapshot()
        registry.close(new Error('reentrant close'))
        throw firstRejectError
      }
    })
    registry.setTask('first-task', 'first')
    registry.setTimer('first-task', {
      clear: () => {
        throw timerError
      }
    })
    registry.setWaiter('second', {
      reject: () => {
        throw secondRejectError
      }
    })
    registry.setRemoteWithBinding('remote', {}, 'binding')

    expect(() => registry.close(new Error('closed'))).toThrow(firstRejectError)
    expect(observedDuringReject).toEqual({
      local: 0,
      remote: 0,
      waiters: 0,
      tasks: 0,
      timers: 0,
      manualWaiters: 0,
      inboundQueries: 0,
      inboundTimers: 0
    })
    expect(registry.debugSnapshot()).toEqual(observedDuringReject)
    expect(waiterTimer.clear).not.toHaveBeenCalled()
    expect(reported).toEqual([secondRejectError, timerError, releaseError])
  })

  it('rejects automatic waiters and releases their task resources on close', () => {
    const registry = new DiscoveryRegistry()
    const reject = vi.fn()
    const clear = vi.fn()
    registry.setWaiter('target', {
      taskId: 'task',
      timer: { clear },
      reject
    })
    registry.setTask('task', 'target')
    registry.setTimer('task', { clear })
    registry.setResponseCount('task', 1)

    registry.close(new Error('closed'))

    expect(reject).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledOnce()
    expect(registry.getWaiter('target')).toBeUndefined()
    expect(registry.getTask('task')).toBeUndefined()
    expect(registry.getResponseCount('task')).toBeUndefined()
  })

  it('rejects new remote targets and waiters at owner capacity', () => {
    const registry = new DiscoveryRegistry()
    expect(registry.setRemote('one', {}, 1)).toBe(true)
    expect(registry.setRemote('two', {}, 1)).toBe(false)
    expect(registry.hasRemote('one')).toBe(true)
    expect(registry.setWaiter('one', {}, 1)).toBe(true)
    expect(registry.setWaiter('two', {}, 1)).toBe(false)
    expect(registry.canAdmitWaiter('two', 1)).toBe(false)
  })

  it('keeps exact waiter capacity boundaries and permits existing-key refresh', () => {
    const registry = new DiscoveryRegistry()
    expect(registry.setWaiter('one', {}, 2)).toBe(true)
    expect(registry.setWaiter('two', {}, 2)).toBe(true)
    expect(registry.canAdmitWaiter('one', 2)).toBe(true)
    expect(registry.canAdmitWaiter('three', 2)).toBe(false)
    expect(registry.setWaiter('one', { refreshed: true }, 2)).toBe(true)
    expect(registry.getWaiter<{ refreshed?: boolean }>('one')).toEqual({ refreshed: true })
    expect(registry.setWaiter('three', {}, 2)).toBe(false)
  })

  it('returns frozen discovery entry snapshots', () => {
    const registry = new DiscoveryRegistry()
    registry.setRemote('remote', { status: 'active' })
    registry.setAdmission('query', { peerKey: 'peer', at: 1 })

    const remote = registry.remoteSnapshot<{ status: string }>()
    const admission = registry.admissionSnapshot()
    expect(Object.isFrozen(remote)).toBe(true)
    expect(Object.isFrozen(remote[0])).toBe(true)
    expect(Object.isFrozen(admission)).toBe(true)
    expect(Object.isFrozen(admission[0])).toBe(true)
  })

  it('purges stale unprotected remotes without evicting pinned entries', () => {
    const registry = new DiscoveryRegistry()
    registry.setRemote('stale', { pinned: false, status: 'active' })
    registry.setRemote('pinned', { pinned: true, status: 'active' })
    expect(
      registry.purgeRemote(
        (entry: { status: string; pinned: boolean }) => entry.status === 'active',
        (entry: { status: string; pinned: boolean }) => entry.pinned
      )
    ).toBe(1)
    expect(registry.hasRemote('stale')).toBe(false)
    expect(registry.hasRemote('pinned')).toBe(true)
  })

  it('retains remote identity leases until the remote snapshot is removed', () => {
    const retained: string[] = []
    const released: string[] = []
    const registry = new DiscoveryRegistry({
      retain: (token) => {
        retained.push(token)
        return true
      },
      release: (token) => released.push(token)
    })
    registry.setRemote('remote', { status: 'active' })
    expect(registry.setRemoteWithBinding('remote', { status: 'active' }, 'peer-token')).toBe(true)
    expect(retained).toEqual(['peer-token'])
    registry.deleteRemote('remote')
    expect(released).toEqual(['peer-token'])
  })

  it('does not commit a binding when its identity lease is unavailable', () => {
    const registry = new DiscoveryRegistry({
      retain: () => false,
      release: () => undefined
    })
    registry.setRemote('remote', { status: 'active' })
    expect(registry.setRemoteWithBinding('remote', {}, 'expired-token')).toBe(false)
    expect(registry.getRemoteBinding('remote')).toBeUndefined()
  })

  it('checks remote capacity before acquiring a new binding lease', () => {
    const retained: string[] = []
    const registry = new DiscoveryRegistry({
      retain: (token) => {
        retained.push(token)
        return true
      },
      release: () => undefined
    })
    registry.setRemote('existing', { status: 'active' }, 1)
    expect(registry.setRemoteWithBinding('new', {}, 'new-token', 1)).toBe(false)
    expect(retained).toEqual([])
    expect(registry.getRemoteBinding('existing')).toBeUndefined()
  })

  it('refreshes and replaces binding leases without double-retaining', () => {
    const retained: string[] = []
    const released: string[] = []
    const registry = new DiscoveryRegistry({
      retain: (token) => {
        retained.push(token)
        return true
      },
      release: (token) => released.push(token)
    })
    expect(registry.setRemoteWithBinding('remote', { version: 1 }, 'first')).toBe(true)
    expect(registry.setRemoteWithBinding('remote', { version: 2 }, 'first')).toBe(true)
    expect(registry.setRemoteWithBinding('remote', { version: 3 }, 'second')).toBe(true)
    expect(retained).toEqual(['first', 'second'])
    expect(released).toEqual(['first'])
    expect(registry.getRemoteBinding('remote')).toBe('second')
  })

  it('keeps replacement state when previous binding release fails', () => {
    const released: string[] = []
    const registry = new DiscoveryRegistry({
      retain: () => true,
      release: (token) => {
        released.push(token)
        if (token === 'first') throw new Error('old release failed')
      }
    })
    expect(registry.setRemoteWithBinding('remote', { version: 1 }, 'first')).toBe(true)

    expect(() => registry.setRemoteWithBinding('remote', { version: 2 }, 'second')).toThrow(
      'old release failed'
    )
    expect(registry.getRemote<{ version: number }>('remote')).toEqual({ version: 2 })
    expect(registry.getRemoteBinding('remote')).toBe('second')
    expect(released).toEqual(['first'])

    registry.clear()
    expect(released).toEqual(['first', 'second'])
  })

  it('releases remote identity leases during stale purge and close', () => {
    const released: string[] = []
    const registry = new DiscoveryRegistry({
      retain: () => true,
      release: (token) => released.push(token)
    })
    expect(
      registry.setRemoteWithBinding('stale', { status: 'active', pinned: false }, 'stale-token')
    ).toBe(true)
    expect(
      registry.setRemoteWithBinding('live', { status: 'active', pinned: true }, 'live-token')
    ).toBe(true)
    registry.purgeRemote(
      (entry: { status: string; pinned: boolean }) => entry.status === 'active',
      (entry: { status: string; pinned: boolean }) => entry.pinned
    )
    expect(released).toEqual(['stale-token'])
    registry.close(new Error('closed'))
    expect(released).toEqual(['stale-token', 'live-token'])
  })

  it('keeps a remote identity valid across its TTL while DNS owns the lease', async () => {
    const identity = new VerifiedPeerRegistry(4, 4, 1)
    const token = identity.register('peer')
    expect(typeof token).toBe('string')
    const registry = new DiscoveryRegistry({
      retain: (value) => identity.retain(value),
      release: (value) => identity.release(value)
    })
    expect(registry.setRemoteWithBinding('remote', { status: 'active' }, token as string)).toBe(
      true
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(identity.has('peer')).toBe(true)
    registry.deleteRemote('remote')
    await new Promise((resolve) => setTimeout(resolve, 2))
    expect(identity.has('peer')).toBe(false)
  })

  it('rejects revocation admission instead of evicting an older security record', () => {
    const registry = new DiscoveryRegistry()
    expect(registry.revokeCandidate('old', 1)).toBe(true)
    expect(registry.canRevokeCandidate('new', 1)).toBe(false)
    expect(registry.revokeCandidate('new', 1)).toBe(false)
    expect(registry.isCandidateRevoked('old')).toBe(true)
    expect(registry.isCandidateRevoked('new')).toBe(false)
  })
})
