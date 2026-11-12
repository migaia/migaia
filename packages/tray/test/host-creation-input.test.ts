import { describe, expect, it } from 'vitest'
import { asyncDisposeKey, defineHost, definePlugin } from '@migaia/plugin-host'
import { createHost } from '../src/host/index.ts'
import { trayNativeTestModules } from './native-modules.ts'

describe('createHost option reads', () => {
  it('codes a throwing option getter as TRAY_INVALID_ENTRY with the getter error kept', async () => {
    const getterFailure = new Error('plugins getter failed')
    let thrown: unknown
    try {
      await createHost({
        create: () => ({}) as never,
        get plugins(): never {
          throw getterFailure
        },
        mutationAdmissionMs: 500,
        quiescenceMs: 0,
        shutdown: { mode: 'strict-drain' }
      } as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'TRAY_INVALID_ENTRY' })
    expect([thrown, (thrown as Error).cause]).toContain(getterFailure)
  })

  it('rejects non-array plugins and a missing shutdown policy', async () => {
    await expect(
      createHost({
        create: () => ({}) as never,
        plugins: 'none',
        mutationAdmissionMs: 500,
        quiescenceMs: 0,
        shutdown: { mode: 'strict-drain' }
      } as never)
    ).rejects.toMatchObject({ code: 'TRAY_INVALID_ENTRY' })
    await expect(
      createHost({
        create: () => ({}) as never,
        plugins: [],
        mutationAdmissionMs: 500,
        quiescenceMs: 0
      } as never)
    ).rejects.toMatchObject({ code: 'TRAY_INVALID_ENTRY' })
  })
})

describe('managed use failure', () => {
  it('returns an uncommitted failure when a late plugin reuses an installed name', async () => {
    const reported: unknown[] = []
    const host = await createHost({
      create: () =>
        defineHost<Record<string, never>, string, typeof trayNativeTestModules>({
          modules: trayNativeTestModules,
          host: { execution: { mutationTimeoutMs: 500, pipelineDrainTimeoutMs: 500 } }
        }),
      plugins: [definePlugin({ name: 'taken', install: () => ({}) })],
      mutationAdmissionMs: 500,
      quiescenceMs: 0,
      shutdown: { mode: 'strict-drain' },
      report: (error: unknown) => {
        reported.push(error)
      }
    })
    try {
      const result = await host.use(definePlugin({ name: 'taken', install: () => ({}) }))
      expect(result).toMatchObject({ ok: false, committed: false })
      expect(reported).toEqual([])
    } finally {
      await host.dispose()
    }
  })
})

/** Creates a managed host over a fresh concrete host that the test can also reach directly. */
async function managedOver(concrete: ReturnType<typeof concreteHost>) {
  return createHost({
    create: () => concrete,
    plugins: [definePlugin({ name: 'taken', install: () => ({}) })],
    mutationAdmissionMs: 500,
    quiescenceMs: 0,
    shutdown: { mode: 'strict-drain' }
  })
}

/** Concrete host with the tray test modules. */
function concreteHost() {
  return defineHost<Record<string, never>, string, typeof trayNativeTestModules>({
    modules: trayNativeTestModules,
    host: { execution: { mutationTimeoutMs: 500, pipelineDrainTimeoutMs: 500 } }
  })
}

describe('managed removal and disposal paths', () => {
  it('reports external-host termination when the concrete host was mutated directly', async () => {
    const concrete = concreteHost()
    const host = await managedOver(concrete)
    await concrete.use(definePlugin({ name: 'outside', install: () => ({}) }))
    expect(await host.dispose()).toMatchObject({ termination: 'external-host' })
  })

  it('routes a late listener rejection to the report option', async () => {
    const reported: unknown[] = []
    /** Failure thrown by the observer. */
    const listenerFailure = new Error('listener failed')
    const host = await createHost({
      create: () => concreteHost(),
      plugins: [],
      mutationAdmissionMs: 500,
      quiescenceMs: 0,
      shutdown: { mode: 'strict-drain' },
      report: (error: unknown) => {
        reported.push(error)
      }
    })
    try {
      // A synchronous throw fails the publish; only a late rejection goes to report.
      host.on('use', async () => {
        throw listenerFailure
      })
      await host.use(definePlugin({ name: 'observed', install: () => ({}) }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(reported).toContain(listenerFailure)
      expect(host.error).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })

  it('joins disposal through the async dispose key', async () => {
    const host = await managedOver(concreteHost())
    await (host as unknown as Record<PropertyKey, () => Promise<void>>)[asyncDisposeKey]()
    expect(host.state).toBe('terminal')
  })
})
