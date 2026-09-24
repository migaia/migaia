import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

class V2Host extends PluginHost<Record<string, never>, string> {}

describe('PluginHost V2 runtime contract', () => {
  it('validates execution policy before touching unrelated option getters', () => {
    /** Options whose unrelated pipeline getter must remain unread on invalid execution input. */
    const options = { execution: null } as unknown as Record<string, unknown>
    let pipelineRead = false
    Object.defineProperty(options, 'pipeline', {
      get: () => {
        pipelineRead = true
        throw new Error('unrelated pipeline getter')
      }
    })

    expect(() => new V2Host(options as never)).toThrow(TypeError)
    expect(pipelineRead).toBe(false)
  })

  it('rejects either missing execution budget before touching unrelated option getters', () => {
    /** Each partial policy must fail before the unrelated pipeline option is read. */
    for (const execution of [{ pipelineDrainTimeoutMs: false }, { mutationTimeoutMs: false }]) {
      let pipelineRead = false
      const options = { execution } as unknown as Record<string, unknown>
      Object.defineProperty(options, 'pipeline', {
        get: () => {
          pipelineRead = true
          throw new Error('unrelated pipeline getter')
        }
      })
      expect(() => new V2Host(options as never)).toThrow(TypeError)
      expect(pipelineRead).toBe(false)
    }
  })

  it('keeps async batch candidates private until one publication point', async () => {
    /** Gate held by the later plugin while the earlier candidate remains unpublished. */
    let releaseBatch!: () => void
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve
    })
    /** Signals that the later install reached its await boundary. */
    let secondInstallStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => {
      secondInstallStarted = resolve
    })
    const host = new V2Host({
      execution: { mutationTimeoutMs: 1000, pipelineDrainTimeoutMs: 1000 }
    })
    const staged = defineFeature(() => ({ value: 'visible-inside-batch' }))
    const first = definePlugin({
      name: 'first',
      features: { staged },
      install: () => ({ firstExtension: true })
    })
    const second = definePlugin({
      name: 'second',
      features: {
        observed: defineFeature((_core, dependencies) => dependencies.staged, {
          staged: first.getFeature('staged')
        })
      },
      install: async (core) => {
        expect(core.features.observed.value).toBe('visible-inside-batch')
        secondInstallStarted()
        await batchGate
        return { secondExtension: true }
      }
    })
    const batch = host.use(first, second)

    await secondStarted
    expect(openComposition(host).getCurrentSnapshot().extensions.firstExtension).toBeUndefined()
    releaseBatch()
    const handles = await batch
    expect(handles[0].extensions.firstExtension).toBe(true)
    await host.dispose()
  })

  it('reports settled cleanup errors without marking physical cleanup incomplete', async () => {
    /** Exact synchronous cleanup failure retained by the structured disposal result. */
    const cleanupError = new Error('settled cleanup failure')
    const host = new V2Host({
      execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: 100 }
    })
    await host.use({
      name: 'settled-failure',
      install: () => ({}),
      [Symbol.dispose]: () => {
        throw cleanupError
      }
    } as never)

    const result = await host.dispose()
    expect(result.cleanupComplete).toBe(true)
    expect((result.cleanupErrors[0] as { readonly cause?: unknown }).cause).toBe(cleanupError)
    expect(result.physicalCompletion).toBeUndefined()
  })

  it('publishes immutable extension views and revokes stale views', async () => {
    /** Host under test with explicit bounded operation policy. */
    const host = new V2Host({
      execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: 100 }
    })
    /** Materialized V2 view returned by composition. */
    const [handle] = await host.use({
      name: 'extension',
      install: () => ({
        invoke(this: unknown): void {
          expect(this).toBe(host)
        }
      })
    })

    expect(Object.isFrozen(handle)).toBe(true)
    expect(Object.isFrozen(handle.extensions)).toBe(true)
    expect((host as unknown as Record<string, unknown>).invoke).toBeUndefined()

    const invoke = handle.extensions.invoke
    invoke()

    /** Result of the logical revoke and cleanup transaction. */
    expect(await host.unUse('extension')).toEqual({ ok: true })
    expect(() => invoke()).toThrowError(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
  })

  it('keeps operation and registration signals distinct', async () => {
    /** Host under test with explicit bounded operation policy. */
    const host = new V2Host({
      execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: 100 }
    })
    /** Signal supplied for the current install operation. */
    let operationSignal: unknown
    /** Signal supplied for the committed registration lifetime. */
    let lifecycleSignal: unknown
    await host.use({
      name: 'signals',
      install: (core) => {
        operationSignal = core.operation.signal
        lifecycleSignal = core.lifecycle.signal
        return {}
      }
    })
    expect(operationSignal).not.toBe(lifecycleSignal)
    await host.dispose()
    expect((lifecycleSignal as { readonly aborted: boolean }).aborted).toBe(true)
  })
})
