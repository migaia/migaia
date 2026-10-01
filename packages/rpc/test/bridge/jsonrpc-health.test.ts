import type { IAbortSignal } from '@migaia/lifecycle'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createSpawnProcessBinding } from '../../src/process/plugin/binding.js'
import { createRemotePlugin } from '../../src/remote/plugin.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { BRIDGE_CONTRACT, bridgeEndpoint, flush } from './fixture.js'
import {
  childPath,
  token,
  fdLauncher,
  establish,
  type IFixtureHandle
} from './fixtures/jsonrpc-process.js'

/** A logical clock proves default none and explicit custom health without elapsed-time guesses. */
describe('JSON-RPC real process health', () => {
  it.each([false, true])(
    '[I16 A5/M2] busy child obeys health none/custom and generation retest (custom=%s)',
    async (custom) => {
      /** Shared scheduler owns supervision checks, request deadlines and restart delay. */
      const scheduler = createManualScheduler()
      /** Real handles distinguish process-level recovery from facade reconnection. */
      const handles: IFixtureHandle[] = []
      /** Current-generation endpoints implement the caller-supplied health operation. */
      const endpoints = new Map<IFixtureHandle, IRpcEndpoint>()
      /** Canonical channels are associated with their physical owner before endpoint publication. */
      const channelHandles = new Map<object, IFixtureHandle>()
      /** Native launch and dedicated-fd authentication remain outside RPC stdin. */
      const launcher = fdLauncher()
      /** Reports stay observable throughout abort, unhealthy close and replacement. */
      const reports: unknown[] = []
      /** Output acknowledgement proves the process actually enters its busy loop. */
      let entered: () => void = () => undefined
      /** Only actual supervisor health calls increment this counter. */
      let checks = 0
      /** Real exit events show the supervisor, rather than a request timeout, kills a generation. */
      const exits: unknown[] = []
      /** The plugin host preserves the same remote feature across all physical generations. */
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /**
       * One binding uses existing supervision with default none or explicitly supplied business
       * health.
       */
      const binding = createSpawnProcessBinding(
        {
          kind: 'spawn',
          wire: 'jsonrpc',
          channelKind: 'byte',
          token,
          supervision: {
            id: 'bridge-busy-health',
            scheduler,
            spec: {
              command: process.execPath,
              args: [childPath],
              env: { inherit: [], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
              bootstrap: { via: 'fd', fd: 3, payload: new TextEncoder().encode(token) }
            },
            launcher: {
              capabilities: launcher.capabilities,
              async launch(spec, context) {
                /** Store each actual process before supervisor readiness and channel assembly. */
                const handle = await launcher.launch(spec, context)
                handles.push(handle)
                return handle
              }
            },
            ...(custom
              ? {
                  health: {
                    intervalMs: 5_000,
                    timeoutMs: 2_000,
                    failureThreshold: 3,
                    async check(unit: IFixtureHandle, signal: IAbortSignal) {
                      checks++
                      /**
                       * Ordinary bridge business calls are explicit custom health, never native
                       * ping.
                       */
                      const endpoint = endpoints.get(unit)
                      if (endpoint)
                        await endpoint.send('peer', 'p.f.request', ['custom-health'], {
                          signal,
                          timeoutMs: false
                        })
                    }
                  }
                }
              : {}),
            budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
            isolation: 'best-effort',
            restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 3 },
            output: {
              onChunk(_stream, chunk) {
                if (new TextDecoder().decode(chunk).includes('busy-loop-entered')) entered()
              }
            },
            report: (error) => reports.push(error)
          },
          rawChannel: async (handle) => handle.channel,
          establish: async (raw, context) => {
            /** Existing bridge establishment binds authentication, IPC and scheduler once. */
            const channel = await establish([], reports, [])(raw, context)
            channelHandles.set(channel, handles.at(-1)!)
            return channel
          }
        },
        (error) => reports.push(error)
      )
      /** Track only actual process exits, independent from request cancellation. */
      const unsubscribe = binding.supervisor.subscribe((event) => {
        if (event.type === 'exit') exits.push(event)
      })
      /** Canonical remote assembly rebinds the original feature after supervisor replacement. */
      const definition = createRemotePlugin({
        name: 'p',
        contract: BRIDGE_CONTRACT,
        host: host.plugin,
        binding,
        report: (error) => reports.push(error),
        endpointFactory: async (channel) => {
          /** The endpoint uses the bridge's pipeline and the binding's existing drain wrapper. */
          const endpoint = await bridgeEndpoint(channel)
          endpoints.set(channelHandles.get(channel)!, endpoint)
          return binding.bindEndpoint(channel, { endpoint, oneWay: endpoint })
        }
      })
      try {
        /** Only the first install creates a feature; it remains identical across later generations. */
        const [installed] = await host.use(definition)
        /** Required request surface comes from the frozen bridge contract. */
        const feature = installed!.getFeature('f') as {
          request(args: unknown[], options?: { timeoutMs?: number }): Promise<unknown>
        }
        expect(binding.health).toBe(custom ? 'custom' : 'none')
        if (!custom) {
          scheduler.advance(30_000)
          await flush()
          expect(checks).toBe(0)
        }
        for (let cycle = 0; cycle < (custom ? 2 : 1); cycle++) {
          /** The current child answers immediately before entering an actual infinite loop. */
          const current = handles[cycle]!
          expect(await feature.request(['healthy'])).toMatchObject({ args: ['healthy'] })
          /** Acknowledgement is a physical stderr event emitted before the child spins. */
          const busy = new Promise<void>((resolve) => {
            entered = resolve
          })
          process.kill(current.identity.pid!, 'SIGUSR2')
          await busy
          if (!custom) {
            /** Request deadline settles locally while default none deliberately keeps the same PID. */
            let failure: unknown
            const request = feature.request(['busy'], { timeoutMs: 500 }).catch((error) => {
              failure = error
            })
            await flush()
            scheduler.advance(500)
            await request
            expect(failure).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
            scheduler.advance(30_000)
            await flush()
            expect(checks).toBe(0)
            expect(handles).toHaveLength(1)
            expect(exits).toHaveLength(0)
            expect(binding.supervisor.state).toBe('ready')
            expect(current.child.exitCode).toBeNull()
          } else {
            /**
             * Three full custom-health deadlines trigger supervisor process recovery, not a fake
             * ping.
             */
            const origin = scheduler.now()
            for (let check = 0; check < 3; check++) {
              scheduler.advance(origin + (check + 1) * 5_000 - scheduler.now())
              await flush()
              scheduler.advance(2_000)
              await flush()
            }
            await current.exited
            await vi.waitFor(() => expect(binding.supervisor.state).toBe('backoff'))
            scheduler.advance(1)
            await binding.supervisor.whenReady()
            await vi.waitFor(async () =>
              expect(await feature.request(['rebound'])).toMatchObject({ args: ['rebound'] })
            )
            expect(handles[cycle + 1]!.identity.pid).not.toBe(current.identity.pid)
          }
        }
        if (custom) {
          expect(handles).toHaveLength(3)
          expect(checks).toBe(6)
          expect(exits).toEqual([
            expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) }),
            expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) })
          ])
          expect(await feature.request(['final'])).toMatchObject({ args: ['final'] })
        }
      } finally {
        unsubscribe()
        await host.dispose()
        await binding.supervisor.dispose()
        await Promise.allSettled(handles.map((handle) => handle.exited))
      }
    },
    30_000
  )
})
