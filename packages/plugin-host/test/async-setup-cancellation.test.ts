import { describe, expect, it, vi } from 'vitest'
import { definePlugin, PluginHostErrorCode, type IPluginSetupContext } from '../src/index.ts'
import { deferred, createHost } from './async-setup-fixtures.ts'

describe('async setup installation', () => {
  it('aborts a timed-out attempt, drops late success, and reports late rejection', async () => {
    const reports: unknown[] = []
    const { host, scheduler } = createHost(50, (_message, _code, error) => reports.push(error))
    const gate = deferred<unknown>()
    /** Context captured so the late registration path can be exercised after rollback. */
    let context!: IPluginSetupContext
    /** Counts setup-owned resources disposed by rollback. */
    let releases = 0
    const install = vi.fn(() => ({}))
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (value) => {
          context = value
          value.onDispose(() => {
            releases += 1
          })
          return gate.promise
        },
        install
      })
    )
    expect(context.operation.deadlineAt).toBe(50)
    scheduler.advance(50)
    await expect(installing).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.mutationExecutionTimeout }
    })
    expect(context.operation.signal.aborted).toBe(true)
    expect(releases).toBe(1)
    const late = new Error('late setup rejection')
    gate.reject(late)
    await Promise.resolve()
    expect(reports).toContain(late)
    expect(install).not.toHaveBeenCalled()
    expect(() =>
      context.onDispose(() => {
        releases += 1
      })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall }))
    expect(releases).toBe(2)
    expect(() => context.onDispose({} as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )
    const lateCleanup = new Error('late cleanup failed')
    expect(() => context.onDispose(() => Promise.reject(lateCleanup))).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall })
    )
    await vi.waitFor(() => expect(reports).toContain(lateCleanup))
    await host.dispose()
  })

  it('disposes a host without waiting for a setup that never settles', async () => {
    const { host } = createHost()
    /** Captured context exposes the attempt-level signal after host disposal. */
    let context!: IPluginSetupContext
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (value) => {
          context = value
          return new Promise<never>(() => {})
        },
        install: () => ({})
      })
    )
    const disposing = host.dispose()
    await expect(installing).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.hostDisposing }
    })
    await disposing
    expect(context.operation.signal.aborted).toBe(true)
  })

  it('discards late success and reports a rejection after host disposal', async () => {
    const reports: unknown[] = []
    const { host, scheduler } = createHost(50, (_message, _code, error) => reports.push(error))
    const successGate = deferred<{ value: number }>()
    const install = vi.fn(() => ({}))
    const exposing = vi.fn(() => ({}))
    const expired = host.use(
      definePlugin({
        name: 'expired',
        setup: () => successGate.promise,
        featureExpose: exposing,
        install
      })
    )
    scheduler.advance(50)
    await expect(expired).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.mutationExecutionTimeout }
    })
    successGate.resolve({ value: 1 })
    await Promise.resolve()
    expect(exposing).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()

    const lateGate = deferred<never>()
    const disposingHost = createHost(false, (_message, _code, error) => reports.push(error)).host
    const pending = disposingHost.use(
      definePlugin({ name: 'p', setup: () => lateGate.promise, install: () => ({}) })
    )
    const disposed = disposingHost.dispose()
    await expect(pending).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.hostDisposing }
    })
    await disposed
    const late = new Error('disposed setup rejected late')
    lateGate.reject(late)
    await vi.waitFor(() => expect(reports).toContain(late))
    await host.dispose()
  })

  it('suppresses cancellation echoes and preserves an in-time coded rejection', async () => {
    const reports: unknown[] = []
    const { host, scheduler } = createHost(50, (_message, _code, error) => reports.push(error))
    /** A setup that rejects with its own abort reason when the deadline expires. */
    let context!: IPluginSetupContext
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (value) => {
          context = value
          return new Promise<never>((_resolve, reject) => {
            value.operation.signal.addEventListener('abort', () =>
              reject(value.operation.signal.reason)
            )
          })
        },
        install: () => ({})
      })
    )
    scheduler.advance(50)
    await expect(installing).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.mutationExecutionTimeout }
    })
    expect(context.operation.signal.aborted).toBe(true)
    expect(reports).toEqual([])

    const primary = Object.assign(new Error('own coded rejection'), {
      code: PluginHostErrorCode.mutationExecutionTimeout
    })
    const ownGate = deferred<never>()
    const own = host.use(
      definePlugin({ name: 'own', setup: () => ownGate.promise, install: () => ({}) })
    )
    ownGate.reject(primary)
    await expect(own).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary
    })
    expect(reports).toEqual([])
    await host.dispose()
  })

  it('closes an expired lazy attempt before rollback and isolates its retry', async () => {
    const { host, scheduler } = createHost(50)
    const firstGate = deferred<void>()
    const cleanupGate = deferred<void>()
    const cleanupStarted = deferred<void>()
    const secondGate = deferred<void>()
    /** Contexts retained across two activation attempts to prove separate signal ownership. */
    const contexts: IPluginSetupContext[] = []
    /** Resources released by rollback, late registration, and successful removal. */
    const released: string[] = []
    const plugin = definePlugin({
      name: 'l',
      activation: 'lazy',
      setup: async (context) => {
        contexts.push(context)
        if (contexts.length === 1) {
          context.onDispose(async () => {
            cleanupStarted.resolve()
            await cleanupGate.promise
            released.push('first')
          })
          await firstGate.promise
          context.onDispose(() => {
            released.push('late-during-rollback')
          })
          return 1
        }
        context.onDispose(() => {
          released.push('second')
        })
        await secondGate.promise
        return 2
      },
      install: (_core, output) => ({ value: output })
    })
    await host.use(plugin)
    const first = host.activate('l')
    await vi.waitFor(() => expect(contexts).toHaveLength(1))
    scheduler.advance(50)
    await cleanupStarted.promise
    firstGate.resolve()
    await vi.waitFor(() => expect(released).toContain('late-during-rollback'))
    expect(released).toContain('late-during-rollback')
    expect(contexts[0].operation.signal.aborted).toBe(true)
    cleanupGate.resolve()
    await expect(first).rejects.toMatchObject({
      code: PluginHostErrorCode.mutationExecutionTimeout
    })
    const second = host.activate('l')
    await vi.waitFor(() => expect(contexts).toHaveLength(2))
    expect(contexts[0].operation.signal).not.toBe(contexts[1].operation.signal)
    expect(contexts[1].operation.signal.aborted).toBe(false)
    expect(() =>
      contexts[0].onDispose(() => {
        released.push('late-after-retry')
      })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall }))
    secondGate.resolve()
    await second
    await host.unUse('l')
    expect(released).toEqual(['late-during-rollback', 'first', 'late-after-retry', 'second'])
    await host.dispose()
  })
})
