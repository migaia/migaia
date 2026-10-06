import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createProcessPeer } from '../../src/process/peer.js'
import type { IRuntimeProcessPeerOptions } from '../../src/process/runtime-peer.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { BRIDGE_CONTRACT } from './fixture.js'
import {
  childPath,
  token,
  fdLauncher,
  establish,
  type IFixtureHandle
} from './fixtures/jsonrpc-process.js'

/** Actual decoded writes prove release preserves the JSON-RPC profile on the physical carrier. */
type IWireEvent = { method: string; params?: { method?: string; args?: unknown[] } }

describe('JSON-RPC process Host ownership', () => {
  it('[I17 A1/M2] runs Host controls through bridge and closes bytes before owned exit without a close frame', async () => {
    /**
     * The caller supplies a real dedicated-fd launcher, distinct from the built-in unsupported fd
     * adapter.
     */
    const launcher = fdLauncher()
    /** Retained handles expose actual process exit rather than facade-only cleanup. */
    const handles: IFixtureHandle[] = []
    /** Wire snapshots include release so a forbidden native close cannot hide after the last call. */
    const writes: IWireEvent[] = []
    /** Resource events assert transport cleanup precedes process termination. */
    const order: string[] = []
    /** Reports retain their original identities for failure diagnosis. */
    const reports: unknown[] = []
    /** Public Peer construction reuses the actual source, bridge handshake and native lifecycle. */
    const options: IRuntimeProcessPeerOptions = {
      self: { name: 'caller', instanceId: 'caller' },
      report: (error) => reports.push(error),
      spawn: {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'jsonrpc',
        token,
        supervision: {
          id: 'bridge-host',
          scheduler: systemScheduler,
          spec: {
            command: process.execPath,
            args: [childPath, '--host'],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'fd', fd: 3, payload: new TextEncoder().encode(token) }
          },
          launcher: {
            capabilities: launcher.capabilities,
            async launch(spec, context) {
              /** Observe only carrier ownership; all launch behavior remains the real fd fixture. */
              const handle = await launcher.launch(spec, context)
              /** One physical handle owns both the byte stream and terminate operation. */
              const observed = {
                ...handle,
                channel: {
                  ...handle.channel,
                  write(chunk: Uint8Array) {
                    writes.push(
                      JSON.parse(Buffer.from(chunk).toString().split('\r\n\r\n')[1]!) as IWireEvent
                    )
                    return handle.channel.write(chunk)
                  },
                  close() {
                    order.push('byte.close')
                    return handle.channel.close()
                  }
                },
                terminate(mode: Parameters<typeof handle.terminate>[0]) {
                  order.push('process.terminate')
                  return handle.terminate(mode)
                }
              }
              handles.push(observed)
              return observed
            }
          },
          budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
          isolation: 'best-effort',
          restart: { maxRestarts: 0 },
          report: (error) => reports.push(error)
        },
        rawChannel: async (handle) => (handle as IFixtureHandle).channel,
        establish: establish([], reports, [], [], { kind: 'host', catalog: { p: BRIDGE_CONTRACT } })
      }
    }
    expect(handles).toHaveLength(0)
    const host = await createProcessPeer<IRuntimeDynamicSurface>(options)
    try {
      expect((await host.describe()).connections[0]).toMatchObject({
        unit: { state: 'ready' },
        connection: { status: 'ready' },
        health: { status: 'unavailable' }
      })
      expect(await host.request(RemoteMethodName.hostInspect, [])).toMatchObject({ plugins: [] })
      /** Public proxy requests follow actual describe/use negotiation with the handwritten peer. */
      await host.request(RemoteMethodName.hostUse, ['p', { mode: 'configuration' }])
      expect(await host.request('p.f.request', ['host-business'])).toMatchObject({
        args: ['host-business'],
        first: 67
      })
      expect(await host.request(RemoteMethodName.hostInspect, [])).toMatchObject({
        plugins: [{ name: 'p', state: 'enabled', features: ['f'] }]
      })
      expect(await host.request(RemoteMethodName.hostUnUse, ['p'])).toEqual({ ok: true })
      expect(await host.request(RemoteMethodName.hostInspect, [])).toMatchObject({ plugins: [] })
      await host.close()
      await handles[0]!.exited
      expect(order.indexOf('byte.close')).toBeLessThan(order.indexOf('process.terminate'))
      expect(writes.map((event) => event.method)).not.toContain('migaia.remote.close')
      expect(writes.map((event) => event.method)).not.toContain('migaia.close')
      expect(
        writes
          .filter((event) => event.method === 'migaia.invoke')
          .map((event) => event.params!.method)
      ).toEqual([
        'migaia.remote.host.inspect',
        'migaia.remote.host.use',
        'p.f.request',
        'migaia.remote.host.inspect',
        'migaia.remote.host.unUse',
        'migaia.remote.host.inspect'
      ])
      expect(
        writes.every((event) =>
          ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel'].includes(
            event.method
          )
        )
      ).toBe(true)
      expect(handles[0]!.child.exitCode !== null || handles[0]!.child.signalCode !== null).toBe(
        true
      )
    } finally {
      await host.close()
    }
  })
})
