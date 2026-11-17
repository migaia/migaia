import { describe, expect, it, vi } from 'vitest'
import { definePlugin } from '../src/index.ts'
import { defineFeature } from '../src/modules/features/index.ts'
import { SuspendHost, execution } from './dependency-suspend-fixtures.ts'

/** Shape of the provider's cross-plugin Feature output used by both scenarios. */
type IQueryOutput = { query(): string }

describe('suspended dependent keeps a released provider Feature output', () => {
  it('rejects a retained output that forwards through featureExpose', async () => {
    const host = new SuspendHost({ execution })
    /** Stands in for a dependent's background work holding the injected provider output. */
    let retained: IQueryOutput | undefined
    const disposeProvider = vi.fn()
    const disposeConsumer = vi.fn()
    const providerValue = defineFeature(({ featureExpose }) => ({
      query: () => (featureExpose as IQueryOutput).query()
    }))
    const provider = definePlugin({
      name: 'p',
      features: { value: providerValue },
      install: () => ({}),
      featureExpose: () => ({ query: () => 'live' }),
      dispose: disposeProvider
    })
    const consumerValue = defineFeature(
      (_core, dependencies) => {
        retained = dependencies.p as IQueryOutput
        return {}
      },
      { p: provider.getFeature('value') }
    )
    const consumer = definePlugin({
      name: 'c',
      features: { value: consumerValue },
      install: () => ({}),
      dispose: disposeConsumer
    })
    await host.use(provider, consumer)
    expect(retained!.query()).toBe('live')

    await expect(host.unUse('p', { policy: 'suspend' })).resolves.toMatchObject({ ok: true })

    expect(disposeProvider).toHaveBeenCalledTimes(1)
    expect(disposeConsumer).not.toHaveBeenCalled()
    expect(() => retained!.query()).toThrow(
      expect.objectContaining({ code: 'REGISTRATION_REVOKED' })
    )
  })

  // Documented contract: the Host only revokes featureExpose. A Feature output that bypasses it
  // is the plugin author's responsibility, so the released resource stays reachable.
  it('does not intercept a retained output that holds the provider resource directly', async () => {
    const host = new SuspendHost({ execution })
    /** Stands in for a dependent's background work holding the injected provider output. */
    let retained: IQueryOutput | undefined
    /** Provider-owned resource; the provider's dispose marks it closed. */
    const connection = { closed: false, calls: 0 }
    const disposeConsumer = vi.fn()
    const providerValue = defineFeature(() => ({
      query: () => {
        connection.calls += 1
        return connection.closed ? 'closed' : 'live'
      }
    }))
    const provider = definePlugin({
      name: 'p',
      features: { value: providerValue },
      install: () => ({}),
      dispose: () => {
        connection.closed = true
      }
    })
    const consumerValue = defineFeature(
      (_core, dependencies) => {
        retained = dependencies.p as IQueryOutput
        return {}
      },
      { p: provider.getFeature('value') }
    )
    const consumer = definePlugin({
      name: 'c',
      features: { value: consumerValue },
      install: () => ({}),
      dispose: disposeConsumer
    })
    await host.use(provider, consumer)

    await expect(host.unUse('p', { policy: 'suspend' })).resolves.toMatchObject({ ok: true })

    expect(connection.closed).toBe(true)
    expect(disposeConsumer).not.toHaveBeenCalled()
    // No host check stands between the retained output and the released resource.
    expect(retained!.query()).toBe('closed')
    expect(connection.calls).toBe(1)
  })
})
