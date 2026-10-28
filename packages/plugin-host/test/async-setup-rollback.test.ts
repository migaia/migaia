import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHostErrorCode } from '../src/index.ts'
import { deferred, createHost } from './async-setup-fixtures.ts'

describe('async setup installation', () => {
  it('rolls setup resources back in reverse order and retains the primary cause', async () => {
    const { host } = createHost()
    const events: string[] = []
    const primary = new Error('setup failed')
    const first = definePlugin({
      name: 'q',
      install: (core) => {
        core.onDispose(() => {
          events.push('q')
        })
        return {}
      }
    })
    const second = definePlugin({
      name: 'p',
      setup: (context) => {
        context.onDispose(() => {
          events.push('r1')
        })
        context.onDispose(() => {
          events.push('r2')
        })
        throw primary
      },
      install: () => {
        events.push('install')
        return {}
      }
    })
    await expect(host.use(first, second)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary,
      detail: { failedName: 'p' }
    })
    expect(events).toEqual(['r2', 'r1', 'q'])
    await host.dispose()
  })

  it('reports rollback failures without replacing the setup rejection', async () => {
    const reports: Array<{ code: unknown; error: unknown }> = []
    const { host } = createHost(false, (_message, code, error) => reports.push({ code, error }))
    const gate = deferred<never>()
    const primary = new Error('primary setup rejection')
    const cleanup = new Error('cleanup failure')
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (context) => {
          context.onDispose(() => {
            throw cleanup
          })
          return gate.promise
        },
        install: () => ({})
      })
    )
    gate.reject(primary)
    let failure: unknown
    try {
      await installing
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary,
      detail: { rollbackErrors: [cleanup] }
    })
    expect(
      reports.some((entry) => entry.code === PluginHostErrorCode.pluginInstallRollbackFailed)
    ).toBe(true)
    await host.dispose()
  })

  it('releases setup resources after install resources if install fails', async () => {
    const { host } = createHost()
    const order: string[] = []
    const primary = new Error('install failure')
    await expect(
      host.use(
        definePlugin({
          name: 'p',
          setup: (context) => {
            context.onDispose(() => {
              order.push('setup')
            })
            return { ready: true }
          },
          install: (core) => {
            core.onDispose(() => {
              order.push('install')
            })
            throw primary
          }
        })
      )
    ).rejects.toMatchObject({ code: PluginHostErrorCode.pluginInstallFailed, cause: primary })
    expect(order).toEqual(['install', 'setup'])
    await host.dispose()
  })

  it('releases a committed setup resource when a later batch member fails', async () => {
    const { host } = createHost()
    const primary = new Error('dependent failed')
    const release = vi.fn()
    const provider = definePlugin({
      name: 'p',
      features: { ready: defineFeature(() => ({ value: 1 })) },
      setup: (context) => {
        context.onDispose(release)
        return 1
      },
      install: () => ({})
    })
    const dependent = definePlugin({
      name: 'c',
      features: {
        use: defineFeature(() => ({ ready: true }), { p: provider.getFeature('ready') })
      },
      install: () => {
        throw primary
      }
    })
    await expect(host.use(provider, dependent)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary
    })
    expect(release).toHaveBeenCalledTimes(1)
    await host.dispose()
  })
})
