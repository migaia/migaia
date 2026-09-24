import { describe, expect, it, vi } from 'vitest'
import {
  defineFeature,
  defineHost,
  definePlugin,
  PluginHost,
  PluginHostErrorCode
} from '../src/index.js'
import type { IPluginHostCore } from '../src/index.js'

/** Explicit unbounded policy keeps enablement tests independent of wall-clock timing. */
const execution = { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }

/** Test Host exposing the protected synchronous pipeline runner. */
class Host extends PluginHost<Record<string, never>, string> {
  run(value = ''): string {
    let result = value
    this.runPipeline(value, (next) => {
      result = next
    })
    return result
  }
}

/** Creates a plugin with one stable extension capability. */
const extensionPlugin = (name: string) =>
  definePlugin({ name, install: () => ({ [`${name}Extension`]: () => name }) })

describe('plugin enablement', () => {
  it('class and handle share one enablement runtime through the functional Host', async () => {
    const handle = defineHost({ host: { execution } })
    const [pluginHandle] = await handle.use(extensionPlugin('bridge'))
    await handle.plugin.disable('bridge')
    expect(handle.plugin.disabled()).toEqual(['bridge'])
    expect(pluginHandle.name).toBe('bridge')
    await handle.plugin.enable('bridge')
    expect(handle.plugin.disabled()).toEqual([])
    await handle.dispose()
  })
  it('disabled plugin is absent from the next view', async () => {
    const host = new Host({ execution })
    const [handle] = await host.use(extensionPlugin('alpha'))
    expect(handle.extensions.alphaExtension()).toBe('alpha')
    await host.plugin.disable('alpha')
    expect(() => handle.extensions).toThrowError(
      expect.objectContaining({ code: PluginHostErrorCode.pluginDisabled })
    )
    await host.dispose()
  })

  it('disable revokes previously published references: extension calls fail immediately', async () => {
    const host = new Host({ execution })
    const [handle] = await host.use(extensionPlugin('alpha'))
    const call = handle.extensions.alphaExtension
    await host.plugin.disable('alpha')
    expect(call).toThrowError(expect.objectContaining({ code: PluginHostErrorCode.pluginDisabled }))
    await host.dispose()
  })

  it('disable revokes previously published references: Feature expose fails before resolution', async () => {
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => ({ read: core.featureExpose.read }))
    let output: { readonly read: () => number } | undefined
    const plugin = definePlugin({
      name: 'feature-owner',
      features: { feature },
      featureExpose: { read: () => 1 },
      install: (core) => {
        output = core.features.feature
        return {}
      }
    })
    const host = new Host({ execution })
    await host.use(plugin)
    const disabling = host.plugin.disable('feature-owner')
    await disabling
    expect(() => output!.read()).toThrowError(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
    await host.dispose()
  })

  it('disable and enable keep stage order stable: a disabled stage is skipped', async () => {
    const host = new Host({ execution })
    const stage = definePlugin<IPluginHostCore<string>, Record<string, never>, string>({
      name: 'stage',
      install: (core) => {
        core.usePipeline((value, next) => next(`${value}A`))
        return {}
      }
    })
    await host.use(stage)
    expect(host.run()).toBe('A')
    await host.plugin.disable('stage')
    expect(host.run()).toBe('')
    await host.plugin.enable('stage')
    expect(host.run()).toBe('A')
    await host.dispose()
  })

  it('disable and enable keep stage order stable: enable restores the original slot', async () => {
    const host = new Host({ execution })
    const stage = (name: string) =>
      definePlugin<IPluginHostCore<string>, Record<string, never>, string>({
        name,
        install: (core) => {
          core.usePipeline((value, next) => next(`${value}${name}`))
          return {}
        }
      })
    await host.use(stage('a'), stage('b'))
    await host.plugin.disable('a')
    await host.use(stage('c'))
    expect(host.run()).toBe('bc')
    await host.plugin.enable('a')
    expect(host.run()).toBe('abc')
    await host.dispose()
  })

  it('disable notifies without releasing resources: cleanup remains owned by unUse', async () => {
    const onDisable = vi.fn()
    const dispose = vi.fn()
    const resourceDispose = vi.fn()
    const host = new Host({ execution })
    await host.use(
      definePlugin({
        name: 'resource',
        onDisable,
        dispose,
        install: (core) => {
          core.onDispose(resourceDispose)
          return {}
        }
      })
    )
    await host.plugin.disable('resource')
    expect(onDisable).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    expect(resourceDispose).not.toHaveBeenCalled()
    await host.unUse('resource')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(resourceDispose).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('disable notifies without releasing resources: repeat disable is idempotent', async () => {
    const onDisable = vi.fn()
    const host = new Host({ execution })
    await host.use(definePlugin({ name: 'repeat', onDisable, install: () => ({}) }))
    await host.plugin.disable('repeat')
    const revision = host.revision
    await host.plugin.disable('repeat')
    expect(onDisable).toHaveBeenCalledTimes(1)
    expect(host.revision).toBe(revision)
    expect(host.plugin.disabled()).toEqual(['repeat'])
    await host.dispose()
  })

  it('disable notifies without releasing resources: round trip retains extension identity', async () => {
    const onEnable = vi.fn()
    const host = new Host({ execution })
    const [first] = await host.use(
      definePlugin({ name: 'round-trip', onEnable, install: () => ({ action: () => 1 }) })
    )
    const action = first.extensions.action
    const { token } = await host.plugin.disable('round-trip')
    await token.enable()
    expect(first.extensions.action).toBe(action)
    expect(onEnable).toHaveBeenCalledTimes(2)
    await host.dispose()
  })

  it.each(['plugin', 'identity'])(
    'host protocol names cannot be claimed by an extension: %s',
    async (key) => {
      const host = new Host({ execution })
      await expect(
        host.use({ name: `reserved-${key}`, install: () => ({ [key]: true }) } as never)
      ).rejects.toMatchObject({ cause: { code: PluginHostErrorCode.extensionReserved } })
      await host.dispose()
    }
  )
})
