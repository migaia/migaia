import { describe, expect, it } from 'vitest'
import {
  type IPluginDependencyMutationOptions,
  type IPluginDependencyPlan,
  type IPluginHostCore,
  type IPluginRemoval
} from '@migaia/plugin-host'
import { createHost } from '../src/host/index.ts'
import { RuntimeHost, hostOptions, plugin, type IRuntimeCase } from './executable-closure-helper.ts'

const runtimeCases: readonly IRuntimeCase[] = [
  {
    id: 'lists installed plugins',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.plugins).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'lists ready plugins',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.readyPlugins).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'commits a plugin removal',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result).toMatchObject({ ok: true, removed: true, committed: true })
      await host.dispose()
    }
  },
  {
    id: 'completes removal cleanup without errors',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result.cleanupErrors).toEqual([])
      expect(result.cleanupComplete).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'reinstalls a removed plugin',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      await host.unUse('one')
      const replacement = await host.use(plugin('one'))
      expect(replacement).toMatchObject({ ok: true, committed: true })
      await host.dispose()
    }
  },
  {
    id: 'starts a populated host active',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.state).toBe('active')
      await host.dispose()
    }
  },
  {
    id: 'hides the retired getShared accessor',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect('getShared' in host).toBe(false)
      await host.dispose()
    }
  },
  {
    id: 'reports an installed plugin as ready',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.pluginState('one')).toBe('ready')
      await host.dispose()
    }
  },
  {
    id: 'installs a second plugin',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.use(plugin('two'))
      expect(result.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'installs initial plugins in declaration order',
    run: async () => {
      const events: string[] = []
      const host = await createHost({
        ...hostOptions(),
        plugins: [
          {
            name: 'one',
            install: () => {
              events.push('one')
              return {}
            }
          },
          {
            name: 'two',
            install: () => {
              events.push('two')
              return {}
            }
          }
        ] as never
      })
      expect(events).toEqual(['one', 'two'])
      await host.dispose()
    }
  },
  {
    id: 'rolls back factory setup and keeps cleanup failure detail',
    run: async () => {
      const events: string[] = []
      const primary = new Error('initial setup failure')
      const cleanupError = new Error('host cleanup failure')
      class FailingCleanupHost extends RuntimeHost {
        /** Counts concrete Host disposal calls during factory rollback. */
        disposeCalls = 0
        /** Records logical removals so the private Tray anchor cleanup is observable. */
        removedNames: string[] = []

        /** Records concrete removals while preserving PluginHost's canonical mutation path. */
        override unUse(
          name: string,
          options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
        ): Promise<IPluginDependencyPlan>
        override unUse(
          name: string,
          options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
        ): Promise<IPluginRemoval>
        override unUse(name: string, options?: IPluginDependencyMutationOptions) {
          this.removedNames.push(name)
          return options?.dryRun === true
            ? super.unUse(name, { ...options, dryRun: true })
            : super.unUse(name, { ...options, dryRun: false })
        }

        /** Returns a deterministic cleanup failure while preserving physical completion identity. */
        override dispose() {
          this.disposeCalls += 1
          const physicalCompletion = Promise.resolve({
            cleanupErrors: Object.freeze([cleanupError])
          })
          return Promise.resolve({
            logicalTerminal: true as const,
            cleanupComplete: false,
            cleanupErrors: Object.freeze([cleanupError]),
            physicalCompletion
          })
        }
      }
      let concrete: FailingCleanupHost | undefined
      let thrown: unknown
      try {
        await createHost({
          ...hostOptions(
            [
              {
                name: 'one',
                install: (core: IPluginHostCore<string>) => {
                  events.push('install:one')
                  core.onDispose(() => {
                    events.push('dispose:one')
                  })
                  return {}
                }
              },
              {
                name: 'failing',
                install: () => {
                  throw primary
                }
              }
            ] as never,
            () => {
              concrete = new FailingCleanupHost({
                execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
              })
              return concrete
            }
          )
        })
      } catch (error) {
        thrown = error
      }
      // Tray detail wraps the untouched PluginHost error, whose cause retains the native setup error.
      expect((thrown as Error).cause).toMatchObject({
        source: 'plugin.host',
        code: 'PLUGIN_INSTALL_FAILED'
      })
      expect(((thrown as Error).cause as Error).cause).toBe(primary)
      expect(thrown).toMatchObject({
        detail: {
          phase: 'factory',
          cleanupComplete: false,
          cleanupErrors: [cleanupError]
        }
      })
      const detail = (
        thrown as { readonly detail: { readonly physicalCompletion?: Promise<unknown> } }
      ).detail
      expect(concrete?.disposeCalls).toBe(1)
      expect(concrete?.removedNames.some((name) => name.startsWith('__migaia_tray_anchor_'))).toBe(
        true
      )
      expect(events).toEqual(['install:one', 'dispose:one'])
      expect(detail.physicalCompletion).toBeDefined()
      await expect(detail.physicalCompletion).resolves.toEqual({ cleanupErrors: [cleanupError] })
    }
  },
  {
    id: 'cascades provider removal to its consumer',
    run: async () => {
      const host = await createHost(
        hostOptions([plugin('consumer', ['provider']), plugin('provider')])
      )
      const result = await host.unUse('provider')
      expect(result.affected).toEqual(['provider', 'consumer'])
      await host.dispose()
    }
  },
  {
    id: 'restores a consumer after its provider returns',
    run: async () => {
      const host = await createHost(
        hostOptions([plugin('consumer', ['provider']), plugin('provider')])
      )
      await host.unUse('provider')
      const result = await host.use(plugin('provider'))
      expect(result.ok).toBe(true)
      expect(host.readyPlugins).toEqual(['consumer', 'provider'])
      await host.dispose()
    }
  },
  {
    id: 'blocks a consumer whose provider is missing',
    run: async () => {
      const host = await createHost(hostOptions([plugin('consumer', ['missing'])]))
      expect(host.pluginState('consumer')).toBe('blocked')
      const result = await host.unUse('missing')
      expect(result.removed).toBe(false)
      await host.dispose()
    }
  },
  {
    id: 'replaces an installed plugin',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.replace(plugin('one'))
      expect(result.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'reports a failed replacement',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.replace({
        name: 'one',
        install: () => {
          throw new Error('replacement')
        }
      } as never)
      expect(result.ok).toBe(false)
      await host.dispose()
    }
  },
  {
    id: 'rejects use on an empty unconfigured host',
    run: async () => {
      const host = await createHost(hostOptions())
      await host.dispose()
      await expect(host.use(plugin('late'))).rejects.toBeDefined()
    }
  },
  {
    id: 'emits use events',
    run: async () => {
      const host = await createHost(hostOptions())
      const seen: string[] = []
      host.on('use', (event) => {
        seen.push(String(event.value.name))
      })
      await host.use(plugin('one'))
      expect(seen).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'disposes into the terminal state',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.dispose()
      expect(result.state).toBe('terminal')
    }
  },
  {
    id: 'completes strict-drain shutdown cleanup',
    run: async () => {
      const host = await createHost({
        ...hostOptions([plugin('one')]),
        shutdown: { mode: 'strict-drain' as const }
      })
      expect((await host.dispose()).cleanupComplete).toBe(true)
    }
  },
  {
    id: 'rejects a negative quiescence window',
    run: async () => {
      await expect(createHost({ ...hostOptions(), quiescenceMs: -1 })).rejects.toBeDefined()
    }
  },
  {
    id: 'exposes the use mutation',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(typeof host.use).toBe('function')
      await host.dispose()
    }
  },
  {
    id: 'commits concurrent installs',
    run: async () => {
      const host = await createHost(hostOptions())
      const [left, right] = await Promise.all([host.use(plugin('left')), host.use(plugin('right'))])
      expect(left.ok && right.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'reports a committed install',
    run: async () => {
      const host = await createHost(hostOptions())
      const result = await host.use(plugin('one'))
      expect(result.committed).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'reports a populated host as active',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.isActive).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'completes synchronous removal cleanup',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result.cleanupComplete).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'omits physical completion for synchronous removal',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result.physicalCompletion).toBeUndefined()
      await host.dispose()
    }
  },
  {
    id: 'lists a plugin installed after creation',
    run: async () => {
      const host = await createHost(hostOptions())
      await host.use(plugin('one'))
      expect(host.plugins).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'returns a committed view with the ready plugin',
    run: async () => {
      const host = await createHost(hostOptions())
      const result = await host.use(plugin('one'))
      expect(result.view.pluginState('one')).toBe('ready')
      await host.dispose()
    }
  },
  {
    id: 'starts an empty host active',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(host.state).toBe('active')
      await host.dispose()
    }
  },
  {
    id: 'starts with no extensions',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(host.extensions).toEqual({})
      await host.dispose()
    }
  },
  {
    id: 'installs into an empty host',
    run: async () => {
      const host = await createHost(hostOptions())
      const result = await host.use(plugin('one'))
      expect(result.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'rejects a plugin with an empty name',
    run: async () => {
      const host = await createHost(hostOptions())
      await expect(host.use({ name: '' } as never)).rejects.toBeDefined()
      await host.dispose()
    }
  },
  {
    id: 'keeps an empty host active before mutations',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(host.state).toBe('active')
      await host.dispose()
    }
  },
  {
    id: 'implements async disposal',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(Reflect.get(host, Symbol.asyncDispose)).toBeTypeOf('function')
      await host.dispose()
    }
  }
]

describe('executable Tray Host and Graph acceptance oracles', () => {
  it.each(runtimeCases)('$id', async ({ run }) => {
    await run()
  })
})
