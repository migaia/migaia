import { describe, expect, it, vi } from 'vitest'
import { PluginHost, PluginHostError } from '../src/index.js'
import type { IPluginInstallFailureDetail } from '../src/index.js'

type IInstallCore = {
  onDispose(resource: () => void): void
}

class Host extends PluginHost<Record<string, never>, number> {
  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  installSync(plugins: readonly unknown[]) {
    return this.useSync(plugins as never)
  }
}

const installable = (name: string, install: (core: IInstallCore) => Record<string, unknown>) => ({
  name,
  install
})

describe('PluginHost install failure detail', () => {
  it('preserves the primary install failure before a message conversion failure', async () => {
    /** The conversion is observational and must never replace the failed installer. */
    const conversion = new Error('install message conversion')
    /** Native errors can expose a message value whose display conversion invokes user code. */
    const primary = new Error('install-primary')
    Object.defineProperty(primary, 'message', {
      value: {
        toString() {
          throw conversion
        }
      }
    })
    /** Exercise the actual asynchronous registration transaction and its original rollback owner. */
    const host = new Host()
    /** Retains the actual package boundary error for exact-reference cause assertions. */
    let caught: unknown
    try {
      await host.use(
        installable('failed', () => {
          throw primary
        })
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PluginHostError)
    expect(caught).toMatchObject({
      source: 'plugin.host',
      code: 'PLUGIN_INSTALL_FAILED',
      message: '[plugin-host] plugin "failed" failed to install'
    })
    /** The original registration failure remains first and the failed display conversion second. */
    const cause = (caught as Error).cause as AggregateError
    expect(cause).toBeInstanceOf(AggregateError)
    expect(cause.errors).toHaveLength(2)
    expect(cause.errors[0]).toBe(primary)
    expect(cause.errors[1]).toBe(conversion)
  })

  it('preserves async primary and two rollback identities in reverse order when diagnostic throws', async () => {
    const primary = new Error('install-primary')
    const firstRollback = new Error('first-rollback')
    const secondRollback = new Error('second-rollback')
    const diagnosticFailure = new Error('diagnostic-failure')
    const diagnostic = vi.fn(() => {
      throw diagnosticFailure
    })
    const host = new Host({ diagnostic })
    let caught: unknown

    try {
      await host.use(
        installable('first', (core) => {
          core.onDispose(() => {
            throw firstRollback
          })
          return {}
        }),
        installable('second', (core) => {
          core.onDispose(() => {
            throw secondRollback
          })
          return {}
        }),
        installable('failed', () => {
          throw primary
        })
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PluginHostError)
    const failure = caught as PluginHostError<IPluginInstallFailureDetail>
    expect(failure.message).toBe('[plugin-host] plugin "failed" failed to install: install-primary')
    expect(failure.cause).toBe(primary)
    expect(failure.detail?.failedName).toBe('failed')
    expect(failure.detail?.rollbackErrors).toEqual([secondRollback, firstRollback])
    expect(diagnostic).toHaveBeenCalledTimes(1)
  })

  it('publishes immutable sync detail and resolves final rollback identities after completion', async () => {
    const primary = new Error('sync-install-primary')
    const firstRollback = new Error('sync-first-rollback')
    const secondRollback = new Error('sync-second-rollback')
    const diagnosticFailure = new Error('sync-diagnostic-failure')
    const diagnostic = vi.fn(() => {
      throw diagnosticFailure
    })
    const host = new Host({ diagnostic })
    let caught: unknown

    try {
      host.installSync([
        {
          ...installable('first', (core) => {
            core.onDispose(() => {
              throw firstRollback
            })
            return { firstExtension: true }
          })
        },
        {
          ...installable('second', (core) => {
            core.onDispose(() => {
              throw secondRollback
            })
            return { secondExtension: true }
          })
        },
        {
          name: 'failed',
          install: () => {
            throw primary
          }
        }
      ])
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PluginHostError)
    const failure = caught as PluginHostError<IPluginInstallFailureDetail>
    const publishedDetail = failure.detail
    expect(failure.cause).toBe(primary)
    expect(publishedDetail?.failedName).toBe('failed')
    expect(publishedDetail?.rollbackErrors).toEqual([])
    expect(Object.isFrozen(publishedDetail)).toBe(true)
    expect(Object.isFrozen(publishedDetail?.rollbackErrors)).toBe(true)
    expect((host as unknown as Record<string, unknown>).firstExtension).toBeUndefined()
    expect((host as unknown as Record<string, unknown>).secondExtension).toBeUndefined()

    const finalDetail = await publishedDetail?.completion
    expect(finalDetail?.failedName).toBe('failed')
    expect(finalDetail?.rollbackErrors).toEqual([secondRollback, firstRollback])
    expect(publishedDetail?.rollbackErrors).toEqual([])
    expect(failure.detail).toBe(publishedDetail)
    expect(diagnostic).toHaveBeenCalledTimes(2)
  })
})
