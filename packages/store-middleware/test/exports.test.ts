import { describe, expect, it } from 'vitest'
import { createMutationPolicy, createStoreMiddlewareHost, middlewarePlugin } from '../src/index'
import { createRuntime } from '@migaia/reactive'

/** Explicit unbounded policy used by the Store export smoke test. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

describe('store-middleware exports', () => {
  it('exposes mutation policy', () => {
    const policy = createMutationPolicy('actions-only')
    expect(() => policy.assertMutationAllowed()).toThrow()
  })

  it('uses PluginHost for middleware installation and disposal', async () => {
    const runtime = createRuntime()
    const events: string[] = []
    const host = createStoreMiddlewareHost({
      execution,
      runtime,
      getState: () => ({ value: 1 }),
      pipeline: { mode: 'async' }
    })

    await host.use(
      middlewarePlugin<{ value: number }>('capture', (event, _context, next) => {
        events.push(event.type)
        next()
      })
    )
    host.recordState('test', { value: 0 }, { value: 1 })
    expect(events).toEqual(['state'])

    await host.unUse('capture')
    host.recordState('test', { value: 1 }, { value: 2 })
    expect(events).toEqual(['state'])
    await host.dispose()
  })
})
