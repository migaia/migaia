import { fileURLToPath } from 'node:url'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle } from '@migaia/supervision/process'
import { describe, expect, it, vi } from 'vitest'
import { processPlugin, type IProcessPluginOptions } from '@migaia/rpc-plugin-process'
import * as bindingModule from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import type { IRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'

/** Flush bounded supervisor and remote continuations after each original manual deadline. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 32; turn += 1) await Promise.resolve()
}

/** Real process health owns its handles, original virtual clock, and current ordinary native Host. */
class NativeHealthScenario {
  /** Policy timers remain virtual while native generation jobs retain host ordering. */
  readonly #scheduler = { ...createManualScheduler(), defer: systemScheduler.defer }
  /** Every real generation retains its native identity and independent exit Promise. */
  readonly #handles: IProcessHandle[] = []
  /** Actual supervisor exits preserve health failure classification across later generations. */
  readonly #exits: unknown[] = []
  /** Reports remain observable for the original private bootstrap secrecy assertion. */
  readonly #reports: unknown[] = []
  /** This existing private bootstrap value never belongs in a public diagnostic descriptor. */
  readonly #token = 'health-fixture-secret'
  /** The original platform launcher owns OS creation, bootstrap, and termination. */
  readonly #launcher = createNodeProcessLauncher()
  /** Actual PluginHost installation supplies native launch context and stable outlet ownership. */
  readonly #host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Only a physical stderr acknowledgement proves the child has entered its busy loop. */
  #entered: () => void = () => undefined
  /** The existing binding construction seam reveals the actual installed supervisor. */
  readonly #bindingObservation = vi.spyOn(bindingModule, 'createSpawnProcessBinding')
  /** The accepted native Peer belongs to the same real Host outlet across process generations. */
  #peer: IRuntimePeer | undefined
  /** The genuine supervisor subscription is removed before final Host disposal. */
  #unsubscribe: (() => void) | undefined

  /** Read only a successful native binding created by this actual Host installation. */
  #binding() {
    /** Construction is observed without replacing production assembly or the returned binding. */
    const result = this.#bindingObservation.mock.results.at(-1)!
    if (result.type !== 'return') throw result.value
    return result.value
  }

  /** Configure the original real native source and default RPC ping health policy. */
  #options(): IProcessPluginOptions {
    return {
      name: 'p',
      self: { name: 'parent', instanceId: 'parent' },
      report: (error) => this.#reports.push(error),
      spawn: {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'native',
        token: this.#token,
        offer: createNativeProcessOffer({
          peer: { id: 'parent', runtime: 'node' },
          auth: this.#token,
          stream: true,
          capabilities: RUNTIME_API_BASE_CAPABILITIES
        }),
        supervision: {
          id: 'busy-health',
          scheduler: this.#scheduler,
          spec: {
            command: process.execPath,
            args: [fileURLToPath(new URL('./fixtures/health-busy-child.mjs', import.meta.url))],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode(this.#token) }
          },
          launcher: {
            capabilities: this.#launcher.capabilities,
            launch: async (spec, context) => {
              /** Preserve the real native handle and its exact process exit Promise. */
              const handle = await this.#launcher.launch(spec, context)
              this.#handles.push(handle)
              return handle
            }
          },
          budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: this.#scheduler }),
          isolation: 'best-effort',
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 3 },
          output: {
            onChunk: (_stream, chunk) => {
              if (new TextDecoder().decode(chunk).includes('busy-loop-entered'))
                (0, this.#entered)()
            }
          },
          report: (error) => this.#reports.push(error)
        },
        rawChannel: async (handle) =>
          (handle as Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>)
            .channel!,
        establish: (raw, context) => {
          if (raw.kind !== 'byte') throw new TypeError('fixture expects native bytes')
          return createProcessTransport(raw, {
            role: 'initiator',
            offer: context.offer!,
            peerId: 'child',
            scheduler: this.#scheduler,
            signal: context.signal as AbortSignal,
            ipc: { ...context.session, log: () => undefined },
            report: (error) => this.#reports.push(error)
          })
        }
      }
    }
  }

  /** One full native health failure proves all three original checks precede process recovery. */
  async #cycle(cycle: number): Promise<void> {
    /** The current child answers business before it deliberately blocks its event loop. */
    const current = this.#handles[cycle]!
    expect(await this.#peer!.request('p.request', ['healthy'])).toBe('child:healthy')
    /** Native stderr, rather than a timing estimate, establishes that the busy loop has started. */
    const hanging = new Promise<void>((resolve) => {
      this.#entered = resolve
    })
    process.kill(current.identity.pid!, 'SIGUSR2')
    await hanging
    /** Virtual cadence remains anchored to the same generation's original clock origin. */
    const origin = this.#scheduler.now()
    for (let check = 0; check < 3; check += 1) {
      this.#scheduler.advance(origin + (check + 1) * 5_000 - this.#scheduler.now())
      await settle()
      expect(this.#exits).toHaveLength(cycle)
      this.#scheduler.advance(2_000)
      await settle()
    }
    await current.exited
    await vi.waitFor(() => expect(this.#binding().supervisor.state).toBe('backoff'))
    expect(this.#exits).toHaveLength(cycle + 1)
    this.#scheduler.advance(1)
    /** The actual existing supervisor owns readiness and unit identity of the replacement. */
    const next = await this.#binding().supervisor.whenReady()
    expect(next.state).toBe('ready')
    if (next.state !== 'ready') throw new Error('fixture replacement failed')
    expect(next.unit.identity.pid).not.toBe(current.identity.pid)
    await vi.waitFor(async () =>
      expect(await this.#peer!.request('p.request', ['rebound'])).toBe('child:rebound')
    )
  }

  /** Retain the original three-handle, two-unhealthy-generation, ping and secrecy assertions. */
  async run(): Promise<void> {
    try {
      await this.#host.use(processPlugin(this.#options()))
      this.#peer = readRuntimeOutletConnection(this.#host.process!, 'p')!.peer
      this.#unsubscribe = this.#binding().supervisor.subscribe((event) => {
        if (event.type === 'exit') this.#exits.push(event)
      })
      for (let cycle = 0; cycle < 2; cycle += 1) await this.#cycle(cycle)
      expect(this.#handles).toHaveLength(3)
      expect(this.#exits).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) }),
        expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) })
      ])
      expect(this.#binding().health).toBe('ping')
      expect(await this.#peer.request('p.request', ['final'])).toBe('child:final')
      expect(JSON.stringify(this.#reports)).not.toContain(this.#token)
    } finally {
      ;(0, this.#unsubscribe)?.()
      await this.#host.dispose()
      this.#bindingObservation.mockRestore()
      await Promise.allSettled(this.#handles.map((handle) => handle.exited))
    }
  }
}

describe('process resilience platform health', () => {
  it('restarts real busy-loop children through native RPC ping in later generations', async () => {
    await new NativeHealthScenario().run()
  }, 30_000)
})
