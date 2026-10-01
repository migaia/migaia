import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { inspect } from 'node:util'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'

import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createJsonRpcRemoteChannel } from '../../src/bridge/jsonrpc/index.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import { CHILD_STDERR_REDACTED } from '../../src/process/constants.js'
import { nodeByteStream } from '../../src/process/adapters/node-byte-stream.js'
import { dialProcessByteChannel } from '../../src/process/adapters/node-socket.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import type { IIpcLogRecord } from '../../src/core/plugins/flow-control.js'
import { BRIDGE_CONTRACT, bridgeEndpoint, bridgeFixture } from './fixture.js'

import { childPath, token, fdLauncher, establish } from './fixtures/jsonrpc-process.js'

/** Invoke the real remote proxy, then inspect only independently recorded wire events. */
async function exercise(
  host: PluginHost<Record<string, never>>,
  plugin: ReturnType<typeof createProcessPlugin>
) {
  const [installed] = await host.use(plugin)
  const feature = installed!.getFeature('f') as {
    request(
      args: unknown[],
      options?: { signal?: AbortSignal; timeoutMs?: number }
    ): Promise<{
      args: unknown[]
      first: number
      events: Array<{ method: string; id?: string; params: { id?: string } }>
    }>
    oneWay(args: unknown[]): Promise<void>
  }
  const first = await feature.request(['value'], { timeoutMs: 1000 })
  expect(first.args).toEqual(['value'])
  expect(first.first).toBe(67)
  expect(first.events.slice(0, 3).map((event) => event.method)).toEqual([
    'migaia.hello',
    'migaia.describe',
    'migaia.invoke'
  ])
  await feature.oneWay(['notification'])
  const controller = new AbortController()
  const pending = feature.request(['__wait'], { signal: controller.signal, timeoutMs: 1000 })
  /** A subsequent request proves the waiting invocation reached the physical peer before abort. */
  await feature.request(['barrier'], { timeoutMs: 1000 })
  controller.abort(new Error('caller cancelled'))
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  const snapshot = await feature.request(['snapshot'], { timeoutMs: 1000 })
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
  return feature
}

describe('JSON-RPC real process carriers', () => {
  it('[A8] uses fd bootstrap and real stdio with redacted, unsubscribed stderr', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const logs: IIpcLogRecord[] = [],
      reports: unknown[] = [],
      removals: number[] = []
    const resilience = createProcessResilience({
      scheduler: systemScheduler,
      report: (error) => reports.push(error)
    })
    let child: ChildProcess | undefined
    const retained: Array<(chunk: Uint8Array) => void> = []
    const plugin = createProcessPlugin({
      name: 'p',
      contract: BRIDGE_CONTRACT,
      registrationOwner: { name: 'p', host },
      host: host.plugin,
      resilience,
      report: (error) => reports.push(error),
      deployment: {
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
          child = handle.child
          return handle.channel
        },
        establish: establish(logs, reports, removals, retained)
      },
      endpointFactory: async (channel) => {
        const endpoint = await bridgeEndpoint(channel)
        return { endpoint, oneWay: endpoint }
      }
    })
    try {
      const feature = await exercise(host, plugin)
      expect(resilience.inspect('p')).toMatchObject({ health: 'none' })
      await feature.request(['__stderr1'], { timeoutMs: 1000 })
      await vi.waitFor(() =>
        expect(logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(1)
      )
      await feature.request(['__stderr2'], { timeoutMs: 1000 })
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
      await resilience.close()
    }
    expect(removals).toHaveLength(1)
    retained[0]!(new TextEncoder().encode(token))
    expect(logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(2)
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true)
  })

  it.each(['stdio', 'socket'])(
    '[A4/A8] refuses missing/wrong tokens before ready over real %s bytes',
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
        const options = { ...bridgeFixture().options, byte, scheduler: systemScheduler }
        await expect(createJsonRpcRemoteChannel({ ...options, token: '' })).rejects.toMatchObject({
          code: 'JSONRPC_PROFILE_INVALID'
        })
        expect(writes).toEqual([])
        await expect(
          createJsonRpcRemoteChannel({ ...options, token: 'wrong-credential' })
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
    '[I15 A8/M2] forwards a wrong connect token through plugin establish without disturbing the borrowed peer',
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
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** Physical frames prove authentication rejection occurs before business. */
      const writes: Array<{ method: string; params: { hello?: string } }> = []
      /** The factory cannot run before authenticated bridge readiness. */
      let endpoints = 0
      /** A healthy connection proves failed installation does not own the external process. */
      const second = await createJsonRpcRemoteChannel({
        ...bridgeFixture().options,
        byte: await dialProcessByteChannel({ address }),
        scheduler: systemScheduler,
        token
      })
      /** Real core requests run through the independent connection's negotiated pipeline. */
      const endpoint = await bridgeEndpoint(second)
      try {
        /** The bad token is passed by the deployment context rather than captured in establish. */
        const plugin = createProcessPlugin({
          name: 'p',
          contract: BRIDGE_CONTRACT,
          registrationOwner: { name: 'p', host },
          host: host.plugin,
          report: () => undefined,
          deployment: {
            kind: 'connect',
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
            /** Connect wire omission remains K231; this caller supplies explicit transport health. */
            supervision: { restart: { maxRestarts: 0 }, health: { check: async () => undefined } }
          },
          endpointFactory: async (channel) => {
            endpoints++
            return { endpoint: await bridgeEndpoint(channel) }
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
        child.kill('SIGTERM')
        await exited
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    '[A8] borrows a Unix socket process and preserves its second connection',
    async () => {
      const address = join(tmpdir(), `jc-${randomUUID().slice(0, 8)}.sock`)
      const child = spawn(process.execPath, [childPath, address], {
        env: {},
        stdio: ['ignore', 'pipe', 'pipe', 'pipe']
      })
      const exited = once(child, 'close')
      ;(child.stdio[3] as Writable).end(token)
      await once(child.stdout!, 'data')
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      const logs: IIpcLogRecord[] = [],
        reports: unknown[] = [],
        removals: number[] = []
      const open = establish(logs, reports, removals)
      let second: Awaited<ReturnType<typeof createJsonRpcRemoteChannel>> | undefined
      try {
        second = await createJsonRpcRemoteChannel({
          ...bridgeFixture().options,
          byte: await dialProcessByteChannel({ address }),
          scheduler: systemScheduler,
          token
        })
        const plugin = createProcessPlugin({
          name: 'p',
          contract: BRIDGE_CONTRACT,
          registrationOwner: { name: 'p', host },
          host: host.plugin,
          report: (error) => reports.push(error),
          deployment: {
            kind: 'connect',
            address,
            token,
            dial: (path, signal) =>
              dialProcessByteChannel({ address: path, signal: signal as AbortSignal }),
            establish: open,
            /**
             * Connect has no wire selector; this caller explicitly supplies a transport-local
             * check.
             */
            supervision: {
              restart: { maxRestarts: 0 },
              health: {
                check: async () => {
                  if (second!.transport.closed) throw new Error('fixture connection closed')
                }
              }
            }
          },
          endpointFactory: async (channel) => {
            const endpoint = await bridgeEndpoint(channel)
            return { endpoint, oneWay: endpoint }
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
