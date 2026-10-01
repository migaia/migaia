import { PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { createServeProcessPlugin } from '../../src/process/plugin/serve.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import type { IProcessPendingByteConnection } from '../../src/process/types.js'
import type { IRemoteServeEndpoint } from '../../src/remote/types.js'
import {
  matrixEndpoint,
  matrixFixture,
  MATRIX_CONTRACT,
  type IMatrixFeature
} from './matrix-fixture.js'

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

describe('I15 real failure and rollback matrix', () => {
  it.each(['launch', 'establish'] as const)(
    '[A6] owned real %s failure frees child and budget; cleanup retains primary',
    async (phase) => {
      const test = await matrixFixture()
      if (test.options.deployment.kind !== 'spawn') throw new Error('spawn required')
      const primary = new Error('fixture establish failure')
      const cleanup = new Error('fixture raw cleanup failure')
      const close = vi.fn(async () => {
        await test.handles[0]!.channel!.close()
        throw cleanup
      })
      const plugin = createProcessPlugin({
        ...test.options,
        deployment: {
          ...test.options.deployment,
          ...(phase === 'launch'
            ? {
                supervision: {
                  ...test.options.deployment.supervision,
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
    '[A6] child real byte ingress rejects %s before handshake and closes raw once',
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
      try {
        const error = await createServeProcessPlugin({
          host: test.host,
          contract: MATRIX_CONTRACT,
          createSharedTarget: async () => undefined,
          onInstanceUnhealthy: () => () => undefined,
          endpointFactory,
          report: (error) => test.reports.push(error),
          ingress: {
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
          }
        }).catch((error: unknown) => error)
        if (phase === 'verifier') expect(reachable(error, primary)).toBe(true)
        else
          expect(error).toMatchObject({
            code: 'PROCESS_PLUGIN_INVALID_OPTION',
            detail: { field: 'ingress.bootstrap' }
          })
        expect(rawClose).toHaveBeenCalledTimes(1)
        expect(establish).not.toHaveBeenCalled()
        expect(endpointFactory).not.toHaveBeenCalled()
        expect(test.business).toBe(0)
      } finally {
        await handle.terminate('force')
        await handle.exited
        await test.cleanup()
      }
    },
    20000
  )

  it.each(['dial', 'auth'] as const)(
    '[A6] borrowed real %s failure preserves external PID and another socket',
    async (phase) => {
      const test = await matrixFixture({ borrowed: true })
      if (test.options.deployment.kind !== 'connect') throw new Error('connect required')
      const primary = new Error('fixture dial failure')
      try {
        const [installed] = await test.host.use(test.plugin)
        const proxy = installed.getFeature('f') as IMatrixFeature
        const another = new PluginHost<Record<string, never>>({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
        try {
          const plugin = createProcessPlugin({
            ...test.options,
            registrationOwner: { name: 'p', host: another },
            host: another.plugin,
            deployment: {
              ...test.options.deployment,
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
                      stream: true
                    })
                  })
            }
          })
          const error = await another.use(plugin).catch((error: unknown) => error)
          expect(error).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
          if (phase === 'dial') expect(reachable(error, primary)).toBe(true)
          else expect(reachableCode(error, 'PROCESS_CHANNEL_AUTH_REJECTED')).toBe(true)
          process.kill(test.handles[0]!.identity.pid!, 0)
          expect(await proxy.request(['unaffected'])).toBe('child:unaffected')
        } finally {
          await another.dispose()
        }
        expect(await proxy.request(['after-cleanup'])).toBe('child:after-cleanup')
        expect(test.terminations).toHaveLength(0)
      } finally {
        await test.cleanup()
      }
    },
    20000
  )

  it.each(['accept', 'endpoint', 'reject'] as const)(
    '[A6] real socket late %s plus cleanup failure reports each original once',
    async (phase) => {
      const test = await matrixFixture({ borrowed: true })
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      const endpoint = deferred<IRemoteServeEndpoint>()
      const accepted = deferred<void>()
      const cleanup = new Error('fixture socket cleanup failure')
      const primary = new Error('fixture late endpoint rejected')
      const report = vi.fn()
      /** Late endpoint construction uses the accepted server channel, never the client transport. */
      let serverChannel!: Parameters<typeof matrixEndpoint>[0]
      const dispose = vi.fn()
      const factory = vi.fn(async (channel: Parameters<typeof matrixEndpoint>[0]) => {
        serverChannel = channel
        return phase === 'accept' ? matrixEndpoint(channel) : endpoint.promise
      })
      let pending!: IProcessPendingByteConnection
      let accepting!: Promise<void>
      let closeCount = 0
      const listener = await createServeProcessPlugin({
        host,
        contract: MATRIX_CONTRACT,
        createSharedTarget: async () => undefined,
        onInstanceUnhealthy: () => () => undefined,
        endpointFactory: factory,
        report,
        ingress: {
          kind: 'listener',
          address: `${test.directory}/late.sock`,
          verify: () => 'fixture-principal',
          offer: createNativeProcessOffer({
            peer: { id: 'server', runtime: 'node' },
            stream: true
          }),
          createConnectionContext: () => ({
            peerId: 'client',
            ipc: { connectionId: 'late', sessionId: 'late', log: () => undefined }
          }),
          listen: (options) =>
            listenProcessByteChannel({
              ...options,
              onConnection: (physical) => {
                pending = {
                  ...physical,
                  accept: async (options) => {
                    const result = await physical.accept(options)
                    if (phase === 'accept') await accepted.promise
                    return {
                      ...result,
                      channel: {
                        ...result.channel,
                        close: async () => {
                          closeCount += 1
                          await result.channel.close()
                          throw cleanup
                        }
                      }
                    }
                  }
                }
                accepting = Promise.resolve(options.onConnection(pending))
                return accepting
              }
            })
        }
      })
      let raw: Awaited<ReturnType<typeof dialProcessByteChannel>> | undefined
      try {
        raw = await dialProcessByteChannel({ address: `${test.directory}/late.sock` })
        const { createProcessTransport } = await import('../../src/process/handshake.js')
        await createProcessTransport(raw, {
          role: 'initiator',
          offer: createNativeProcessOffer({
            peer: { id: 'client', runtime: 'node' },
            auth: 'fixture',
            stream: true
          }),
          peerId: 'server',
          ipc: { connectionId: 'client', sessionId: 'client', log: () => undefined },
          report
        })
        if (phase !== 'accept') await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
        const closing = listener.close()
        if (phase === 'accept') accepted.resolve()
        else if (phase === 'reject') endpoint.reject(primary)
        else {
          const served = await matrixEndpoint(serverChannel)
          endpoint.resolve({
            ...served,
            endpoint: {
              ...served.endpoint,
              dispose: async () => {
                dispose()
                await served.endpoint.dispose()
              }
            }
          })
        }
        await accepting
        await closing
        expect(closeCount).toBe(1)
        expect(report.mock.calls.filter(([error]) => error === cleanup)).toHaveLength(1)
        if (phase === 'reject')
          expect(report.mock.calls.filter(([error]) => error === primary)).toHaveLength(1)
        else
          expect(
            report.mock.calls.filter(([error]) => reachableCode(error, 'PROCESS_CHANNEL_CLOSED'))
          ).toHaveLength(1)
        if (phase === 'accept') expect(factory).not.toHaveBeenCalled()
        if (phase === 'endpoint') expect(dispose).toHaveBeenCalledTimes(1)
        process.kill(test.handles[0]!.identity.pid!, 0)
      } finally {
        await raw?.close()
        await listener.close()
        await host.dispose()
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
