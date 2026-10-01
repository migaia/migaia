import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { createThreadHost } from '../../src/threads/host.js'
import { createDenoThreadLauncher } from '../../src/threads/adapters/deno.js'
import { createBunThreadLauncher } from '../../src/threads/adapters/bun.js'
import { createBrowserThreadLauncher } from '../../src/threads/adapters/browser.js'
import { createElectronRendererThreadLauncher } from '../../src/threads/adapters/electron-renderer.js'
import { createElectronMainThreadLauncher } from '../../src/threads/adapters/electron-main.js'
import { createBrowserThreadChannelFactory } from '../../src/threads/adapters/browser.js'
import { contract, endpointFactory, nativeFixture, nativeWorkerFor } from './fixture.js'

/** Node fixtures cannot establish Web/Bun/Electron actual-exit enforcement. */
describe('platform capability admission', () => {
  it.each([
    ['deno', createDenoThreadLauncher],
    ['bun', createBunThreadLauncher],
    ['browser', createBrowserThreadLauncher],
    ['electron-renderer', createElectronRendererThreadLauncher]
  ] as const)(
    '[A7] %s requires health and rejects default isolation before Worker construction',
    (_platform, factory) => {
      const constructor = vi.fn()
      const Worker = class {
        constructor() {
          constructor()
        }
        postMessage() {}
        addEventListener() {}
        removeEventListener() {}
        terminate() {}
      }
      const launcher = factory({ Worker, report: vi.fn() })
      const scheduler = createManualScheduler()
      const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler })
      const common = {
        spec: { entry: 'file:///worker.mjs' },
        launcher,
        budget,
        scheduler,
        channelFactory: createBrowserThreadChannelFactory({ scheduler }),
        endpointFactory,
        report: vi.fn()
      }
      expect(launcher.capabilities).toMatchObject({
        termination: 'unsupported',
        'exit-observation': 'unsupported'
      })
      for (const build of [
        () =>
          createThreadPlugin({
            ...common,
            name: 'p',
            contract,
            host: { disable: vi.fn(), enable: vi.fn() }
          }),
        () => createThreadHost({ ...common, catalog: { p: contract } })
      ])
        expect(build).toThrow(
          expect.objectContaining({
            code: 'INVALID_OPTION',
            detail: expect.objectContaining({ field: 'health' })
          })
        )
      const health = { check: vi.fn(async () => undefined) }
      expect(() =>
        createThreadPlugin({
          ...common,
          health,
          name: 'p',
          contract,
          host: { disable: vi.fn(), enable: vi.fn() }
        })
      ).toThrow(expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' }))
      const host = createThreadHost({
        ...common,
        health,
        supervisor: { isolation: 'best-effort' },
        catalog: { p: contract }
      })
      void host.release()
      expect(constructor).not.toHaveBeenCalled()
      expect(budget.inUse).toBe(0)
    }
  )
  it('[A7] Electron main retains independent unsupported evidence until an Electron fixture runs', () => {
    expect(createElectronMainThreadLauncher().capabilities).toMatchObject({
      termination: 'unsupported',
      'exit-observation': 'unsupported'
    })
  })
  it.each([false, true])(
    '[A7] real Worker ping health with missing server ping=%s',
    async (noPing) => {
      const scheduler = createManualScheduler()
      const endpoints = new Map<
        string,
        {
          ping(
            peer: string,
            params: undefined,
            options: { timeoutMs: false; signal: unknown }
          ): Promise<unknown>
        }
      >()
      const fixture = nativeFixture(
        {
          scheduler,
          health: {
            intervalMs: 10_000,
            timeoutMs: 5,
            failureThreshold: 3,
            check: async (handle, signal) => {
              await endpoints
                .get(handle.identity.fingerprint)!
                .ping(handle.identity.fingerprint, undefined, { timeoutMs: false, signal })
            }
          },
          endpointFactory: async (channel, signal) => {
            const built = await endpointFactory(channel, signal)
            endpoints.set(
              channel.peerId,
              built.endpoint as unknown as {
                ping(
                  peer: string,
                  params: undefined,
                  options: { timeoutMs: false; signal: unknown }
                ): Promise<unknown>
              }
            )
            return built
          }
        },
        { noPing }
      )
      try {
        await fixture.install()
        for (let round = 0; round < 3; round += 1) {
          scheduler.advance(10_000)
          for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
          await new Promise((resolve) => setTimeout(resolve, 5))
          if (noPing) scheduler.advance(5)
          for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
        }
        if (noPing) {
          await fixture.handles[0]!.exited
          expect(nativeWorkerFor(fixture.handles[0]!).threadId).toBe(-1)
        } else {
          expect(fixture.handles).toHaveLength(1)
          expect(nativeWorkerFor(fixture.handles[0]!).threadId).toBeGreaterThan(0)
        }
      } finally {
        await fixture.close()
      }
      expect(fixture.budget.inUse).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }
  )
})
