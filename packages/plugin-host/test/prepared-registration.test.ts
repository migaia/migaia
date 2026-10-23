import { expect, it } from 'vitest'
import {
  defineHost,
  definePlugin,
  getPluginRuntimeIntegration,
  PluginHost,
  type IPluginHostCore,
  type IPluginRuntimeIntegration
} from '../src/index.js'

for (const mode of ['class', 'frozen'] as const) {
  it(`${mode} original batch admits exact prepared reads without granting late installation rights`, async () => {
    const options = {
      execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
    }
    const host = mode === 'class' ? new PluginHost(options) : defineHost({ host: options })
    let core!: IPluginHostCore
    let prepared!: IPluginRuntimeIntegration
    try {
      await host.use(
        definePlugin('prepared', (input) => ({
          install: () => {
            core = input
            prepared = getPluginRuntimeIntegration(input)
            prepared.assertPreparedRegistration()
            return {}
          }
        })),
        definePlugin('bootstrap', () => ({
          install: () => {
            expect(() => core.config.get()).toThrowError(
              expect.objectContaining({ code: 'PLUGIN_NOT_INSTALLED' })
            )
            expect(() => prepared.assertCurrent()).toThrowError(
              expect.objectContaining({ code: 'REGISTRATION_REVOKED' })
            )
            expect(() => core.onDispose(() => undefined)).toThrowError(
              expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
            )
            expect(() => prepared.assertPreparedRegistration()).not.toThrow()
            return {}
          }
        }))
      )
      expect(() => prepared.assertPreparedRegistration()).not.toThrow()
      await host.unUse('prepared')
      expect(() => prepared.assertPreparedRegistration()).toThrowError(
        expect.objectContaining({ code: 'REGISTRATION_REVOKED' })
      )
    } finally {
      await host.dispose()
    }
  })

  it(`${mode} failed original batch revokes prepared reads and keeps reverse rollback ownership`, async () => {
    const options = {
      execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
    }
    const host = mode === 'class' ? new PluginHost(options) : defineHost({ host: options })
    let prepared!: IPluginRuntimeIntegration
    const releases: string[] = []
    const original = new RangeError('bootstrap failed')
    try {
      await expect(
        host.use(
          definePlugin('prepared', (core) => ({
            install: () => {
              prepared = getPluginRuntimeIntegration(core)
              core.onDispose(() => {
                releases.push('prepared')
              })
              return {}
            }
          })),
          definePlugin('bootstrap', (core) => ({
            install: () => {
              core.onDispose(() => {
                releases.push('bootstrap')
              })
              prepared.assertPreparedRegistration()
              throw original
            }
          }))
        )
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: original })
      expect(releases).toEqual(['bootstrap', 'prepared'])
      expect(() => prepared.assertPreparedRegistration()).toThrowError(
        expect.objectContaining({ code: 'REGISTRATION_REVOKED' })
      )
    } finally {
      await host.dispose()
    }
  })
}
