import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { RpcWireKind, RpcWireControlOperation } from '@migaia/rpc-contract/protocol'
import { threadFrames } from './frame.js'
import { describe, expect, it, vi } from 'vitest'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { createRpcHost } from '@migaia/rpc-host'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import {
  createWebThreadLauncher,
  createWebThreadChannelFactory
} from '../../dist/threads/web-launcher.js'

import { nativeFixture } from './fixture.js'

/** Node fixtures cannot establish Web/Bun/Electron actual-exit enforcement. */
describe('platform capability admission', () => {
  it.each([['web', createWebThreadLauncher]] as const)(
    '%s uses default health and rejects required isolation before Worker construction',
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
        channelFactory: createWebThreadChannelFactory({ scheduler, report: vi.fn() }),

        report: vi.fn()
      }
      /** Lazy pipeline authority reads this case's own native host only at installation. */
      const rpc = rpcHostPipelines(
        () => host,
        (name) => host.pipeline(name),
        ['thread']
      )
      const host = defineHost({
        ...rpc,
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
              threadPlugin({
                name: 'p',
                spawn: common,

                report: vi.fn()
              })
            ),
          () => createRpcHost({ plugins: [threadPlugin({ spawn: common })], report: vi.fn() })
        ])
          await expect(build()).rejects.toSatisfy(
            (error: {
              code?: string
              cause?: { code?: string; detail?: { field?: string } }
              detail?: { field?: string }
            }) => {
              const native = error.code === 'PLUGIN_INSTALL_FAILED' ? error.cause : error
              expect(native).toMatchObject({
                code: 'CAPABILITY_UNSUPPORTED'
              })
              return true
            }
          )
        const health = { check: vi.fn(async () => undefined) }
        await expect(
          host.use(
            threadPlugin({
              name: 'p',
              spawn: { ...common, health },

              report: vi.fn()
            })
          )
        ).rejects.toMatchObject({
          code: 'PLUGIN_INSTALL_FAILED',
          cause: { code: 'CAPABILITY_UNSUPPORTED' }
        })
        /** A valid uninstalled definition stays lazy, matching the original unstarted Host case. */
        threadPlugin({
          name: 'p',
          spawn: { ...common, health, supervisor: { isolation: 'best-effort' } },

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

  it('uses the default RPC ping health policy when a launcher does not promise exit observation', async () => {
    /** The supervised Peer and its default health check share the caller's controlled clock. */
    const scheduler = createManualScheduler()
    /** The existing fixture still launches a real native Worker and owns its real exit. */
    const fixture = nativeFixture({ scheduler })
    /** A caller may declare fewer guarantees than its underlying native implementation provides. */
    const launcher = {
      ...fixture.launcher,
      capabilities: { ...fixture.launcher.capabilities, 'exit-observation': 'unsupported' as const }
    }
    /** Standalone source Peers use the same supported default health path documented for Web. */
    const peer = await createRpcHost<
      { 'p.read'(value: string): string },
      readonly [ReturnType<typeof threadPlugin<'thread'>>]
    >({
      self: { name: 'health-parent', instanceId: 'health-parent' },
      plugins: [
        threadPlugin({
          spawn: {
            ...fixture.spawn,
            launcher,
            supervisor: { ...fixture.spawn.supervisor, isolation: 'best-effort' }
          }
        })
      ],
      report: (error) => fixture.reported.push(error)
    })
    try {
      expect(await peer.thread.request('p.read', 'before health')).toBe('before health')
      scheduler.advance(5000)
      await expect
        .poll(async () =>
          (await threadFrames(fixture.frames)).some(
            (frame) =>
              frame.kind === RpcWireKind.control && frame.operation === RpcWireControlOperation.ping
          )
        )
        .toBe(true)
      expect(await peer.thread.request('p.read', 'after health')).toBe('after health')
      expect(fixture.handles).toHaveLength(1)
    } finally {
      await peer.close()
      await fixture.close()
    }
    /** Unobservable close returns before native exit; only that real receipt releases the lease. */
    await Promise.all(fixture.handles.map((handle) => handle.exited))
    await expect.poll(() => fixture.budget.inUse).toBe(0)
  })
})
