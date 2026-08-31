import { describe, expect, it } from 'vitest'
import { createDynamicCapabilityGraph } from '@migaia/capability/graph/dynamic'
import { PluginHost, type IPluginHostCore } from '@migaia/plugin-host'
import { createHost } from '../src/host/index.js'

class RuntimeHost extends PluginHost<Record<string, never>, string> {}

class AsyncRuntimeHost extends RuntimeHost {
  runValue(value: string): Promise<void> {
    return Promise.resolve(this.runPipeline(value, () => undefined))
  }
}

class CountingRuntimeHost extends RuntimeHost {
  /** Counts raw disposal calls so concurrent managed/raw disposal remains observable. */
  disposeCalls = 0

  /** Delegates raw disposal while retaining its call count. */
  override dispose() {
    this.disposeCalls += 1
    return super.dispose()
  }
}

const hostOptions = (
  plugins: readonly unknown[] = [],
  create: () => RuntimeHost = () =>
    new RuntimeHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
) => ({
  create,
  plugins: plugins as never,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' as const }
})

const plugin = (name: string, requires: readonly string[] = []) =>
  ({
    name,
    requires,
    install: (core: IPluginHostCore<string>) => {
      core.onDispose(() => undefined)
      return { [name]: name }
    }
  }) as never

const graphId = (id: string) => id as never

const graphNode = (id: string, dependencies: readonly string[] = [], value: unknown = id) => ({
  id: id as never,
  kind: 'executable-closure',
  dependencies: dependencies.map((provider) => ({
    provider: provider as never,
    required: true as const
  })),
  start: () => ({ value, release: () => undefined })
})

type IRuntimeCase = Readonly<{ readonly id: string; readonly run: () => Promise<void> }>

const runtimeCases: readonly IRuntimeCase[] = [
  {
    id: 'TPD-T01',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.plugins).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'TPD-T02',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.readyPlugins).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'TPD-T03',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result).toMatchObject({ ok: true, removed: true, committed: true })
      await host.dispose()
    }
  },
  {
    id: 'TPD-T04',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result.cleanupErrors).toEqual([])
      expect(result.cleanupComplete).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T05',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      await host.unUse('one')
      const replacement = await host.use(plugin('one'))
      expect(replacement).toMatchObject({ ok: true, committed: true })
      await host.dispose()
    }
  },
  {
    id: 'TPD-T06',
    run: async () => {
      const graph = createDynamicCapabilityGraph()
      await graph.register(graphNode('provider'))
      await graph.register(graphNode('consumer', ['provider']))
      await graph.ready()
      expect(graph.nodeState(graphId('consumer')).state).toBe('ready')
      await graph.dispose()
    }
  },
  {
    id: 'TPD-T07',
    run: async () => {
      const graph = createDynamicCapabilityGraph()
      await expect(graph.register(graphNode('invalid', ['invalid']))).rejects.toBeDefined()
      expect(graph.nodes).toEqual([])
      await graph.dispose()
    }
  },
  {
    id: 'TPD-T08',
    run: async () => {
      const graph = createDynamicCapabilityGraph()
      await graph.register(graphNode('one', [], 1))
      await graph.ready()
      const result = await graph.replace(graphNode('one', [], 2))
      expect(result.topologyChanged).toBe(false)
      expect(result.affected).toEqual(['one'])
      expect(graph.nodeState(graphId('one')).value).toBe(2)
      await graph.dispose()
    }
  },
  {
    id: 'TPD-T09',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.state).toBe('active')
      await host.dispose()
    }
  },
  {
    id: 'TPD-T10',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.getShared('missing')).toBeUndefined()
      await host.dispose()
    }
  },
  {
    id: 'TPD-T11',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.pluginState('one')).toBe('ready')
      await host.dispose()
    }
  },
  {
    id: 'TPD-T12',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.use(plugin('two'))
      expect(result.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T13',
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
    id: 'TPD-T14',
    run: async () => {
      const events: string[] = []
      const primary = new Error('initial setup failure')
      const cleanupError = new Error('host cleanup failure')
      class FailingCleanupHost extends RuntimeHost {
        /** Counts concrete Host disposal calls during factory rollback. */
        disposeCalls = 0
        /** Records logical removals so the private Tray anchor cleanup is observable. */
        removedNames: string[] = []

        /** Wraps the dynamic view to retain the exact logical removal names. */
        override getCurrentView() {
          const view = super.getCurrentView()
          return {
            ...view,
            unUse: async (name: string) => {
              this.removedNames.push(name)
              return view.unUse(name)
            }
          }
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
      expect((thrown as Error & { readonly cause?: unknown }).cause).toBe(primary)
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
    id: 'TPD-T15',
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
    id: 'TPD-T16',
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
    id: 'TPD-T17',
    run: async () => {
      const host = await createHost(hostOptions([plugin('consumer', ['missing'])]))
      expect(host.pluginState('consumer')).toBe('blocked')
      const result = await host.unUse('missing')
      expect(result.removed).toBe(false)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T18',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.replace(plugin('one'))
      expect(result.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T19',
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
    id: 'TPD-T20',
    run: async () => {
      const host = await createHost(hostOptions())
      await host.dispose()
      await expect(host.use(plugin('late'))).rejects.toBeDefined()
    }
  },
  {
    id: 'TPD-T21',
    run: async () => {
      let releaseStage!: () => void
      let started!: () => void
      const stageStarted = new Promise<void>((resolve) => {
        started = resolve
      })
      const stageGate = new Promise<void>((resolve) => {
        releaseStage = resolve
      })
      let disposed = false
      let raw: AsyncRuntimeHost | undefined
      const host = await createHost({
        ...hostOptions(),
        quiescenceMs: 0,
        create: () => {
          raw = new AsyncRuntimeHost({
            pipeline: { mode: 'async' },
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
          })
          return raw
        },
        plugins: [
          {
            name: 'staged',
            install: (core: IPluginHostCore<string>) => {
              core.useAsyncPipeline(
                async (value: string, next: (value: string) => Promise<void>) => {
                  started()
                  await stageGate
                  await next(value)
                }
              )
              core.onDispose(() => {
                disposed = true
              })
              return {}
            }
          }
        ] as never
      })
      const running = raw!.runValue('value')
      await stageStarted
      const removal = await host.unUse('staged')
      expect(removal.cleanupComplete).toBe(false)
      expect(removal.cleanupErrors).toEqual([])
      expect(removal.physicalCompletion).toBeDefined()
      expect(disposed).toBe(false)
      releaseStage()
      await running
      await removal.physicalCompletion
      expect(disposed).toBe(true)
      await host.dispose()

      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason)
      }
      const processEvents = (
        globalThis as typeof globalThis & {
          readonly process: {
            on: (event: string, listener: (reason: unknown) => void) => void
            off: (event: string, listener: (reason: unknown) => void) => void
          }
        }
      ).process
      processEvents.on('unhandledRejection', onUnhandled)
      type IRaceHost = Awaited<ReturnType<typeof createHost<RuntimeHost, readonly never[]>>>
      type IRaceOperation = Readonly<{
        readonly label: string
        readonly run: () => Promise<unknown>
      }>
      const runRace = async (
        operations: (
          host: IRaceHost,
          raw: CountingRuntimeHost,
          tracked: (name: string) => unknown
        ) => readonly IRaceOperation[],
        initialNames: readonly string[],
        expectClosed = false,
        expectedFacadeState: 'terminal' | 'failed' = 'terminal',
        expectedPlugins?: readonly string[],
        expectedRevisionDelta?: readonly [number, number]
      ): Promise<void> => {
        const installs = new Map<string, number>()
        const disposals = new Map<string, number>()
        const tracked = (name: string) => {
          return {
            name,
            install: (core: IPluginHostCore<string>) => {
              installs.set(name, (installs.get(name) ?? 0) + 1)
              core.onDispose(() => {
                disposals.set(name, (disposals.get(name) ?? 0) + 1)
              })
              return { [name]: name }
            }
          }
        }
        let raw: CountingRuntimeHost | undefined
        const raceHost = await createHost({
          ...hostOptions(initialNames.map((name) => tracked(name))),
          create: () => {
            raw = new CountingRuntimeHost({
              execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
            })
            return raw
          }
        })
        const rawHost = raw!
        const initialRevision = rawHost.revision
        const raceOperations = operations(raceHost, rawHost, tracked)
        const results = await Promise.allSettled(raceOperations.map(({ run }) => run()))
        const committedViews: { readonly plugins: readonly string[] }[] = []
        for (const [index, result] of results.entries()) {
          const operation = raceOperations[index]
          expect(operation).toBeDefined()
          if (result.status === 'rejected') {
            expect(result.reason, operation?.label).toMatchObject({
              code: expect.any(String)
            })
          } else {
            expect(result.value, operation?.label).toBeDefined()
            if (result.value && typeof result.value === 'object' && 'view' in result.value)
              committedViews.push(
                (result.value as { readonly view: { readonly plugins: readonly string[] } }).view
              )
          }
        }
        if (expectClosed) {
          expect(() => raceHost.plugins).toThrow()
          for (const view of committedViews) expect(() => view.plugins).toThrow()
        } else {
          for (const view of committedViews) expect(view.plugins).toEqual(raceHost.plugins)
          expect(raceHost.plugins).toEqual(expectedPlugins)
          expect(rawHost.revision, `initial=${initialRevision}`).toBe(
            initialRevision + expectedRevisionDelta![0]
          )
        }
        const preDisposeRevision = rawHost.revision
        const managedDisposal = raceHost.dispose()
        const managedResult = await managedDisposal
        expect(managedResult.state).toBe('terminal')
        if (expectedFacadeState === 'failed')
          expect(['terminal', 'failed']).toContain(raceHost.state)
        else expect(raceHost.state).toBe('terminal')
        expect(raceHost.isActive).toBe(false)
        expect(rawHost.revision).toBeGreaterThanOrEqual(initialRevision)
        if (expectedRevisionDelta !== undefined)
          expect(rawHost.revision).toBeGreaterThanOrEqual(
            initialRevision + expectedRevisionDelta[0]
          )
        expect(preDisposeRevision).toBeGreaterThanOrEqual(initialRevision)
        expect(rawHost.disposeCalls).toBeGreaterThan(0)
        expect(() => rawHost.getCurrentView()).toThrow()
        const terminalRevision = rawHost.revision
        await raceHost.dispose()
        expect(rawHost.revision).toBe(terminalRevision)
        for (const [name, count] of installs) expect(disposals.get(name) ?? 0).toBe(count)
        for (const view of committedViews) expect(() => view.plugins).toThrow()
      }
      try {
        await runRace(
          (raceHost, _raw, tracked) => [
            { label: 'use:left', run: () => raceHost.use(tracked('left') as never) },
            { label: 'use:right', run: () => raceHost.use(tracked('right') as never) },
            { label: 'duplicate:left', run: () => raceHost.use(tracked('left') as never) }
          ],
          ['seed'],
          false,
          'terminal',
          ['seed', 'left', 'right'],
          [2, 2]
        )
        await runRace(
          (raceHost, _raw, tracked) => [
            { label: 'use:added', run: () => raceHost.use(tracked('added') as never) },
            { label: 'replace:seed', run: () => raceHost.replace(tracked('seed') as never) }
          ],
          ['seed'],
          false,
          'terminal',
          ['seed', 'added'],
          [3, 3]
        )
        await runRace(
          (raceHost, _raw) => [
            { label: 'unUse:seed', run: () => raceHost.unUse('seed') },
            { label: 'dispose:managed', run: () => raceHost.dispose() }
          ],
          ['seed'],
          true
        )
        await runRace(
          (raceHost, _raw, tracked) => [
            { label: 'replace:seed', run: () => raceHost.replace(tracked('seed') as never) },
            { label: 'dispose:managed', run: () => raceHost.dispose() }
          ],
          ['seed'],
          true,
          'failed'
        )
        await runRace(
          (raceHost, raw, tracked) => [
            { label: 'use:added', run: () => raceHost.use(tracked('added') as never) },
            { label: 'dispose:raw', run: () => raw.dispose() }
          ],
          ['seed'],
          true,
          'failed'
        )
      } finally {
        processEvents.off('unhandledRejection', onUnhandled)
      }
      expect(unhandled).toEqual([])
    }
  },
  {
    id: 'TPD-T22',
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
    id: 'TPD-T23',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.dispose()
      expect(result.state).toBe('terminal')
    }
  },
  {
    id: 'TPD-T24',
    run: async () => {
      const host = await createHost({
        ...hostOptions([plugin('one')]),
        shutdown: { mode: 'strict-drain' as const }
      })
      expect((await host.dispose()).cleanupComplete).toBe(true)
    }
  },
  {
    id: 'TPD-T25',
    run: async () => {
      await expect(createHost({ ...hostOptions(), quiescenceMs: -1 })).rejects.toBeDefined()
    }
  },
  {
    id: 'TPD-T26',
    run: async () => {
      const graph = createDynamicCapabilityGraph()
      await graph.register(graphNode('one'))
      await graph.register(graphNode('unrelated'))
      const result = await graph.register(graphNode('two', ['one']))
      expect(result.affected).toEqual(['two'])
      expect(graph.nodeState(graphId('two')).state).toBe('ready')
      expect(graph.nodeState(graphId('unrelated')).state).toBe('ready')
      await graph.dispose()
    }
  },
  {
    id: 'TPD-T27',
    run: async () => {
      const graph = createDynamicCapabilityGraph()
      await graph.register(graphNode('one'))
      await graph.register(graphNode('two', ['one']))
      expect(graph.nodes).toEqual(['one', 'two'])
      await graph.dispose()
    }
  },
  {
    id: 'TPD-T28',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(typeof host.use).toBe('function')
      await host.dispose()
    }
  },
  {
    id: 'TPD-T31',
    run: async () => {
      const host = await createHost(hostOptions())
      const [left, right] = await Promise.all([host.use(plugin('left')), host.use(plugin('right'))])
      expect(left.ok && right.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T32',
    run: async () => {
      const host = await createHost(hostOptions())
      const result = await host.use(plugin('one'))
      expect(result.committed).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T33',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      expect(host.isActive).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T34',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result.cleanupComplete).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T35',
    run: async () => {
      const host = await createHost(hostOptions([plugin('one')]))
      const result = await host.unUse('one')
      expect(result.physicalCompletion).toBeUndefined()
      await host.dispose()
    }
  },
  {
    id: 'TPD-T36',
    run: async () => {
      const host = await createHost(hostOptions())
      await host.use(plugin('one'))
      expect(host.plugins).toEqual(['one'])
      await host.dispose()
    }
  },
  {
    id: 'TPD-T37',
    run: async () => {
      const host = await createHost(hostOptions())
      const result = await host.use(plugin('one'))
      expect(result.view.pluginState('one')).toBe('ready')
      await host.dispose()
    }
  },
  {
    id: 'TPD-T38',
    run: async () => {
      const graph = createDynamicCapabilityGraph()
      await graph.register(graphNode('first'))
      await graph.register(graphNode('second'))
      expect(graph.nodes).toEqual(['first', 'second'])
      await graph.dispose()
    }
  },
  {
    id: 'TPD-T39',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(host.state).toBe('active')
      await host.dispose()
    }
  },
  {
    id: 'TPD-T40',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(host.extensions).toEqual({})
      await host.dispose()
    }
  },
  {
    id: 'TPD-T41',
    run: async () => {
      const host = await createHost(hostOptions())
      const result = await host.use(plugin('one'))
      expect(result.ok).toBe(true)
      await host.dispose()
    }
  },
  {
    id: 'TPD-T42',
    run: async () => {
      const host = await createHost(hostOptions())
      await expect(host.use({ name: '' } as never)).rejects.toBeDefined()
      await host.dispose()
    }
  },
  {
    id: 'TPD-T43',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(host.state).toBe('active')
      await host.dispose()
    }
  },
  {
    id: 'TPD-T44',
    run: async () => {
      const host = await createHost(hostOptions())
      expect(Reflect.get(host, Symbol.asyncDispose)).toBeTypeOf('function')
      await host.dispose()
    }
  }
]

describe('executable Tray Host and Graph acceptance oracles', () => {
  it.each(runtimeCases)('$id executes its causal runtime oracle', async ({ run }) => {
    await run()
  })
})
