import { createRuntimeEndpointComposition } from '../../../dist/core/runtime-api-endpoint.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createMemoryTransportPair } from '../../fixtures/memory-transport.js'

import type { IRpcTransport } from '../../../dist/core/transport.js'
import type { IRpcPlugin } from '../../../dist/core/typing.js'
import { abort } from '../../../dist/core/middleware/abort.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { createEndpointTimePort } from '../../../dist/core/internal/time-port.js'
import { createConstructionControl } from '../../../dist/core/internal/construction-install.js'
import { raceWithAsyncControl } from '../../../dist/core/internal/async-control.js'

/** A signal double whose reason getter throws while its abort notification stays controllable. */
function throwingSignal(failure: Error, initiallyAborted: boolean, onRead?: () => void) {
  return new ThrowingSignal(failure, initiallyAborted, onRead)
}

/** One controlled native-signal double owns reason reads and exact abort-listener membership. */
class ThrowingSignal {
  /** Original reason failure remains the exact error instance returned through caller cause chains. */
  readonly #failure: Error
  /** Optional original getter observer runs before throwing the same failure. */
  readonly #onRead: (() => void) | undefined
  /** Only fire changes the original controlled signal's aborted fact. */
  #aborted: boolean
  /** Getter reads remain independently observable without reading reason a second time. */
  #reads = 0
  /** Original external abort callbacks are delivered in the same Set insertion order. */
  readonly #listeners = new Set<() => void>()
  /** The held native-shaped signal keeps the original own getters and exact callback results. */
  readonly signal: AbortSignal

  /** Capture original getter inputs without reading reason or notifying listeners during setup. */
  constructor(failure: Error, initiallyAborted: boolean, onRead?: () => void) {
    this.#failure = failure
    this.#aborted = initiallyAborted
    this.#onRead = onRead
    this.signal = ThrowingSignal.#view(this)
  }
  /** Preserve receiver-independent own getter semantics while state belongs to the named owner. */
  static #view(owner: ThrowingSignal): AbortSignal {
    return {
      get aborted() {
        return owner.#aborted
      },
      get reason(): never {
        owner.#reads += 1
        owner.#onRead?.()
        throw owner.#failure
      },
      addEventListener(_type: string, listener: () => void) {
        owner.#listeners.add(listener)
      },
      removeEventListener(_type: string, listener: () => void) {
        owner.#listeners.delete(listener)
      }
    } as unknown as AbortSignal
  }
  /** Observe the original reason-read count without invoking the throwing getter. */
  readonly reads = (): number => this.#reads
  /** Publish the same synchronous abort fact before visiting the original listener Set. */
  readonly fire = (): void => {
    this.#aborted = true
    for (const listener of this.#listeners) listener()
  }
}

describe('guarded abort reason policy', () => {
  it('rejects a pre-aborted caller with CANCELLED and the getter failure as cause', async () => {
    const [transport] = createMemoryTransportPair()
    const client = await createRuntimeEndpointComposition(
      {
        id: 'reason-client',
        transport,
        targetIds: ['reason-server'],
        middlewares: [connect({ transport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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

  it('settles event abort once and sends one remote cancellation', async () => {
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
    const provider = await createRuntimeEndpointComposition(
      {
        id: 'reason-provider',
        transport: providerWire,
        middlewares: [connect({ transport: providerWire }), abort()],
        provider: {
          wait: async (context) => {
            started()
            await new Promise<void>((resolve) =>
              context.signal.addEventListener('abort', () => resolve(), { once: true })
            )
            return context.success('late')
          }
        }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'reason-client-event',
        transport: capture,
        middlewares: [connect({ transport: capture }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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

  it('preserves a throwing construction reason as an aborted signal value', () => {
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

  it('rejects endpoint construction through the coded cancellation chain', async () => {
    const [transport] = createMemoryTransportPair()
    const failure = new Error('construction getter')
    const source = throwingSignal(failure, true)
    let pending: Promise<unknown>
    expect(() => {
      pending = createRuntimeEndpointComposition(
        {
          id: 'construction-reason-client',
          transport,
          middlewares: [connect({ transport })],
          construction: { signal: source.signal }
        },
        { agreement: { capabilities: [] }, peerId: '' }
      ).installing
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

  it('aborts a pending install and releases its owned resource', async () => {
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
    const construction = createRuntimeEndpointComposition(
      {
        id: 'mid-install-reason',
        transport,
        middlewares: [connect({ transport }), pending],
        construction: { signal: source.signal }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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

  it('reports a throwing race reason once and passes it to the abort factory', async () => {
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

  it('exposes one helper that converts a throwing getter into reason data', async () => {
    const failure = new Error('reason')
    const source = throwingSignal(failure, true)
    const { resolveAbortReason } = await import('../../../dist/core/internal/async-control.js')
    expect(typeof resolveAbortReason).toBe('function')
    expect(resolveAbortReason(source.signal)).toBe(failure)
    expect(source.reads()).toBe(1)
  })
})
