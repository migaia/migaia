import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope } from '../../../src/contract/index.js'
import { createMemoryTransportPair } from '../../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../../src/core/client.js'
import { createProviderEndpoint } from '../../../src/core/provider.js'
import { createComposedEndpoint } from '../../../src/core/composed.js'
import { createClientFirstPartyRoots } from '../../../src/core/internal/client-first-party-roots.js'
import type { IRpcTransport } from '../../../src/core/transport.js'
import type { IRpcPlugin } from '../../../src/core/typing.js'
import { abort } from '../../../src/core/middleware/abort.js'
import { connect } from '../../../src/core/middleware/connect.js'
import { createEndpointTimePort } from '../../../src/core/internal/time-port.js'
import { createConstructionControl } from '../../../src/core/internal/construction-install.js'
import { raceWithAsyncControl } from '../../../src/core/internal/async-control.js'

/** A signal double whose reason getter throws while its abort notification stays controllable. */
function throwingSignal(
  failure: Error,
  initiallyAborted: boolean,
  onRead?: () => void
): {
  readonly signal: AbortSignal
  readonly reads: () => number
  readonly fire: () => void
} {
  /** Tracks precisely one external abort listener and its removal. */
  const listeners = new Set<() => void>()
  let aborted = initiallyAborted
  let reads = 0
  const signal = {
    get aborted() {
      return aborted
    },
    get reason(): never {
      reads += 1
      onRead?.()
      throw failure
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener)
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener)
    }
  } as unknown as AbortSignal
  return {
    signal,
    reads: () => reads,
    fire: () => {
      aborted = true
      for (const listener of listeners) listener()
    }
  }
}

describe('guarded abort reason policy', () => {
  it('[A5] rejects a pre-aborted caller with CANCELLED and the getter failure as cause', async () => {
    const [transport] = createMemoryTransportPair()
    const client = await createClientEndpoint({
      id: 'reason-client',
      transport,
      targetIds: ['reason-server'],
      middlewares: [connect({ transport }), abort()]
    })
    const failure = new Error('reason getter')
    const source = throwingSignal(failure, true)
    try {
      let rejection: unknown
      try {
        await client.send('reason-server', 'wait', null, { signal: source.signal })
      } catch (error) {
        rejection = error
      }
      expect(rejection).toMatchObject({ name: 'AbortError', code: 'CANCELLED', cause: failure })
      expect(source.reads()).toBe(1)
    } finally {
      await client.dispose()
    }
  })

  it('[A5] settles event abort once and sends one remote cancellation', async () => {
    const [clientWire, providerWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        sent.push(message)
        return clientWire.send(message, options)
      }
    }
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const provider = await createProviderEndpoint({
      id: 'reason-provider',
      transport: providerWire,
      middlewares: [connect({ transport: providerWire }), abort()],
      provider: {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) =>
            context.signal.addEventListener('abort', resolve, { once: true })
          )
          return context.success('late')
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'reason-client-event',
      transport: capture,
      middlewares: [connect({ transport: capture }), abort()]
    })
    const failure = new Error('event reason getter')
    let source!: ReturnType<typeof throwingSignal>
    source = throwingSignal(failure, false, () => source.fire())
    try {
      const result = client.send('reason-provider', 'wait', null, {
        signal: source.signal,
        timeoutMs: false
      })
      void result.catch(() => undefined)
      await providerStarted
      source.fire()
      let rejection: unknown
      try {
        await result
      } catch (error) {
        rejection = error
      }
      expect(rejection).toMatchObject({ name: 'AbortError', code: 'CANCELLED', cause: failure })
      expect(source.reads()).toBe(1)
      await vi.waitFor(() => {
        expect(
          sent
            .map((frame) => normalizeRpcEnvelope(frame))
            .filter((frame) => frame.kind === 'variation')
        ).toHaveLength(1)
      })
      const variations = sent
        .map((frame) => normalizeRpcEnvelope(frame))
        .filter((frame) => frame.kind === 'variation')
      expect(variations).toHaveLength(1)
      expect(variations[0]).toMatchObject({ data: { route: { variation: 'abort' } } })
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })

  it('[A6] preserves a throwing construction reason as an aborted signal value', () => {
    const failure = new Error('construction reason')
    const source = throwingSignal(failure, true)
    let control: ReturnType<typeof createConstructionControl> | undefined
    expect(() => {
      control = createConstructionControl({
        signal: source.signal,
        time: createEndpointTimePort(systemScheduler)
      })
    }).not.toThrow()
    expect(control?.signal.aborted).toBe(true)
    expect(control?.signal.reason).toBe(failure)
    expect(source.reads()).toBe(1)
    control?.close()
  })

  it('[A6] rejects endpoint construction through the coded cancellation chain', async () => {
    const [transport] = createMemoryTransportPair()
    const failure = new Error('construction getter')
    const source = throwingSignal(failure, true)
    let pending: Promise<unknown>
    expect(() => {
      pending = createClientEndpoint({
        id: 'construction-reason-client',
        transport,
        middlewares: [connect({ transport })],
        construction: { signal: source.signal }
      })
    }).not.toThrow()
    let rejection: unknown
    try {
      await pending!
    } catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({ code: 'CANCELLED', cause: failure })
    expect(source.reads()).toBe(1)
  })

  it('[A6] aborts a pending install and releases its owned resource', async () => {
    const [transport] = createMemoryTransportPair()
    const failure = new Error('mid-install reason')
    const source = throwingSignal(failure, false)
    let started!: () => void
    const installStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let releases = 0
    const pending: IRpcPlugin = {
      name: 'reason-pending-install',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      install(scope) {
        scope.own({}, () => {
          releases += 1
        })
        started()
        return new Promise<never>(() => undefined)
      }
    }
    const construction = createComposedEndpoint(
      {
        id: 'mid-install-reason',
        transport,
        middlewares: [connect({ transport }), pending],
        construction: { signal: source.signal }
      },
      createClientFirstPartyRoots()
    )
    await installStarted
    source.fire()
    let rejection: unknown
    try {
      await construction
    } catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({ code: 'CANCELLED', cause: failure })
    expect(releases).toBe(1)
    expect(source.reads()).toBe(1)
  })

  it('[A7] reports a throwing race reason once and passes it to the abort factory', async () => {
    const failure = new Error('race reason')
    const source = throwingSignal(failure, true)
    const diagnostics: unknown[] = []
    const factoryArguments: unknown[] = []
    const result = raceWithAsyncControl({
      time: createEndpointTimePort(systemScheduler),
      operation: async () => 'late',
      signals: [source.signal],
      createTimeoutError: () => new Error('timeout'),
      createAbortError: (reason) => {
        factoryArguments.push(reason)
        return new Error('abort', { cause: reason })
      },
      onDiagnostic: (error) => {
        diagnostics.push(error)
      }
    })
    let rejection: unknown
    try {
      await result
    } catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({ cause: failure })
    expect(factoryArguments).toEqual([failure])
    expect(diagnostics).toEqual([failure])
    expect(source.reads()).toBe(1)
  })

  it('[A8] exposes one helper that converts a throwing getter into reason data', async () => {
    const failure = new Error('reason')
    const source = throwingSignal(failure, true)
    const { resolveAbortReason } = await import('../../../src/core/internal/async-control.js')
    expect(typeof resolveAbortReason).toBe('function')
    expect(resolveAbortReason(source.signal)).toBe(failure)
    expect(source.reads()).toBe(1)
  })
})
