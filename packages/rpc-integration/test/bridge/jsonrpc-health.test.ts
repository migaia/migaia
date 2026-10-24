import type { IAbortSignal } from '@migaia/utils/promise'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { createSpawnProcessBinding } from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { createManagedRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/managed-peer.js'
import type { IRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import type { IRpcEndpoint } from '../../../rpc-host/dist/core/typing.js'
import { flush } from './fixture.js'
import {
  childPath,
  token,
  fdLauncher,
  establish,
  type IFixtureHandle
} from './fixtures/jsonrpc-process.js'

/** Own real OS generations, custom business health, and the unchanged virtual policy clock. */
class JsonRpcHealthScenario {
  /** Policy timers remain virtual while native generation jobs retain host ordering. */
  readonly scheduler = { ...createManualScheduler(), defer: systemScheduler.defer }
  /** Every independently launched process retains its original native handle and exit Promise. */
  readonly #handles: IFixtureHandle[] = []
  /** Custom health targets only the actual endpoint prepared for its physical generation. */
  readonly #endpoints = new Map<IFixtureHandle, IRpcEndpoint>()
  /** Canonical channels retain their physical handle before endpoint publication. */
  readonly #channelHandles = new Map<object, IFixtureHandle>()
  /** Authentication uses the existing dedicated-fd launcher rather than RPC stdin. */
  readonly #launcher = fdLauncher()
  /** Reports keep original failure objects through abort, health failure, and replacement. */
  readonly #reports: unknown[] = []
  /** Physical stderr acknowledgement alone proves entry into the child busy loop. */
  #entered: () => void = () => undefined
  /** Only actual supervisor custom-health dispatch increments this count. */
  #checks = 0
  /** Real exit events distinguish process recovery from local request deadlines. */
  readonly #exits: unknown[] = []
  /** The original variant chooses default none or explicit ordinary-business custom health. */
  readonly #custom: boolean
  /** Existing supervision remains the sole process lifecycle and drain owner. */
  readonly #binding
  /** One managed callable retains its identity across all genuine generations. */
  #peer: IRuntimePeer | undefined
  /** Final cleanup removes the exact native supervisor observation receipt. */
  readonly #unsubscribe: () => void

  /** Configure the same cold native deployment without launching a process. */
  constructor(custom: boolean) {
    this.#custom = custom
    this.#binding = createSpawnProcessBinding(
      {
        kind: 'spawn',
        wire: 'jsonrpc',
        channelKind: 'byte',
        token,
        supervision: {
          id: 'bridge-busy-health',
          scheduler: this.scheduler,
          spec: {
            command: process.execPath,
            args: [childPath],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'fd', fd: 3, payload: new TextEncoder().encode(token) }
          },
          launcher: {
            capabilities: this.#launcher.capabilities,
            launch: async (spec, context) => {
              /** Preserve the exact native handle before supervisor readiness and channel assembly. */
              const handle = await this.#launcher.launch(spec, context)
              this.#handles.push(handle)
              return handle
            }
          },
          ...(custom
            ? {
                health: {
                  intervalMs: 5_000,
                  timeoutMs: 2_000,
                  failureThreshold: 3,
                  check: this.#healthCheck
                }
              }
            : {}),
          budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: this.scheduler }),
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
        rawChannel: async (handle) => handle.channel,
        establish: async (raw, context) => {
          /** Authentication, IPC, and virtual policy clock retain their existing bridge owner. */
          const channel = await establish([], this.#reports, [])(raw, context)
          this.#channelHandles.set(channel, this.#handles.at(-1)!)
          return channel
        }
      },
      (error) => this.#reports.push(error)
    )
    this.#unsubscribe = this.#binding.supervisor.subscribe((event) => {
      if (event.type === 'exit') this.#exits.push(event)
    })
  }

  /** Explicit custom health uses ordinary bridge business and never invents native ping. */
  #healthCheck = async (unit: IFixtureHandle, signal: IAbortSignal): Promise<void> => {
    this.#checks++
    /** The native generation may be checked before its endpoint has been published. */
    const endpoint = this.#endpoints.get(unit)
    if (endpoint)
      await endpoint.send('peer', 'p.f.request', ['custom-health'], { signal, timeoutMs: false })
  }

  /** Use the actual managed Peer and the binding's original endpoint policy on every generation. */
  async #open(): Promise<void> {
    this.#peer = await createManagedRuntimePeer(
      {
        self: { name: 'client', instanceId: 'client' },
        report: (error) => this.#reports.push(error)
      },
      this.#binding,
      (channel, served) => {
        /** Actual provider composition is observed before the native drain boundary is installed. */
        this.#endpoints.set(this.#channelHandles.get(channel)!, served.endpoint)
        return this.#binding.bindEndpoint(channel, served)
      }
    )
  }

  /** Three original custom-health deadlines retire one real busy process and rebind its callable. */
  async #recover(current: IFixtureHandle): Promise<void> {
    /** The original clock origin prevents elapsed-time estimates from changing health cadence. */
    const origin = this.scheduler.now()
    for (let check = 0; check < 3; check++) {
      this.scheduler.advance(origin + (check + 1) * 5_000 - this.scheduler.now())
      await flush()
      this.scheduler.advance(2_000)
      await flush()
    }
    await current.exited
    await vi.waitFor(() => expect(this.#binding.supervisor.state).toBe('backoff'))
    this.scheduler.advance(1)
    await this.#binding.supervisor.whenReady()
    await vi.waitFor(async () =>
      expect(await this.#peer!.request('p.f.request', ['rebound'])).toMatchObject({
        args: ['rebound']
      })
    )
  }

  /** Default health none leaves the same busy PID alive after an ordinary local request deadline. */
  async #retainBusy(current: IFixtureHandle): Promise<void> {
    /** Capture the original deadline error independently from native process health. */
    let failure: unknown
    /** The request enters the real endpoint before advancing its original local deadline. */
    const request = this.#peer!
      .request('p.f.request', ['busy'], { timeoutMs: 500 })
      .catch((error) => {
        failure = error
      })
    await flush()
    this.scheduler.advance(500)
    await request
    expect(failure).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    this.scheduler.advance(30_000)
    await flush()
    expect(this.#checks).toBe(0)
    expect(this.#handles).toHaveLength(1)
    expect(this.#exits).toHaveLength(0)
    expect(this.#binding.supervisor.state).toBe('ready')
    expect(current.child.exitCode).toBeNull()
  }

  /** Exercise the original two physical unhealthy recoveries or the single default-none generation. */
  async run(): Promise<void> {
    try {
      await this.#open()
      expect(this.#binding.health).toBe(this.#custom ? 'custom' : 'none')
      if (!this.#custom) {
        this.scheduler.advance(30_000)
        await flush()
        expect(this.#checks).toBe(0)
      }
      for (let cycle = 0; cycle < (this.#custom ? 2 : 1); cycle++) {
        /** Current native identity must answer before its event loop is intentionally blocked. */
        const current = this.#handles[cycle]!
        expect(await this.#peer!.request('p.f.request', ['healthy'])).toMatchObject({
          args: ['healthy']
        })
        /** The real child's stderr acknowledgement precedes every virtual health advance. */
        const busy = new Promise<void>((resolve) => {
          this.#entered = resolve
        })
        process.kill(current.identity.pid!, 'SIGUSR2')
        await busy
        if (!this.#custom) await this.#retainBusy(current)
        else {
          await this.#recover(current)
          expect(this.#handles[cycle + 1]!.identity.pid).not.toBe(current.identity.pid)
        }
      }
      if (this.#custom) {
        expect(this.#handles).toHaveLength(3)
        expect(this.#checks).toBe(6)
        expect(this.#exits).toEqual([
          expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) }),
          expect.objectContaining({ error: expect.objectContaining({ code: 'UNHEALTHY' }) })
        ])
        expect(await this.#peer!.request('p.f.request', ['final'])).toMatchObject({
          args: ['final']
        })
      }
    } finally {
      this.#unsubscribe()
      await this.#peer?.close()
      await this.#binding.supervisor.dispose()
      await Promise.allSettled(this.#handles.map((handle) => handle.exited))
    }
  }
}

/** A logical clock proves default none and explicit custom health without elapsed-time guesses. */
describe('JSON-RPC real process health', () => {
  it.each([false, true])(
    'busy child obeys health none/custom and generation retest (custom=%s)',
    async (custom) => {
      await new JsonRpcHealthScenario(custom).run()
    },
    30_000
  )
})
