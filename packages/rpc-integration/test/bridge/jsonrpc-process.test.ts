import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { inspect } from 'node:util'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { observeNativeEndpoints } from '../process/fixtures/host-native.js'
import { createUnitBudget } from '@migaia/supervision'

import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createProcessJsonRpcChannel } from '../../../rpc-plugin-process/dist/process/jsonrpc-channel.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import * as processBinding from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { CHILD_STDERR_REDACTED } from '../fixtures/process-diagnostics.js'
import { nodeByteStream } from '../../../rpc-plugin-process/dist/process/node-byte-stream.js'
import { dialProcessByteChannel } from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import type { IIpcLogRecord } from '@migaia/rpc-host/plugin'
import { bridgeEndpoint, BridgeFixture } from './fixture.js'

import {
  childPath,
  token,
  fdLauncher,
  establish,
  type IFixtureHandle
} from './fixtures/jsonrpc-process.js'

/** Exact foreign fixture wire payload remains independent of native Host type declarations. */
type IBridgeReply = {
  args: unknown[]
  first: number
  events: Array<{ method: string; id?: string; params: { id?: string } }>
}

/** Invoke the real remote proxy, then inspect only independently recorded wire events. */
async function exercise(
  host: ReturnType<typeof runtimeTestHost>,
  plugin: ReturnType<typeof processPlugin>
) {
  await host.use(plugin)
  /** The genuine native outlet invokes only the current committed JSON-RPC connection. */
  const outlet = host.process!
  const first = (await outlet.request('p', 'p.f.request', ['value'], {
    timeoutMs: 1000
  })) as IBridgeReply
  expect(first.args).toEqual(['value'])
  expect(first.first).toBe(67)
  expect(first.events.slice(0, 3).map((event) => event.method)).toEqual([
    'migaia.hello',
    'migaia.describe',
    'migaia.invoke'
  ])
  await outlet.notify('p', 'p.f.oneWay', ['notification'])
  const controller = new AbortController()
  const pending = outlet.request('p', 'p.f.request', ['__wait'], {
    signal: controller.signal,
    timeoutMs: 1000
  })
  /** A subsequent request proves the waiting invocation reached the physical peer before abort. */
  await outlet.request('p', 'p.f.request', ['barrier'], { timeoutMs: 1000 })
  controller.abort(new Error('caller cancelled'))
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  const snapshot = (await outlet.request('p', 'p.f.request', ['snapshot'], {
    timeoutMs: 1000
  })) as IBridgeReply
  const notification = snapshot.events.find(
    (event) => event.method === 'migaia.invoke' && event.id === undefined
  )
  expect(notification).toBeDefined()
  const cancels = snapshot.events.filter((event) => event.method === 'migaia.cancel')
  expect(cancels).toHaveLength(1)
  expect(cancels[0]).not.toHaveProperty('id')
  expect(snapshot.events.findIndex((event) => event.id === cancels[0]!.params.id)).toBeLessThan(
    snapshot.events.indexOf(cancels[0]!)
  )
  return outlet
}

describe('JSON-RPC real process carriers', () => {
  it('uses fd bootstrap and real stdio with redacted, unsubscribed stderr', async () => {
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    const logs: IIpcLogRecord[] = [],
      reports: unknown[] = [],
      removals: number[] = []
    /**
     * Observe the original native binding's real JSON-RPC health selection without a removed
     * governor wrapper.
     */
    const binding = vi.spyOn(processBinding, 'createSpawnProcessBinding')
    let child: ChildProcess | undefined
    const retained: Array<(chunk: Uint8Array) => void> = []
    const plugin = processPlugin({
      name: 'p',
      report: (error) => reports.push(error),
      spawn: {
        kind: 'spawn',
        wire: 'jsonrpc',
        channelKind: 'byte',
        token,
        supervision: {
          id: 'jsonrpc-child',
          spec: {
            command: process.execPath,
            args: [childPath],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'fd', fd: 3, payload: new TextEncoder().encode(token) }
          },
          launcher: fdLauncher(),
          budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
          isolation: 'best-effort',
          restart: { maxRestarts: 0 },
          report: (error) => reports.push(error)
        },
        rawChannel: async (handle) => {
          /** The actual fd launcher returns this exact native handle and raw byte resource. */
          const native = handle as IFixtureHandle
          child = native.child
          return native.channel
        },
        establish: establish(logs, reports, removals, retained)
      }
    })
    try {
      const outlet = await exercise(host, plugin)
      expect(binding.mock.results[0]?.value).toMatchObject({ health: 'none' })
      await outlet.request('p', 'p.f.request', ['__stderr1'], { timeoutMs: 1000 })
      await vi.waitFor(() =>
        expect(logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(1)
      )
      await outlet.request('p', 'p.f.request', ['__stderr2'], { timeoutMs: 1000 })
      await vi.waitFor(() =>
        expect(logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(2)
      )
      const entries = logs.filter((entry) => entry.name === 'ipc.stderr')
      expect(entries).toEqual([
        expect.objectContaining({ text: CHILD_STDERR_REDACTED }),
        expect.objectContaining({ text: CHILD_STDERR_REDACTED })
      ])
      expect(entries[0]!.connectionId).toBe(entries[1]!.connectionId)
      expect(entries[0]!.sessionId).toBe(entries[1]!.sessionId)
      const evidence = inspect({ logs, reports }, { depth: null, showHidden: true })
      for (let offset = 0; offset <= token.length - 6; offset++)
        expect(evidence).not.toContain(token.slice(offset, offset + 6))
    } finally {
      await host.dispose()
      binding.mockRestore()
    }
    expect(removals).toHaveLength(1)
    retained[0]!(new TextEncoder().encode(token))
    expect(logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(2)
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true)
  })

  it.each(['stdio', 'socket'])(
    'refuses missing/wrong tokens before ready over real %s bytes',
    async (carrier) => {
      if (carrier === 'socket' && process.platform === 'win32') return
      const address =
        carrier === 'socket' ? join(tmpdir(), `jt-${randomUUID().slice(0, 8)}.sock`) : undefined
      const child = spawn(process.execPath, [childPath, ...(address ? [address] : [])], {
        env: {},
        stdio: ['pipe', 'pipe', 'pipe', 'pipe']
      })
      const exited = once(child, 'close')
      ;(child.stdio[3] as Writable).end(token)
      const raw = address
        ? (await once(child.stdout!, 'data'), await dialProcessByteChannel({ address }))
        : nodeByteStream(child.stdout!, child.stdin!, () => {
            child.stdout!.destroy()
            child.stdin!.destroy()
          })
      const writes: Uint8Array[] = []
      const byte: IProcessByteChannel = {
        ...raw,
        write: (chunk) => {
          writes.push(chunk)
          return raw.write(chunk)
        }
      }
      try {
        const options = { ...new BridgeFixture().options, byte, scheduler: systemScheduler }
        await expect(createProcessJsonRpcChannel({ ...options, token: '' })).rejects.toMatchObject({
          code: 'JSONRPC_PROFILE_INVALID'
        })
        expect(writes).toEqual([])
        await expect(
          createProcessJsonRpcChannel({ ...options, token: 'wrong-credential' })
        ).rejects.toMatchObject({
          code: 'HANDSHAKE_REJECTED',
          cause: { source: 'jsonrpc-fixture', code: 'AUTH_DENIED' }
        })
        expect(writes).toHaveLength(1)
        expect(writes[0]![0]).toBe(67)
        expect(JSON.parse(Buffer.from(writes[0]!).toString().split('\r\n\r\n')[1]!).method).toBe(
          'migaia.hello'
        )
      } finally {
        await raw.close()
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        await exited
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'forwards a wrong connect token through plugin establish without disturbing the borrowed peer',
    async () => {
      /** The independently owned listener retains a second authenticated connection. */
      const address = join(tmpdir(), `ja-${randomUUID().slice(0, 8)}.sock`)
      /** Private fd authentication leaves the RPC socket and child argv free of credentials. */
      const child = spawn(process.execPath, [childPath, address], {
        env: {},
        stdio: ['ignore', 'pipe', 'pipe', 'pipe']
      })
      /** Attach exit observation before any possible failure can close the child. */
      const exited = once(child, 'close')
      ;(child.stdio[3] as Writable).end(token)
      await once(child.stdout!, 'data')
      /** The ordinary PluginHost must not publish an unauthenticated feature. */
      const host = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      /** Physical frames prove authentication rejection occurs before business. */
      const writes: Array<{ method: string; params: { hello?: string } }> = []
      /** The factory cannot run before authenticated bridge readiness. */
      let endpoints = 0
      /** Only actual authenticated Peer preparation may reach this original observation seam. */
      const removeObservation = observeNativeEndpoints('bad-jsonrpc-client', (served) => {
        endpoints += 1
        return served
      })
      /** A healthy connection proves failed installation does not own the external process. */
      const second = await createProcessJsonRpcChannel({
        ...new BridgeFixture().options,
        byte: await dialProcessByteChannel({ address }),
        scheduler: systemScheduler,
        token
      })
      /** Real core requests run through the independent connection's negotiated pipeline. */
      const endpoint = await bridgeEndpoint(second)
      try {
        /** The bad token is passed by the deployment context rather than captured in establish. */
        const plugin = processPlugin({
          name: 'p',
          self: { name: 'bad-jsonrpc-client', instanceId: 'bad-jsonrpc-client' },
          report: () => undefined,
          connect: {
            target: {
              kind: 'connect',
              wire: 'jsonrpc',
              address,
              token: 'wrong-credential',
              dial: async (path, signal) => {
                /** The borrowed byte stream is observed without changing carrier behavior. */
                const raw = await dialProcessByteChannel({
                  address: path,
                  signal: signal as AbortSignal
                })
                return {
                  ...raw,
                  write(chunk) {
                    writes.push(JSON.parse(Buffer.from(chunk).toString().split('\r\n\r\n')[1]!))
                    return raw.write(chunk)
                  }
                }
              },
              establish: establish([], [], []),
              supervision: { restart: { maxRestarts: 0 } }
            }
          }
        })
        /** Retain the original authentication failure through all existing installation wrappers. */
        const failure = await host.use(plugin).catch((error: unknown) => error)
        expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
        /** A bounded cause traversal checks authentication identity without assuming wrapper count. */
        const chain: unknown[] = []
        /** Original causes remain reachable rather than being replaced by facade text. */
        let current: unknown = failure
        for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
          chain.push(current)
          current = (current as { cause?: unknown }).cause
        }
        expect(chain).toContainEqual(
          expect.objectContaining({
            code: 'HANDSHAKE_REJECTED',
            cause: expect.objectContaining({ code: 'AUTH_DENIED' })
          })
        )
        expect(endpoints).toBe(0)
        expect(writes).toHaveLength(1)
        expect(writes[0]!.method).toBe('migaia.hello')
        expect(JSON.parse(writes[0]!.params.hello!).auth).toBe('wrong-credential')
        expect(child.exitCode).toBeNull()
        expect(
          await endpoint.send('peer', 'p.f.request', ['unaffected'], { timeoutMs: 1000 })
        ).toMatchObject({ args: ['unaffected'] })
      } finally {
        await host.dispose()
        await endpoint.dispose()
        await second.close()
        removeObservation()
        child.kill('SIGTERM')
        await exited
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'borrows a Unix socket process and preserves its second connection',
    async () => {
      const address = join(tmpdir(), `jc-${randomUUID().slice(0, 8)}.sock`)
      const child = spawn(process.execPath, [childPath, address], {
        env: {},
        stdio: ['ignore', 'pipe', 'pipe', 'pipe']
      })
      const exited = once(child, 'close')
      ;(child.stdio[3] as Writable).end(token)
      await once(child.stdout!, 'data')
      const host = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      const logs: IIpcLogRecord[] = [],
        reports: unknown[] = [],
        removals: number[] = []
      const open = establish(logs, reports, removals)
      let second: Awaited<ReturnType<typeof createProcessJsonRpcChannel>> | undefined
      try {
        second = await createProcessJsonRpcChannel({
          ...new BridgeFixture().options,
          byte: await dialProcessByteChannel({ address }),
          scheduler: systemScheduler,
          token
        })
        const plugin = processPlugin({
          name: 'p',
          report: (error) => reports.push(error),
          connect: {
            target: {
              kind: 'connect',
              wire: 'jsonrpc',
              address,
              token,
              dial: (path, signal) =>
                dialProcessByteChannel({ address: path, signal: signal as AbortSignal }),
              establish: open,
              /** JSON-RPC uses the default health none without a native ping workaround. */
              supervision: { restart: { maxRestarts: 0 } }
            }
          }
        })
        await exercise(host, plugin)
        await host.dispose()
        expect(child.exitCode).toBeNull()
        const endpoint = await bridgeEndpoint(second)
        expect(
          await endpoint.send('peer', 'p.f.request', ['still-running'], { timeoutMs: 1000 })
        ).toMatchObject({ args: ['still-running'], first: 67 })
        await endpoint.dispose()
      } finally {
        await host.dispose()
        await second?.close()
        child.kill('SIGTERM')
        await exited
      }
    }
  )
})
