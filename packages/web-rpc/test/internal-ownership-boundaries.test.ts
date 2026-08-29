import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { ControlTaskRegistry } from '../src/internal/control-task-registry.js'
import { raceWithAsyncControl, waitWithSignal } from '../src/internal/async-control.js'
import { prepareEndpoint as prepareEndpointImpl } from '../src/internal/endpoint-bootstrap.js'
import { allocateRpcId } from '../src/internal/id.js'
import { ResourceScope } from '../src/internal/resource-scope.js'
import { createEndpointTimePort } from '../src/internal/time-port.js'
import { createEndpointTransportActivation } from '../src/internal/transport-activation.js'
import { VariationAdmissionRegistry } from '../src/internal/variation-admission.js'
import { PeerRegistry } from '../src/internal/peers.js'
import { translateEndpointDisposalError } from '../src/internal/disposal-translation.js'
import { WebRpcLifecycleError } from '../src/errors.js'
import type { IWebRpcTransport } from '../src/transport.js'

describe('internal ownership boundary semantics', () => {
  it('keeps control and variation admission duplicate-safe and expiry-aware', () => {
    const control = new ControlTaskRegistry()
    expect(control.admit('control-task', 0)).toBe(true)
    expect(control.admit('control-task', 1)).toBe(false)
    expect(control.rememberAbort('abort-task', 10, 0)).toBe(true)
    expect(control.rememberAbort('abort-task', 20, 1)).toBe(true)
    expect(control.consumeAbort('abort-task', 5)).toBe(true)
    expect(control.consumeAbort('abort-task', 5)).toBe(false)
    expect(control.rememberAbort('expired-task', 10, 0)).toBe(true)
    expect(control.rememberAbort('new-task', 30, 20)).toBe(true)
    expect(control.consumeAbort('expired-task', 20)).toBe(false)
    expect(control.admitControl('peer', 'control-variation', 0)).toBe(true)
    expect(control.admitControl('peer', 'control-variation', 1)).toBe(false)
    expect(control.admitVariation('peer', 0)).toBe(true)
    control.purge(100_000)
    control.clear()

    const variation = new VariationAdmissionRegistry()
    expect(variation.admit('peer', 'variation-1', 0)).toBe(true)
    expect(variation.admit('peer', 'variation-1', 1)).toBe(false)
    expect(variation.admit('peer', 'variation-2', 2)).toBe(true)
    expect(variation.admit('peer', 'variation-3', 60_000)).toBe(true)
    expect(variation.admitBudget('peer', 60_001)).toBe(true)
    variation.purge(120_001)
    variation.clear()

    const boundedVariation = new VariationAdmissionRegistry()
    for (let index = 0; index < 128; index += 1)
      expect(boundedVariation.admit('bounded-peer', `bounded-${index}`, 0)).toBe(true)
    expect(boundedVariation.admit('bounded-peer', 'bounded-overflow', 0)).toBe(false)
    const boundedBudget = new VariationAdmissionRegistry()
    for (let index = 0; index < 128; index += 1)
      expect(boundedBudget.admitBudget('bounded-peer', 0)).toBe(true)
    expect(boundedBudget.admitBudget('bounded-peer', 0)).toBe(false)
  })

  it('releases synchronous and asynchronous resources once and preserves cleanup errors', async () => {
    const scope = new ResourceScope()
    const order: string[] = []
    const removeSync = scope.addSync('sync', () => order.push('sync'))
    const removeAsync = scope.add(
      'async',
      async () => {
        order.push('async')
      },
      'critical'
    )
    expect(scope.size).toBe(2)
    removeSync()
    removeSync()
    expect(scope.size).toBe(1)
    const firstRelease = scope.releaseAll()
    expect(scope.releaseAll()).toBe(firstRelease)
    await expect(firstRelease).resolves.toEqual([])
    expect(order).toEqual(['async'])
    removeAsync()
    const releasedSync = new ResourceScope()
    const unregisterReleasedSync = releasedSync.addSync('released-sync', () => undefined)
    await releasedSync.releaseAll()
    unregisterReleasedSync()

    const failing = new ResourceScope()
    failing.addSync('sync-failure', () => {
      throw new Error('sync failure')
    })
    failing.add('async-failure', () => {
      throw new Error('async failure')
    })
    await expect(failing.releaseAll()).resolves.toEqual([
      { resource: 'sync-failure', error: expect.any(Error) },
      { resource: 'async-failure', error: expect.any(Error) }
    ])
  })

  it('quarantines transport callbacks until commit and rejects failed registration', async () => {
    let listener: ((message: { readonly data: unknown }) => void) | undefined
    let transportError: ((error: unknown) => void) | undefined
    let listenerError: ((error: unknown) => void) | undefined
    let received = 0
    let receiveErrors = 0
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      subscribe: (callback) => {
        listener = callback
        return () => undefined
      },
      onTransportError: (callback) => {
        transportError = callback
        return () => undefined
      },
      onListenerError: (callback) => {
        listenerError = callback
        return () => undefined
      },
      send: () => undefined
    }
    const activation = createEndpointTransportActivation(transport, {
      receive: async () => {
        received += 1
      },
      receiveError: () => {
        receiveErrors += 1
      },
      transportError: () => {
        received += 10
      },
      listenerError: () => {
        received += 100
      }
    })
    listener?.({ data: 'before-commit' })
    expect(received).toBe(0)
    activation.commit()
    listener?.({ data: 'after-commit' })
    transportError?.('transport')
    listenerError?.('listener')
    await Promise.resolve()
    expect(received).toBe(111)
    expect(receiveErrors).toBe(0)

    const failingTransport: IWebRpcTransport = {
      platform: 'Memory',
      subscribe: () => () => undefined,
      onTransportError: () => {
        throw new Error('registration failure')
      },
      send: () => undefined
    }
    const failed = createEndpointTransportActivation(failingTransport, {
      receive: async () => undefined,
      receiveError: () => undefined,
      transportError: () => undefined,
      listenerError: () => undefined
    })
    expect(() => failed.commit()).toThrowError('registration failure')
  })

  it('owns endpoint timers through disposal and preserves UUID validation failures', () => {
    vi.useFakeTimers()
    try {
      const time = createEndpointTimePort()
      let fired = 0
      const timer = time.setTimeout(() => {
        fired += 1
      }, 10)
      time.clearTimeout(timer)
      time.clearTimeout(timer)
      vi.advanceTimersByTime(10)
      expect(fired).toBe(0)
      const firedTimer = time.setTimeout(() => {
        fired += 1
      }, 10)
      vi.advanceTimersByTime(10)
      expect(fired).toBe(1)
      firedTimer.clear()
      time.dispose()
      time.dispose()
      const disposedTimer = time.setTimeout(() => {
        fired += 1
      }, 10)
      disposedTimer.clear()

      expect(
        allocateRpcId(
          { generate: ({ senderId }) => `${senderId}-id` },
          'variation',
          'sender',
          'target',
          () => false
        )
      ).toBe('VARIATION:sender:sender-id')
      expect(() =>
        allocateRpcId(
          { generate: 'invalid' as never },
          'variation',
          'sender',
          'target',
          () => false
        )
      ).toThrowError()
      expect(() =>
        allocateRpcId(
          {
            generate: () => {
              throw new Error('generator failure')
            }
          },
          'variation',
          'sender',
          'target',
          () => false
        )
      ).toThrowError()
      expect(() =>
        allocateRpcId({ generate: () => '' }, 'variation', 'sender', 'target', () => false)
      ).toThrowError()
      expect(() =>
        allocateRpcId({ generate: () => 'duplicate' }, 'variation', 'sender', 'target', () => true)
      ).toThrowError()
      vi.stubGlobal('crypto', {
        getRandomValues: (bytes: Uint8Array) => bytes.fill(7)
      })
      expect(allocateRpcId({}, 'variation', 'sender', 'target', () => false)).toContain(
        'VARIATION:sender:'
      )
      vi.unstubAllGlobals()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('settles cancellable waits and races through resolve, reject, timeout, and abort paths', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      expect(() => waitWithSignal(-1, [], () => new Error('aborted'))).toThrowError()
      controller.abort('already-aborted')
      await expect(
        waitWithSignal(10, [controller.signal], (reason) => new Error(String(reason)))
      ).rejects.toThrow('already-aborted')

      const activeController = new AbortController()
      const waiting = waitWithSignal(10, [activeController.signal], () => new Error('aborted'))
      vi.advanceTimersByTime(10)
      await waiting

      await expect(
        raceWithAsyncControl({
          operation: async () => 'resolved',
          timeoutMs: false,
          createTimeoutError: () => new Error('timeout'),
          createAbortError: () => new Error('abort')
        })
      ).resolves.toBe('resolved')
      await expect(
        raceWithAsyncControl({
          operation: async () => {
            throw new Error('operation failed')
          },
          timeoutMs: false,
          createTimeoutError: () => new Error('timeout'),
          createAbortError: () => new Error('abort')
        })
      ).rejects.toThrow('operation failed')
      const timedOut = raceWithAsyncControl({
        operation: () => new Promise<string>(() => undefined),
        timeoutMs: 1,
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('abort')
      })
      vi.advanceTimersByTime(1)
      await expect(timedOut).rejects.toThrow('timeout')

      const abortController = new AbortController()
      const aborted = raceWithAsyncControl({
        operation: () => new Promise<string>(() => undefined),
        timeoutMs: false,
        signals: [abortController.signal],
        createTimeoutError: () => new Error('timeout'),
        createAbortError: (reason) => new Error(String(reason))
      })
      abortController.abort('race-aborted')
      await expect(aborted).rejects.toThrow('race-aborted')

      const diagnostics: unknown[] = []
      await expect(
        raceWithAsyncControl({
          operation: () => new Promise<string>(() => undefined),
          timeoutMs: 1,
          createTimeoutError: () => new Error('timeout'),
          createAbortError: () => new Error('abort'),
          onTimeout: () => {
            throw new Error('timeout callback')
          },
          onDiagnostic: (error) => diagnostics.push(error),
          createTimer: () => {
            throw new Error('timer setup')
          },
          onSetupFailure: async () => undefined
        })
      ).rejects.toThrow('timer setup')
      expect(diagnostics).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects malformed deferred endpoint descriptors before middleware installation', async () => {
    const [transport, alternateTransport] = createMemoryTransportPair()
    const plugin = {
      name: 'fixture-plugin',
      metadata: {},
      install: () => undefined,
      transport
    }
    const valid = {
      id: 'fixture-endpoint',
      transport,
      middlewares: [plugin]
    }
    const prepareEndpoint = (config: unknown, _options?: unknown) =>
      prepareEndpointImpl(config as never, { deferMiddlewareInstall: true })
    await expect(
      prepareEndpoint(null as never, { deferMiddlewareInstall: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint({ ...valid, id: '' }, { deferMiddlewareInstall: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint({ ...valid, middlewares: 'invalid' }, { deferMiddlewareInstall: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint({ ...valid, targetIds: 'invalid' }, { deferMiddlewareInstall: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint({ ...valid, targetIds: [''] }, { deferMiddlewareInstall: true })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint(
        { ...valid, middlewares: [{ ...plugin, name: '' }] },
        {
          deferMiddlewareInstall: true
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint(
        { ...valid, middlewares: [plugin, { ...plugin }] },
        { deferMiddlewareInstall: true }
      )
    ).rejects.toMatchObject({ code: 'MIDDLEWARE_DUPLICATED' })
    await expect(
      prepareEndpoint(
        { ...valid, transport: undefined, middlewares: [{ ...plugin, transport: undefined }] },
        { deferMiddlewareInstall: true }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint(
        { ...valid, transport: alternateTransport, middlewares: [plugin] },
        {
          deferMiddlewareInstall: true
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint(
        { ...valid, transport: { platform: 'Memory' } },
        {
          deferMiddlewareInstall: true
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      prepareEndpoint(
        { ...valid, middlewares: [{ ...plugin, transport: alternateTransport }] },
        { deferMiddlewareInstall: true }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(prepareEndpoint(valid, { deferMiddlewareInstall: true })).resolves.toMatchObject({
      id: 'fixture-endpoint'
    })
  })

  it('preserves configured peers while bounding learned peers and translating cleanup leaves', () => {
    const peers = new PeerRegistry<string>(1, 10)
    peers.add('configured', true)
    peers.add('learned-1')
    peers.add('learned-2')
    expect(peers.has('configured')).toBe(true)
    expect(peers.has('learned-1')).toBe(false)
    expect([...peers]).toEqual(['configured', 'learned-2'])
    peers.removeLearned('learned-2')
    peers.remove('configured')
    peers.clear()
    expect(peers.snapshot()).toEqual([])
    expect(() => new PeerRegistry(0)).toThrowError()
    expect(() => new PeerRegistry(1, 0)).toThrowError()

    const lifecycle = new WebRpcLifecycleError('endpoint disposed')
    expect(translateEndpointDisposalError(lifecycle)).toBe(lifecycle)
    const rawError = new Error('raw cleanup')
    const extraError = new Error('extra cleanup')
    const translated = translateEndpointDisposalError(
      new AggregateError([{ resource: 'transport', error: rawError }, extraError]),
      [
        { resource: 'canonical-transport', error: rawError },
        { resource: 'middleware', error: extraError }
      ]
    )
    expect(translated).toBeInstanceOf(WebRpcLifecycleError)
    expect(translated.cleanupErrors).toEqual([
      { resource: 'canonical-transport', error: rawError },
      { resource: 'middleware', error: extraError }
    ])
    const deduplicated = translateEndpointDisposalError(rawError, [
      { resource: 'first', error: rawError },
      { resource: 'second', error: rawError }
    ])
    expect(deduplicated.cleanupErrors).toHaveLength(1)
    expect(translateEndpointDisposalError(undefined).cause).toBeUndefined()
  })

  it('expires learned peer knowledge while retaining configured-peer semantics', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const peers = new PeerRegistry<string>(2, 10)
      peers.add('learned')
      expect(peers.has('learned')).toBe(true)
      vi.setSystemTime(11)
      expect(peers.has('learned')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
