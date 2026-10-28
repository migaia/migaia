import { describe, expect, it } from 'vitest'

import { PluginHostError } from '../src/error-text.ts'
import { Host, plugin, TranslatingHost } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('finishes accepted mutations before dispose closes admission', async () => {
    const host = new Host()
    const order: string[] = []
    const installed = host.use(
      plugin(
        'a',
        async () => {
          await Promise.resolve()
          order.push('install')
          return {}
        },
        { dispose: () => order.push('dispose') }
      )
    )
    await installed
    const closing = host.dispose()
    await closing
    expect(order).toEqual(['install', 'dispose'])
    expect(() => host.use(plugin('b', () => ({})))).toThrow(PluginHostError)
  })

  it('rejects reads and pipeline execution after dispose starts', async () => {
    const host = new Host()
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const disposeStarted = new Promise<void>((resolve) => {
      entered = resolve
    })
    let core: unknown
    await host.use(
      plugin(
        'closing-read',
        (nextCore) => {
          core = nextCore
          return {}
        },
        {
          dispose: () =>
            new Promise<void>((resolve) => {
              entered?.()
              release = resolve
            })
        }
      )
    )
    const closing = host.dispose()
    await disposeStarted
    expect(() => host.run(1)).toThrow(PluginHostError)
    expect(() => host.config.get('closing-read.value')).toThrow(PluginHostError)
    expect(() => (core as { config: { get: () => unknown } }).config.get()).toThrow(PluginHostError)
    release?.()
    await closing
  })

  it('propagates exact HOST_DISPOSING from an async entry guard', async () => {
    const host = new Host({ pipeline: { mode: 'async' } })
    let started: (() => void) | undefined
    let release: (() => void) | undefined
    let disposalStarted: (() => void) | undefined
    let releaseDisposal: (() => void) | undefined
    const disposalReady = new Promise<void>((resolve) => {
      disposalStarted = resolve
    })
    await host.use(
      plugin('closing-gate', () => ({}), {
        dispose: () =>
          new Promise<void>((resolve) => {
            releaseDisposal = resolve
            disposalStarted?.()
          })
      })
    )
    const stageStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    host.useAsyncPipeline(async (_value, next) => {
      started?.()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await next(2)
    })
    const running = host.run(1)
    await stageStarted
    const closing = host.dispose()
    // V2 drains active pipeline leases before plugin cleanup; release the stage so disposal can
    // reach the registration disposer while preserving the abort assertion below.
    release?.()
    await disposalReady
    try {
      let caught: unknown
      try {
        await running
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(PluginHostError)
      expect((caught as PluginHostError).source).toBe('plugin.host')
      expect((caught as PluginHostError).code).toBe('HOST_DISPOSING')
      expect(caught).not.toBeInstanceOf(AggregateError)
      expect(caught).not.toHaveProperty('errors')
    } finally {
      releaseDisposal?.()
      await closing
    }
  })

  it('finishes synchronous install before dispose closes admission', async () => {
    const host = new Host()
    let core: unknown
    const installing = host.use(
      plugin(
        'admitted',
        (nextCore) => {
          core = nextCore
          return {}
        },
        { config: { enabled: true } }
      )
    )
    await expect(installing).resolves.toHaveLength(1)
    await expect(host.dispose()).resolves.toMatchObject({ logicalTerminal: true })
    expect(core).toBeDefined()
  })

  it('continues to dispose after an admitted mutation fails', async () => {
    const host = new Host()
    const disposing = host.use(
      plugin('failed', () => {
        throw new Error('install failed')
      })
    )
    const closing = host.dispose()
    await expect(disposing).rejects.toThrow('install failed')
    await expect(closing).resolves.toMatchObject({ logicalTerminal: true })
  })
})

describe('canonical disposal error transformation', () => {
  it('preserves the base error identity and transforms only at the sole disposal Promise', async () => {
    const raw = new Error('disposer failure')
    const install = (core: { onDispose: (dispose: () => void) => void }) => {
      core.onDispose(() => {
        throw raw
      })
      return {}
    }

    const base = new Host()
    await base.use({ name: 'base', install } as never)
    const baseResult = await base.dispose()
    expect(baseResult.logicalTerminal).toBe(true)
    expect(baseResult.cleanupComplete).toBe(true)
    expect((baseResult.cleanupErrors[0] as { readonly cause?: unknown }).cause).toBe(raw)

    const translating = new TranslatingHost()
    await translating.use({ name: 'translating', install } as never)
    const first = translating.dispose()
    expect(translating.dispose()).toBe(first)
    const translated = await first
    expect(translating.translations).toHaveBeenCalledTimes(0)
    expect(translated.cleanupComplete).toBe(true)
    expect((translated.cleanupErrors[0] as { readonly cause?: unknown }).cause).toBe(raw)
  })
})
