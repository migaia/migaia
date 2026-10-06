import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { createThreadPeer } from '../../src/threads/peer.js'
import { runtimeTestHost } from '../runtime-api/fixture.js'
import { createDenoThreadLauncher } from '../../src/threads/adapters/deno.js'
import { createBunThreadLauncher } from '../../src/threads/adapters/bun.js'
import { createBrowserThreadLauncher } from '../../src/threads/adapters/browser.js'
import { createElectronRendererThreadLauncher } from '../../src/threads/adapters/electron-renderer.js'
import { createElectronMainThreadLauncher } from '../../src/threads/adapters/electron-main.js'
import { createBrowserThreadChannelFactory } from '../../src/threads/adapters/browser.js'
import { endpointFactory, nativeFixture, nativeWorkerFor } from './fixture.js'

/** Node fixtures cannot establish Web/Bun/Electron actual-exit enforcement. */
describe('platform capability admission', () => {
  it.each([
    ['deno', createDenoThreadLauncher],
    ['bun', createBunThreadLauncher],
    ['browser', createBrowserThreadLauncher],
    ['electron-renderer', createElectronRendererThreadLauncher]
  ] as const)(
    '[A7] %s requires health and rejects default isolation before Worker construction',
    async (_platform, factory) => {
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
      const host = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      expect(launcher.capabilities).toMatchObject({
        termination: 'unsupported',
        'exit-observation': 'unsupported'
      })
      try {
        for (const build of [
          () =>
            host.use(
              createThreadPlugin({
                name: 'p',
                spawn: common,
                endpointFactory,
                report: vi.fn()
              })
            ),
          () => createThreadPeer({ spawn: common, endpointFactory, report: vi.fn() })
        ])
          await expect(build()).rejects.toSatisfy(
            (error: {
              code?: string
              cause?: { code?: string; detail?: { field?: string } }
              detail?: { field?: string }
            }) => {
              const native = error.code === 'PLUGIN_INSTALL_FAILED' ? error.cause : error
              expect(native).toMatchObject({
                code: 'INVALID_OPTION',
                detail: expect.objectContaining({ field: 'health' })
              })
              return true
            }
          )
        const health = { check: vi.fn(async () => undefined) }
        await expect(
          host.use(
            createThreadPlugin({
              name: 'p',
              spawn: { ...common, health },
              endpointFactory,
              report: vi.fn()
            })
          )
        ).rejects.toMatchObject({
          code: 'PLUGIN_INSTALL_FAILED',
          cause: { code: 'CAPABILITY_UNSUPPORTED' }
        })
        /** A valid uninstalled definition stays lazy, matching the original unstarted Host case. */
        createThreadPlugin({
          name: 'p',
          spawn: { ...common, health, supervisor: { isolation: 'best-effort' } },
          endpointFactory,
          report: vi.fn()
        })
        await host.dispose()
        expect(constructor).not.toHaveBeenCalled()
        expect(budget.inUse).toBe(0)
      } finally {
        await host.dispose()
      }
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
