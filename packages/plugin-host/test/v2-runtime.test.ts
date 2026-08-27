import { describe, expect, it } from 'vitest'
import { PluginHost } from '../src/index.js'

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
    const batch = host.use(
      {
        name: 'first',
        shared: () => ({ staged: 'visible-inside-batch' }),
        install: () => ({ firstExtension: true })
      },
      {
        name: 'second',
        install: async (core) => {
          expect(core.getShared('staged')).toBe('visible-inside-batch')
          secondInstallStarted()
          await batchGate
          return { secondExtension: true }
        }
      }
    )

    await secondStarted
    expect(host.getShared('staged')).toBeUndefined()
    expect(Object.hasOwn(host, 'firstExtension')).toBe(false)
    releaseBatch()
    const view = await batch
    expect(view.getShared('staged')).toBe('visible-inside-batch')
    expect(view.extensions.firstExtension).toBe(true)
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
    const view = await host.use({
      name: 'extension',
      install: () => ({
        invoke(this: unknown): void {
          expect(this).toBe(host)
        }
      })
    })

    expect(view.host).toBe(host)
    expect(Object.getPrototypeOf(view)).toBeNull()
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.extensions)).toBe(true)
    expect((host as unknown as Record<string, unknown>).invoke).toBeUndefined()

    view.extensions.invoke()

    /** Result of the logical revoke and cleanup transaction. */
    const removal = await view.unUse('extension')
    expect(removal.ok).toBe(true)
    expect(removal.removed).toBe(true)
    expect(() => view.extensions.invoke).toThrow(/view has been revoked/)
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
