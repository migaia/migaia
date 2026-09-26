import { systemScheduler } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { raceWithAsyncControl } from '../../src/core/internal/async-control.js'
import { prepareEndpoint as prepareEndpointImpl } from '../../src/core/internal/endpoint-bootstrap.js'
import { allocateRpcId } from '../../src/core/internal/id.js'
import { ResourceScope } from '../../src/core/internal/resource-scope.js'
import { createEndpointTimePort } from '../../src/core/internal/time-port.js'
import { createEndpointTransportActivation } from '../../src/core/internal/transport-activation.js'
import { PeerRegistry } from '../../src/core/internal/peers.js'
import { translateEndpointDisposalError } from '../../src/core/internal/disposal-translation.js'
import { RpcLifecycleError } from '../../src/core/errors.js'
import type { IRpcTransport } from '../../src/core/transport.js'

describe('internal ownership boundary semantics', () => {
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
    const transport: IRpcTransport = {
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

    const failingTransport: IRpcTransport = {
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
      const time = createEndpointTimePort(systemScheduler)
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
      await expect(
        raceWithAsyncControl({
          time: createEndpointTimePort(systemScheduler),
          operation: async () => 'resolved',
          timeoutMs: false,
          createTimeoutError: () => new Error('timeout'),
          createAbortError: () => new Error('abort')
        })
      ).resolves.toBe('resolved')
      await expect(
        raceWithAsyncControl({
          time: createEndpointTimePort(systemScheduler),
          operation: async () => {
            throw new Error('operation failed')
          },
          timeoutMs: false,
          createTimeoutError: () => new Error('timeout'),
          createAbortError: () => new Error('abort')
        })
      ).rejects.toThrow('operation failed')
      const timedOut = raceWithAsyncControl({
        time: createEndpointTimePort(systemScheduler),
        operation: () => new Promise<string>(() => undefined),
        timeoutMs: 1,
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('abort')
      })
      vi.advanceTimersByTime(1)
      await expect(timedOut).rejects.toThrow('timeout')

      const abortController = new AbortController()
      const aborted = raceWithAsyncControl({
        time: createEndpointTimePort(systemScheduler),
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
          time: {
            setTimeout: () => {
              throw new Error('timer setup')
            }
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
    ).resolves.toMatchObject({ id: 'fixture-endpoint', transport: alternateTransport })
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
    ).resolves.toMatchObject({ id: 'fixture-endpoint', transport })
    await expect(prepareEndpoint(valid, { deferMiddlewareInstall: true })).resolves.toMatchObject({
      id: 'fixture-endpoint'
    })
  })

  it('preserves configured peers while bounding learned peers and translating cleanup leaves', () => {
    const peers = new PeerRegistry<string>(() => Date.now(), 1, 10)
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
    expect(() => new PeerRegistry(() => Date.now(), 0)).toThrowError()
    expect(() => new PeerRegistry(() => Date.now(), 1, 0)).toThrowError()

    const lifecycle = new RpcLifecycleError('endpoint disposed')
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
    expect(translated).toBeInstanceOf(RpcLifecycleError)
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
      const peers = new PeerRegistry<string>(() => Date.now(), 2, 10)
      peers.add('learned')
      expect(peers.has('learned')).toBe(true)
      vi.setSystemTime(11)
      expect(peers.has('learned')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
