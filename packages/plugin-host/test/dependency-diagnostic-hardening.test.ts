import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'
import { execution } from './dependency-lifecycle-fixtures.js'

describe('Feature rejection reporting through the host outlet', () => {
  it('delivers the rejection object with the reporter failure reachable and preserves its own cause', async () => {
    const originalCause = new Error('original cause')
    const rejection = new Error('feature rejected', { cause: originalCause })
    const reporterFailure = new Error('reporter failed')
    const seen: unknown[] = []
    let calls = 0
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: (_message, _code, error) => {
        calls += 1
        if (calls === 1) throw reporterFailure
        seen.push(error)
      }
    })
    await expect(
      host.use(
        definePlugin({
          name: 'rejecting',
          features: { invalid: defineFeature((() => Promise.reject(rejection)) as never) },
          install: () => ({})
        })
      )
    ).rejects.toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rejection.cause).toBe(originalCause)
    expect(seen).toHaveLength(1)
    const reported = seen[0] as Error
    const branches = [
      reported,
      reported.cause,
      ...((reported.cause as AggregateError)?.errors ?? [])
    ]
    expect(branches).toContain(rejection)
    expect(branches).toContain(reporterFailure)
  })
})

describe('diagnostic outlet failures', () => {
  it('routes a throwing diagnostic outlet to onDiagnosticFailure with the exact failure', async () => {
    const outletFailure = new Error('outlet failed')
    const failures: unknown[] = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: () => {
        throw outletFailure
      },
      onDiagnosticFailure: (error) => {
        failures.push(error)
      }
    })
    await host.use(
      definePlugin({
        name: 'A',
        install: () => ({}),
        dispose: () => {
          throw new Error('old dispose failed')
        }
      })
    )
    await host.replace('A', definePlugin({ name: 'A', install: () => ({}) }))
    expect(failures).toContain(outletFailure)
  })

  it('routes the second reporter failure of a Feature rejection to onDiagnosticFailure', async () => {
    const outletFailure = new Error('outlet always fails')
    const failures: unknown[] = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: () => {
        throw outletFailure
      },
      onDiagnosticFailure: (error) => {
        failures.push(error)
      }
    })
    await expect(
      host.use(
        definePlugin({
          name: 'rejecting',
          features: {
            invalid: defineFeature((() => Promise.reject(new Error('rejected'))) as never)
          },
          install: () => ({})
        })
      )
    ).rejects.toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(failures).toEqual([outletFailure])
  })

  it('rejects a non-function onDiagnosticFailure as INVALID_OPTION', () => {
    expect(
      () => new PluginHost<Record<string, never>>({ execution, onDiagnosticFailure: 1 as never })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.invalidOption }))
  })
})
