import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostError } from '../src/index.js'
import { execution } from './dependency-suspend-fixtures.js'

describe('dependency suspension and recovery', () => {
  it('keeps a disabled rebindable middle node disabled while its provider returns', async () => {
    for (const newDefinition of [false, true]) {
      const host = new PluginHost<Record<string, never>>({ execution })
      const p = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 1 })) },
        install: () => ({})
      })
      const hook = vi.fn()
      const installs = { m: 0, s: 0 }
      const m = definePlugin({
        name: 'm',
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
            p: p.getFeature('value')
          })
        },
        onDependencyReplaced: hook,
        install: () => {
          installs.m += 1
          return {}
        }
      })
      const s = definePlugin({
        name: 's',
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.m.value }), {
            m: m.getFeature('value')
          })
        },
        install: () => {
          installs.s += 1
          return {}
        }
      })
      const [, handleM, handleS] = await host.use(p, m, s)
      await host.plugin.disable('m', { policy: 'suspend' })
      await host.unUse('p', { policy: 'suspend' })
      const returningProvider = newDefinition
        ? definePlugin({
            name: 'p',
            features: { value: defineFeature(() => ({ value: 2 })) },
            install: () => ({})
          })
        : p
      await host.use(returningProvider)
      const readError = (read: () => unknown): unknown => {
        try {
          read()
        } catch (error) {
          return error
        }
        return undefined
      }
      const middleError = readError(() => handleM.getFeature('value'))
      const successorError = readError(() => handleS.getFeature('value'))
      expect(middleError).toBeInstanceOf(PluginHostError)
      expect(middleError).toMatchObject({ code: 'PLUGIN_DISABLED' })
      expect(successorError).toBeInstanceOf(PluginHostError)
      expect(successorError).toMatchObject({ code: 'PLUGIN_SUSPENDED' })
      expect(hook).toHaveBeenCalledTimes(1)
      expect(hook.mock.calls[0]?.[0]).toBe('p')
      await host.plugin.enable('m')
      expect(handleM.getFeature('value')).toMatchObject({ value: expect.any(Number) })
      expect(handleS.getFeature('value')).toMatchObject({ value: expect.any(Number) })
      expect(installs).toEqual({ m: 1, s: 1 })
      await host.dispose()
    }
  })

  it('restarts a disabled dependent without a hook and rebinds one with a hook', async () => {
    for (const withHook of [false, true]) {
      const host = new PluginHost<Record<string, never>>({ execution })
      const p = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 1 })) },
        install: () => ({})
      })
      const hook = vi.fn()
      let installs = 0
      const d = definePlugin({
        name: 'd',
        features: {
          value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
            p: p.getFeature('value')
          })
        },
        ...(withHook ? { onDependencyReplaced: hook } : {}),
        install: () => {
          installs += 1
          return {}
        }
      })
      const [, handleD] = await host.use(p, d)
      await host.plugin.disable('d')
      const p2 = definePlugin({
        name: 'p',
        features: { value: defineFeature(() => ({ value: 2 })) },
        install: () => ({})
      })
      await host.replace('p', p2)
      expect(() => handleD.getFeature('value')).toThrow(
        expect.objectContaining({ code: 'PLUGIN_DISABLED' })
      )
      expect(installs).toBe(withHook ? 1 : 2)
      if (withHook) {
        expect(hook).toHaveBeenCalledTimes(1)
        expect(hook.mock.calls[0]?.[0]).toBe('p')
        expect(hook.mock.calls[0]?.[1]).toMatchObject({ value: { value: 2 } })
      }
      await host.plugin.enable('d')
      if (withHook) expect(handleD.getFeature('value')).toMatchObject({ value: expect.any(Number) })
      else expect(handleD.getFeature('value')).toEqual({ value: 2 })
      await host.dispose()
    }
  })
})
