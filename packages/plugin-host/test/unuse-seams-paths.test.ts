import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'
import { openComposition } from '../src/composition-entry.js'

describe('A6 release paths', () => {
  it('runs the old dependent and provider hooks before replacement cleanup, once per generation', async () => {
    const events: string[] = []
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const service = defineFeature(() => ({ value: 1 }))
    const provider = definePlugin({
      name: 'P',
      features: { service },
      install: () => ({}),
      beforeRelease: () => {
        events.push('before P')
      },
      dispose: () => {
        events.push('dispose P')
      }
    })
    const dependent = definePlugin({
      name: 'R',
      features: {
        required: defineFeature((_core, dependencies) => ({ value: dependencies.service.value }), {
          service: provider.getFeature('service')
        })
      },
      install: () => ({}),
      beforeRelease: () => {
        events.push('before R')
      },
      dispose: () => {
        events.push('dispose R')
      }
    })
    await host.use(provider, dependent)
    const next = definePlugin({ name: 'P', features: { service }, install: () => ({}) })
    await host.replace('P', next)
    expect(events).toEqual(['before R', 'dispose R', 'before P', 'dispose P'])
    await host.dispose()
    expect(events).toEqual([
      'before R',
      'dispose R',
      'before P',
      'dispose P',
      'before R',
      'dispose R'
    ])
  })

  it('runs hooks in reverse disposal order and retains cleanup errors with their causes', async () => {
    const events: string[] = []
    const failure = new Error('hook failure')
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(
      definePlugin({
        name: 'P',
        install: () => ({}),
        beforeRelease: () => {
          events.push('before P')
          expect(() => host.use(definePlugin({ name: 'late', install: () => ({}) }))).toThrow(
            expect.objectContaining({ code: 'HOST_DISPOSING' })
          )
          throw failure
        },
        dispose: () => {
          events.push('dispose P')
        }
      }),
      definePlugin({
        name: 'Q',
        install: () => ({}),
        beforeRelease: () => {
          events.push('before Q')
        },
        dispose: () => {
          events.push('dispose Q')
        }
      })
    )
    const result = await host.dispose()
    expect(events).toEqual(['before Q', 'dispose Q', 'before P', 'dispose P'])
    expect(result.cleanupErrors).toEqual([
      expect.objectContaining({ code: 'PLUGIN_DISPOSE_FAILED', cause: failure })
    ])
  })

  it('does not invoke a candidate hook when replacement installation fails', async () => {
    const oldHook = vi.fn()
    const candidateHook = vi.fn()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(definePlugin({ name: 'P', install: () => ({}), beforeRelease: oldHook }))
    await expect(
      host.replace(
        'P',
        definePlugin({
          name: 'P',
          install: () => {
            throw new Error('candidate failed')
          },
          beforeRelease: candidateHook
        })
      )
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(oldHook).not.toHaveBeenCalled()
    expect(candidateHook).not.toHaveBeenCalled()
    await host.dispose()
    expect(oldHook).toHaveBeenCalledOnce()
    expect(candidateHook).not.toHaveBeenCalled()
  })

  it('runs a suspended dependent hook when provider recovery restarts its generation', async () => {
    const events: string[] = []
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const provider = definePlugin({
      name: 'P',
      features: { value: defineFeature(() => ({ value: 1 })) },
      install: () => ({})
    })
    const dependent = definePlugin({
      name: 'R',
      features: {
        value: defineFeature((_core, dependencies) => ({ value: dependencies.p.value }), {
          p: provider.getFeature('value')
        })
      },
      install: () => ({}),
      beforeRelease: () => {
        events.push('before R')
      },
      dispose: () => {
        events.push('dispose R')
      }
    })
    await host.use(provider, dependent)
    await host.unUse('P', { policy: 'suspend' })
    await host.use(
      definePlugin({
        name: 'P',
        features: { value: defineFeature(() => ({ value: 2 })) },
        install: () => ({})
      })
    )
    expect(events).toEqual(['before R', 'dispose R'])
    await host.dispose()
    expect(events).toEqual(['before R', 'dispose R', 'before R', 'dispose R'])
  })

  it('keeps the unUse hook in the queue ahead of a terminal disposal', async () => {
    const events: string[] = []
    /** Signals that the pre-release hook has started while its registration is still live. */
    let enter: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    /** Releases the hook after the terminal transition has been requested. */
    let finish: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await host.use(
      definePlugin({
        name: 'P',
        install: () => ({}),
        beforeRelease: async (context) => {
          events.push('before P')
          expect(context.signal.aborted).toBe(false)
          enter?.()
          await pending
        },
        dispose: () => {
          events.push('dispose P')
        }
      })
    )
    const removal = host.unUse('P')
    await entered
    const terminal = host.dispose()
    expect(() => host.use(definePlugin({ name: 'late', install: () => ({}) }))).toThrow(
      expect.objectContaining({ code: 'HOST_DISPOSING' })
    )
    finish?.()
    await removal
    await terminal
    expect(events).toEqual(['before P', 'dispose P'])
  })

  it('does not run hooks for discarded admissions or composition removal', async () => {
    const hook = vi.fn()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const composition = openComposition(host)
    const admission = composition.createPluginAdmission({
      name: 'managed',
      install: () => ({}),
      beforeRelease: hook
    })
    const slot = composition.createDataOrderSlot('managed')
    const discarded = await composition.prepareAdmissions([{ admission, slot }])
    await composition.discardPreparedAdmissions(discarded)
    expect(hook).not.toHaveBeenCalled()
    const prepared = await composition.prepareAdmissions([{ admission, slot }])
    const [receipt] = composition.commitPreparedAdmissions(prepared)
    await composition.commitPreparedUnUseBatch(composition.prepareUnUseBatch([receipt!]), {
      beforeCleanup: Promise.resolve()
    })
    expect(hook).not.toHaveBeenCalled()
    await host.dispose()
    expect(hook).not.toHaveBeenCalled()
  })
})
