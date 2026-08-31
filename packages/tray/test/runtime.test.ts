/* oxlint-disable unicorn/no-thenable -- this suite intentionally models foreign thenables. */
import { describe, expect, it } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createAbortController, systemScheduler } from '@migaia/lifecycle'
import { createHost } from '../src/host/index.js'
import { defineAdapter } from '../src/adapter/index.js'
import { defineLoader, loadIntoHost } from '../src/loader/index.js'
import { createRuntime } from '../src/runtime/index.js'

class TestHost extends PluginHost<Record<string, never>, string> {}

const createManagedHost = async (quiescenceMs = 100) =>
  createHost({
    create: () =>
      new TestHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
    plugins: [],
    mutationAdmissionMs: 100,
    quiescenceMs,
    shutdown: { mode: 'bounded' as const }
  })

const installPlugin = async (host: any) =>
  loadIntoHost({
    host,
    source: 'source',
    loader: defineLoader({
      load: () => ({ value: 'artifact', release: { force: () => undefined } })
    }),
    adapter: defineAdapter({
      adapt: () => ({ name: 'runtime-plugin', install: () => ({ run: () => 'ok' }) })
    }),
    mutation: 'use',
    timeoutMs: false
  })

describe('@migaia/tray/runtime', () => {
  it('publishes the exact extension snapshot and fences removal until callback settlement', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host, { shutdown: { mode: 'bounded' } }) as any
    let settle!: () => void
    const pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const run = runtime.run(
      'runtime-plugin',
      { timeoutMs: false },
      async ({ extensions }: { readonly extensions: { readonly run: () => string } }) => {
        expect(extensions.run()).toBe('ok')
        await pending
        return 'settled'
      }
    )
    const removal = await host.unUse('runtime-plugin')
    expect(removal.cleanupComplete).toBe(false)
    settle()
    await expect(run).resolves.toBe('settled')
    await removal.physicalCompletion
    expect(runtime.activeRuns).toBe(0)
    await runtime.dispose()
    await host.dispose()
  })

  it('does not publish undeclared or blocked plugin extensions to a target callback', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    await host.use({
      name: 'blocked-plugin',
      requires: ['missing-provider'],
      install: () => ({ blocked: true })
    })
    const runtime = createRuntime(host) as any
    await expect(
      runtime.run('runtime-plugin', { timeoutMs: false }, ({ extensions }: any) => {
        expect(extensions.run()).toBe('ok')
        expect(extensions.blocked).toBeUndefined()
        expect(extensions.other).toBeUndefined()
        return 'isolated'
      })
    ).resolves.toBe('isolated')
    await runtime.dispose()
    await host.dispose()
  })

  it('assimilates a foreign thenable callback once and releases its lease after settlement', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    let thenReads = 0
    const thenable = Object.create(null) as Record<string, unknown>
    Object.defineProperty(thenable, 'then', {
      get: () => {
        thenReads += 1
        return (resolve: (value: string) => void) => resolve('foreign-result')
      }
    })
    await expect(
      runtime.run('runtime-plugin', { timeoutMs: false }, () => thenable as never)
    ).resolves.toBe('foreign-result')
    expect(thenReads).toBe(1)
    expect(runtime.activeRuns).toBe(0)
    await runtime.dispose()
    await host.dispose()
  })

  it('settles sync, Promise, foreign thenable, throw and reject callbacks exactly once', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    const foreign = Object.create(null) as Record<string, unknown>
    let thenReads = 0
    Object.defineProperty(foreign, 'then', {
      get: () => {
        thenReads += 1
        return (resolve: (value: string) => void) => resolve('foreign')
      }
    })
    const forms = [() => 'sync', () => Promise.resolve('promise'), () => foreign]
    for (const form of forms) {
      let callbacks = 0
      await expect(
        runtime.run('runtime-plugin', { timeoutMs: false }, () => {
          callbacks += 1
          return form() as never
        })
      ).resolves.toBeDefined()
      expect(callbacks).toBe(1)
      expect(runtime.activeRuns).toBe(0)
    }
    expect(thenReads).toBe(1)
    const thrown = new Error('sync throw')
    await expect(
      runtime.run('runtime-plugin', { timeoutMs: false }, () => {
        throw thrown
      })
    ).rejects.toBe(thrown)
    expect(thrown).toMatchObject({ code: 'RUNTIME_EXECUTION_FAILED' })
    const rejected = new Error('promise reject')
    await expect(
      runtime.run('runtime-plugin', { timeoutMs: false }, () => Promise.reject(rejected))
    ).rejects.toBe(rejected)
    expect(rejected).toMatchObject({ code: 'RUNTIME_EXECUTION_FAILED' })
    expect(runtime.activeRuns).toBe(0)
    await runtime.dispose()
    await host.dispose()
  })

  it('cooperatively aborts a caller signal without releasing the lease before callback settlement', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    const caller = createAbortController()
    let settle!: () => void
    const pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    let signal!: { readonly aborted: boolean }
    const run = runtime.run(
      'runtime-plugin',
      { signal: caller.signal, timeoutMs: false },
      async (context: { readonly signal: { readonly aborted: boolean } }) => {
        signal = context.signal
        await pending
        return 'settled'
      }
    )
    caller.abort('caller-cancelled')
    await Promise.resolve()
    expect(signal.aborted).toBe(true)
    expect(runtime.activeRuns).toBe(1)
    settle()
    await expect(run).resolves.toBe('settled')
    expect(runtime.activeRuns).toBe(0)
    await runtime.dispose()
    await host.dispose()
  })

  it('aborts on deadline and Runtime disposal while observing late callback rejection', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    let deadlineSignal!: { readonly aborted: boolean }
    let settleDeadline!: (error?: unknown) => void
    const deadlineGate = new Promise<never>((_, reject) => {
      settleDeadline = (error) => reject(error)
    })
    const deadlineRun = runtime.run(
      'runtime-plugin',
      { timeoutMs: 0 },
      async (context: { readonly signal: { readonly aborted: boolean } }) => {
        deadlineSignal = context.signal
        return deadlineGate
      }
    )
    await new Promise<void>((resolve) => systemScheduler.schedule(() => resolve(), 10))
    expect(deadlineSignal.aborted).toBe(true)
    expect(runtime.activeRuns).toBe(1)
    const lateDeadlineError = new Error('late deadline rejection')
    settleDeadline(lateDeadlineError)
    await expect(deadlineRun).rejects.toBe(lateDeadlineError)
    expect(runtime.activeRuns).toBe(0)

    let disposeSignal!: { readonly aborted: boolean }
    let settleDispose!: () => void
    const disposeGate = new Promise<void>((resolve) => {
      settleDispose = resolve
    })
    const disposeRun = runtime.run(
      'runtime-plugin',
      { timeoutMs: false },
      async (context: { readonly signal: { readonly aborted: boolean } }) => {
        disposeSignal = context.signal
        await disposeGate
        return 'disposed-run'
      }
    )
    const disposal = runtime.dispose()
    await Promise.resolve()
    expect(disposeSignal.aborted).toBe(true)
    expect(runtime.activeRuns).toBe(1)
    settleDispose()
    await expect(disposeRun).resolves.toBe('disposed-run')
    await expect(disposal).resolves.toMatchObject({ state: 'terminal', cleanupComplete: true })
    await host.dispose()
  })

  it('preserves callback failure identity and completes strict runtime disposal after all runs settle', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    const primary = new Error('callback failed')
    const rejected = runtime.run('runtime-plugin', { timeoutMs: false }, () => {
      throw primary
    })
    await expect(rejected).rejects.toBe(primary)
    expect(primary).toMatchObject({ code: 'RUNTIME_EXECUTION_FAILED' })

    let settle!: () => void
    const pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const held = runtime.run('runtime-plugin', { timeoutMs: false }, () => pending)
    const disposal = runtime.dispose()
    expect(runtime.state).toBe('closing')
    expect(runtime.activeRuns).toBe(1)
    settle()
    await held
    await expect(disposal).resolves.toMatchObject({ state: 'terminal', cleanupComplete: true })
    await host.dispose()
  })

  it('contains a strict-drain callback rejection and terminalizes idempotently', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const reported: unknown[] = []
    const runtime = createRuntime(host, { report: (error) => reported.push(error) }) as any
    let rejectRun!: (error: unknown) => void
    const pending = new Promise<never>((_, reject) => {
      rejectRun = reject
    })
    const primary = new Error('strict drain callback failure')
    const run = runtime.run('runtime-plugin', { timeoutMs: false }, () => pending)
    const disposal = runtime.dispose()
    rejectRun(primary)
    await expect(run).rejects.toBe(primary)
    await expect(disposal).resolves.toMatchObject({
      state: 'terminal',
      cleanupComplete: true
    })
    expect(runtime.state).toBe('terminal')
    expect(runtime.activeRuns).toBe(0)
    expect(reported).toContain(primary)
    await expect(runtime.dispose()).resolves.toMatchObject({
      state: 'terminal',
      cleanupComplete: true
    })
    await host.dispose()
  })

  it('commits async-after-await self-unUse through an exact run ticket', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    let selfRemoval: any
    const ticket = await runtime.run(
      'runtime-plugin',
      { timeoutMs: false },
      async ({ self }: any) => {
        await Promise.resolve()
        selfRemoval = self.unUse()
        return selfRemoval
      }
    )
    expect(ticket).toBe(selfRemoval)
    expect(ticket).not.toHaveProperty('then')
    await expect(ticket.completion).resolves.toMatchObject({
      ok: true,
      committed: true,
      removed: true
    })
    expect(host.plugins).not.toContain('runtime-plugin')
    expect(runtime.activeRuns).toBe(0)
    await runtime.dispose()
    await host.dispose()
  })

  it('commits async-after-await self-replace through an exact run ticket', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    let selfReplacement: any
    const replacement = {
      name: 'runtime-plugin',
      install: () => ({ run: () => 'replacement' })
    }
    const ticket = await runtime.run(
      'runtime-plugin',
      { timeoutMs: false },
      async ({ self }: any) => {
        await Promise.resolve()
        selfReplacement = self.replace(replacement)
        return selfReplacement
      }
    )
    expect(ticket).toBe(selfReplacement)
    expect(ticket).not.toHaveProperty('then')
    await expect(ticket.completion).resolves.toMatchObject({ ok: true, committed: true })
    expect(host.plugins).toContain('runtime-plugin')
    expect(runtime.activeRuns).toBe(0)
    await runtime.dispose()
    await host.dispose()
  })

  it('fails self-ticket physical completion fast inside its originating callback', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    await expect(
      runtime.run('runtime-plugin', { timeoutMs: false }, async ({ self }: any) => {
        const ticket = self.unUse()
        await expect(ticket.completion).rejects.toMatchObject({
          source: '@migaia/tray',
          code: 'RUNTIME_CONTRACT_INVALID'
        })
        return ticket
      })
    ).resolves.toBeDefined()
    await runtime.dispose()
    await host.dispose()
  })

  it('fences Host disposal cleanup until an active callback releases its generation lease', async () => {
    const host = (await createManagedHost(20)) as any
    let artifactReleased = 0
    let pluginDisposed = 0
    await loadIntoHost({
      host,
      source: 'source',
      loader: defineLoader({
        load: () => ({
          value: 'artifact',
          release: { force: () => void (artifactReleased += 1) }
        })
      }),
      adapter: defineAdapter({
        adapt: () => ({
          name: 'runtime-plugin',
          install: (core: any) => {
            core.onDispose(() => {
              pluginDisposed += 1
            })
            return { run: () => 'ok' }
          }
        })
      }),
      mutation: 'use',
      timeoutMs: false
    })
    const runtime = createRuntime(host, { shutdown: { mode: 'bounded' } }) as any
    let settle!: () => void
    const pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const run = runtime.run('runtime-plugin', { timeoutMs: false }, async () => {
      await pending
      return 'settled'
    })
    const disposal = host.dispose()
    let settledResult: any
    void disposal.then((value: any) => {
      settledResult = value
    })
    await new Promise<void>((resolve) => systemScheduler.schedule(resolve, 60))
    expect(settledResult).toBeDefined()
    expect(pluginDisposed).toBe(0)
    expect(artifactReleased).toBe(0)
    expect(runtime.activeRuns).toBe(1)
    settle()
    await expect(run).resolves.toBe('settled')
    const result = settledResult as any
    expect(result.cleanupComplete).toBe(false)
    expect(result.physicalCompletion).toBeDefined()
    await expect(result.physicalCompletion).resolves.toMatchObject({ cleanupErrors: [] })
    expect(pluginDisposed).toBe(1)
    expect(artifactReleased).toBe(1)
    await runtime.dispose()
  })

  it('keeps direct raw-Host synchronous self mutation guarded while tickets are supported', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host) as any
    let selfRemoval: Promise<unknown> | undefined
    await expect(
      runtime.run('runtime-plugin', { timeoutMs: false }, () => {
        selfRemoval = host.unUse('runtime-plugin')
        return 'self-unUse'
      })
    ).resolves.toBe('self-unUse')
    await expect(selfRemoval).resolves.toMatchObject({ ok: false, committed: false })
    expect(runtime.activeRuns).toBe(0)
    await expect(host.unUse('runtime-plugin')).resolves.toMatchObject({
      ok: true,
      committed: true,
      removed: true
    })
    await runtime.dispose()
    await host.dispose()
  })

  it('handles concurrent runs and self-unUse without early lease release', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host, { shutdown: { mode: 'bounded' } }) as any
    let releaseRuns!: () => void
    const runGate = new Promise<void>((resolve) => {
      releaseRuns = resolve
    })
    const first = runtime.run('runtime-plugin', { timeoutMs: false }, () => runGate)
    const second = runtime.run('runtime-plugin', { timeoutMs: false }, () => runGate)
    await Promise.resolve()
    expect(runtime.activeRuns).toBe(2)
    const removal = host.unUse('runtime-plugin')
    await new Promise<void>((resolve) => systemScheduler.schedule(() => resolve(), 0))
    expect(runtime.activeRuns).toBe(2)
    releaseRuns()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    await expect(removal).resolves.toMatchObject({ committed: true, removed: true })

    const selfHost = (await createManagedHost()) as any
    await installPlugin(selfHost)
    const selfRuntime = createRuntime(selfHost, { shutdown: { mode: 'bounded' } }) as any
    let selfRemoval!: Promise<unknown>
    await expect(
      selfRuntime.run('runtime-plugin', { timeoutMs: false }, () => {
        selfRemoval = selfHost.unUse('runtime-plugin')
        return 'self-unUse'
      })
    ).resolves.toBe('self-unUse')
    await expect(selfRemoval).resolves.toMatchObject({
      ok: false,
      committed: false,
      removed: false
    })
    await expect(selfHost.unUse('runtime-plugin')).resolves.toMatchObject({
      committed: true,
      removed: true
    })
    await selfRuntime.dispose()
    await selfHost.dispose()
    await runtime.dispose()
    await host.dispose()
  })

  it('preserves strict external Host mutation queueing while a callback is pending', async () => {
    const host = (await createManagedHost()) as any
    await installPlugin(host)
    const runtime = createRuntime(host, { shutdown: { mode: 'strict-drain' } }) as any
    let settle!: () => void
    const pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const run = runtime.run('runtime-plugin', { timeoutMs: false }, () => pending)
    const removal = host.unUse('runtime-plugin')
    await new Promise<void>((resolve) => systemScheduler.schedule(resolve, 0))
    expect(runtime.activeRuns).toBe(1)
    settle()
    await expect(run).resolves.toBeUndefined()
    await expect(removal).resolves.toMatchObject({ ok: true, committed: true, removed: true })
    await runtime.dispose()
    await host.dispose()
  })
})
