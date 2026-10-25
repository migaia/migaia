import { createRuntimeEndpointComposition } from '../../../dist/core/runtime-api-endpoint.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { throwingSignal } from '../../fixtures/throwing-signal.js'
import { createMemoryTransportPair } from '../../fixtures/memory-transport.js'

import type { IRpcPlugin } from '../../../dist/core/typing.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { createEndpointTimePort } from '../../../dist/core/internal/time-port.js'
import { createConstructionControl } from '../../../dist/core/internal/construction-install.js'
import { raceWithAsyncControl } from '../../../dist/core/internal/async-control.js'

describe('guarded abort reason policy', () => {
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
