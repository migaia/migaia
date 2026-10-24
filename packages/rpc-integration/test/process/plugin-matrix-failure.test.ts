import { PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { serveProcessSessions } from '../../../rpc-plugin-process/dist/process/plugin/serve.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { RpcCapability } from '@migaia/rpc-contract'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import type { IProcessPendingByteConnection } from '../../../rpc-plugin-process/dist/process/types.js'
import type { IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import type { IRuntimeByteConnection } from '@migaia/rpc-host/plugin'
import { processSessionManager } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import { matrixEndpoint, matrixFixture } from './matrix-fixture.js'

/** A failure remains traceable by identity through native causes and aggregate cleanup errors. */
function reachable(value: unknown, target: unknown): boolean {
  if (value === target) return true
  if (!value || typeof value !== 'object') return false
  return (
    ('cause' in value && reachable(value.cause, target)) ||
    (value instanceof AggregateError && value.errors.some((entry) => reachable(entry, target)))
  )
}

/** A one-shot port creates exact supported late-result timing, without another lifecycle mechanism. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Each supported late acquisition edge keeps its original independent failure oracle. */
type ILatePhase = 'accept' | 'endpoint' | 'endpoint-dispose' | 'reject'

/** Owns only test timing controls; the actual native accept/session owner performs all cleanup. */
class LateSocketFailure {
  /** The external peer and native scheduler remain owned by the matrix fixture. */
  #test: Awaited<ReturnType<typeof matrixFixture>>
  /** This fixed case chooses the single original late-result edge. */
  #phase: ILatePhase
  /** Original endpoint acquisition can finish only after native listener close begins. */
  #endpoint = deferred<IRemoteServeEndpoint>()
  /** Physical accept may be held before the original session owner receives its receipt. */
  #accepted = deferred<void>()
  /** Physical cleanup failure retains exact identity for the report-once assertion. */
  #cleanup = new Error('fixture socket cleanup failure')
  /** Endpoint cleanup and physical cleanup are independent retained failure identities. */
  #endpointCleanup = new Error('fixture late endpoint cleanup failure')
  /** Rejected endpoint construction remains distinct from cleanup failures. */
  #primary = new Error('fixture late endpoint rejected')
  /** Original report calls prove neither primary nor cleanup failures are swallowed or duplicated. */
  #report = vi.fn()
  /** Caller-owned admission must remain reusable after listener rollback. */
  #resilience: ReturnType<typeof createProcessResilience>
  /** The actual accepted server carrier is the only endpoint composition input. */
  #serverChannel: Parameters<typeof matrixEndpoint>[0] | undefined
  /** Original endpoint disposal count is independent of physical close count. */
  #dispose = vi.fn()
  /** No failing or retired candidate is allowed to publish a provider service. */
  #ready = vi.fn()
  /** One original factory receipt controls the supported late endpoint path. */
  #factory = vi.fn(async (channel: Parameters<typeof matrixEndpoint>[0]) => {
    this.#serverChannel = channel
    return this.#phase === 'accept' ? matrixEndpoint(channel) : this.#endpoint.promise
  })
  /** Original native listener owns pending accepts and close completion. */
  #listener: Awaited<ReturnType<typeof serveProcessSessions>> | undefined
  /** The one original accept task must settle before final close assertions. */
  #accepting: Promise<void> | undefined
  /** Client carrier remains a real Unix socket owned by this scenario. */
  #raw: Awaited<ReturnType<typeof dialProcessByteChannel>> | undefined
  /** A physical close count proves each failed accepted connection is released once. */
  #closeCount = 0

  /** Capture immutable case selection and reuse the original admission manager. */
  constructor(test: Awaited<ReturnType<typeof matrixFixture>>, phase: ILatePhase) {
    this.#test = test
    this.#phase = phase
    this.#resilience = createProcessResilience({
      scheduler: test.scheduler,
      maxConnections: 1,
      report: this.#report
    })
  }

  /** Delay only the original accept result; the physical channel still owns its own close resource. */
  #accept(
    physical: IProcessPendingByteConnection,
    onConnection: (pending: IProcessPendingByteConnection) => void | Promise<void>
  ): Promise<void> {
    const pending: IProcessPendingByteConnection = {
      ...physical,
      accept: async (options) => {
        const result = await physical.accept(options)
        if (this.#phase === 'accept') await this.#accepted.promise
        const channel = result.channel as IRuntimeByteConnection
        channel.ownClose({
          close: async () => {
            this.#closeCount += 1
            await physical.close()
            throw this.#cleanup
          }
        })
        return result
      }
    }
    return (this.#accepting = Promise.resolve(onConnection(pending)))
  }

  /** Open the genuine native ingress with the original authenticated principal and session labels. */
  async #start(): Promise<void> {
    this.#listener = await serveProcessSessions(
      {
        kind: 'listener',
        address: `${this.#test.directory}/late.sock`,
        scheduler: this.#test.scheduler,
        verify: () => 'fixture-principal',
        offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' }, stream: true }),
        createConnectionContext: () => ({
          peerId: 'client',
          ipc: { connectionId: 'late', sessionId: 'late', log: () => undefined }
        }),
        listen: (options) =>
          listenProcessByteChannel({
            ...options,
            onConnection: (physical) => this.#accept(physical, options.onConnection)
          })
      },
      this.#factory,
      this.#ready,
      this.#resilience,
      this.#report,
      undefined,
      this.#test.scheduler
    )
  }

  /**
   * Finish one delayed acquisition after close, retaining original endpoint/disposal failure
   * identity.
   */
  async #finishEndpoint(): Promise<void> {
    if (this.#phase === 'accept') {
      this.#accepted.resolve()
      return
    }
    if (this.#phase === 'reject') {
      this.#endpoint.reject(this.#primary)
      return
    }
    const served = await matrixEndpoint(this.#serverChannel!)
    this.#endpoint.resolve({
      ...served,
      endpoint: {
        ...served.endpoint,
        dispose: async () => {
          this.#dispose()
          await served.endpoint.dispose()
          if (this.#phase === 'endpoint-dispose') throw this.#endpointCleanup
        }
      }
    })
  }

  /** Exercise the same socket/handshake/late-close transaction and all original failure oracles. */
  async run(): Promise<void> {
    await this.#start()
    this.#raw = await dialProcessByteChannel({ address: `${this.#test.directory}/late.sock` })
    const { createProcessTransport } =
      await import('../../../rpc-plugin-process/dist/process/handshake.js')
    await createProcessTransport(this.#raw, {
      role: 'initiator',
      offer: createNativeProcessOffer({
        peer: { id: 'client', runtime: 'node' },
        auth: 'fixture',
        stream: true
      }),
      peerId: 'server',
      ipc: { connectionId: 'client', sessionId: 'client', log: () => undefined },
      report: this.#report
    })
    if (this.#phase !== 'accept')
      await vi.waitFor(() => expect(this.#factory).toHaveBeenCalledTimes(1))
    const closing = this.#listener!.close()
    await this.#finishEndpoint()
    await this.#accepting
    await closing
    expect(this.#closeCount).toBe(1)
    expect(this.#report.mock.calls.filter(([error]) => error === this.#cleanup)).toHaveLength(1)
    if (this.#phase === 'reject')
      expect(this.#report.mock.calls.filter(([error]) => error === this.#primary)).toHaveLength(1)
    else
      expect(
        this.#report.mock.calls.filter(([error]) => reachableCode(error, 'PROCESS_CHANNEL_CLOSED'))
      ).toHaveLength(1)
    if (this.#phase === 'accept') expect(this.#factory).not.toHaveBeenCalled()
    if (this.#phase === 'endpoint' || this.#phase === 'endpoint-dispose')
      expect(this.#dispose).toHaveBeenCalledTimes(1)
    if (this.#phase === 'endpoint-dispose')
      expect(
        this.#report.mock.calls.filter(([error]) => error === this.#endpointCleanup)
      ).toHaveLength(1)
    expect(this.#ready).not.toHaveBeenCalled()
    expect(() => {
      const next = processSessionManager(this.#resilience)!.claimConnection()
      next.release()
    }).not.toThrow()
    process.kill(this.#test.handles[0]!.identity.pid!, 0)
  }

  /** Close only scenario-owned native resources, then release the borrowed governor once. */
  async close(): Promise<void> {
    await this.#raw?.close()
    await this.#listener?.close()
    await this.#resilience.close()
  }
}

describe('real failure and rollback matrix', () => {
  it.each(['launch', 'establish'] as const)(
    'owned real %s failure frees child and budget; cleanup retains primary',
    async (phase) => {
      const test = await matrixFixture()
      if (!test.spawn) throw new Error('spawn required')
      const primary = new Error('fixture establish failure')
      const cleanup = new Error('fixture raw cleanup failure')
      const close = vi.fn(async () => {
        await test.handles[0]!.channel!.close()
        throw cleanup
      })
      const plugin = processPlugin({
        ...test.settings,
        spawn: {
          ...test.spawn,
          ...(phase === 'launch'
            ? {
                supervision: {
                  ...test.spawn.supervision,
                  spec: { ...test.spec, command: '/i15-no-such-command' }
                }
              }
            : {
                rawChannel: async (handle) => ({
                  ...(handle as (typeof test.handles)[number]).channel!,
                  close
                }),
                establish: async () => {
                  throw primary
                }
              })
        }
      })
      try {
        const error = await test.host.use(plugin).catch((error: unknown) => error)
        expect(error).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
        if (phase === 'establish') {
          expect(reachable(error, primary)).toBe(true)
          expect(test.reports.filter((error) => error === cleanup)).toHaveLength(1)
          expect(close).toHaveBeenCalledTimes(1)
          expect(test.terminations.length).toBeGreaterThan(0)
        }
        for (const handle of test.handles) await handle.exited
        expect(test.budget.inUse).toBe(0)
      } finally {
        await test.cleanup()
      }
    },
    20000
  )

  it.each(['bootstrap', 'verifier'] as const)(
    'child real byte ingress rejects %s before handshake and closes raw once',
    async (phase) => {
      /** The physical raw channel is provided by the production Node launcher. */
      const test = await matrixFixture()
      const handle = await test.launcher.launch(test.spec, {
        signal: new AbortController().signal,
        output: () => undefined
      })
      const primary = new Error('fixture verifier construction failure')
      const rawClose = vi.fn(async () => {
        await handle.channel!.close()
      })
      const establish = vi.fn()
      const endpointFactory = vi.fn()
      const exit = vi.fn()
      /** Supported invalid ingress cannot construct or publish a provider service. */
      const ready = vi.fn()
      const resilience = createProcessResilience({
        scheduler: test.scheduler,
        report: (error) => test.reports.push(error)
      })
      try {
        const error = await serveProcessSessions(
          {
            kind: 'child',
            channelKind: 'byte',
            openRaw: async () =>
              phase === 'bootstrap'
                ? ({ ...handle.channel!, close: rawClose } as never)
                : { raw: { ...handle.channel!, close: rawClose }, bootstrap: new Uint8Array([1]) },
            createVerifier: () => {
              if (phase === 'verifier') throw primary
              return () => undefined
            },
            establish,
            parentLoss: { exit }
          },
          endpointFactory,
          ready,
          resilience,
          (error) => test.reports.push(error),
          undefined,
          test.scheduler
        ).catch((error: unknown) => error)
        if (phase === 'verifier') expect(reachable(error, primary)).toBe(true)
        else
          expect(error).toMatchObject({
            code: 'PROCESS_PLUGIN_INVALID_OPTION',
            detail: { field: 'ingress.bootstrap' }
          })
        expect(rawClose).toHaveBeenCalledTimes(1)
        expect(establish).not.toHaveBeenCalled()
        expect(endpointFactory).not.toHaveBeenCalled()
        expect(ready).not.toHaveBeenCalled()
        expect(test.business).toBe(0)
      } finally {
        await resilience.close()
        await handle.terminate('force')
        await handle.exited
        await test.cleanup()
      }
    },
    20000
  )

  it.each(['dial', 'auth'] as const)(
    'borrowed real %s failure preserves external PID and another socket',
    async (phase) => {
      const test = await matrixFixture({ borrowed: true })
      if (!test.connect) throw new Error('connect required')
      const primary = new Error('fixture dial failure')
      try {
        await test.host.use(test.plugin)
        const another = new PluginHost<Record<string, never>>({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        try {
          const plugin = processPlugin({
            ...test.settings,
            connect: {
              target: {
                ...test.connect,
                ...(phase === 'dial'
                  ? {
                      dial: async () => {
                        throw primary
                      }
                    }
                  : {
                      token: 'wrong-fixture-token',
                      offer: createNativeProcessOffer({
                        peer: { id: 'bad', runtime: 'node' },
                        auth: 'wrong-fixture-token',
                        capabilities: [RpcCapability.runtimeApi],
                        stream: true
                      })
                    })
              }
            }
          })
          const error = await another.use(plugin).catch((error: unknown) => error)
          expect(error).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
          if (phase === 'dial') expect(reachable(error, primary)).toBe(true)
          else expect(reachableCode(error, 'PROCESS_CHANNEL_AUTH_REJECTED')).toBe(true)
          process.kill(test.handles[0]!.identity.pid!, 0)
          expect(await test.outlet.request('p', 'p.f.request', ['unaffected'])).toBe(
            'child:unaffected'
          )
        } finally {
          await another.dispose()
        }
        expect(await test.outlet.request('p', 'p.f.request', ['after-cleanup'])).toBe(
          'child:after-cleanup'
        )
        expect(test.terminations).toHaveLength(0)
      } finally {
        await test.cleanup()
      }
    },
    20000
  )

  it.each(['accept', 'endpoint', 'endpoint-dispose', 'reject'] as const)(
    'real socket late %s plus cleanup failure reports each original once',
    async (phase) => {
      const test = await matrixFixture({ borrowed: true })
      const scenario = new LateSocketFailure(test, phase)
      try {
        await scenario.run()
      } finally {
        await scenario.close()
        await test.cleanup()
      }
    },
    20000
  )
})

/** Match a canonical error code without assuming wrappers flatten native cause chains. */
function reachableCode(value: unknown, code: string): boolean {
  if (!value || typeof value !== 'object') return false
  return (
    ('code' in value && value.code === code) ||
    ('cause' in value && reachableCode(value.cause, code)) ||
    (value instanceof AggregateError && value.errors.some((entry) => reachableCode(entry, code)))
  )
}
