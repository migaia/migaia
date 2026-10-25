import { describe, expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { ordinaryHost, outlet, runtimeService, values } from './fixture.js'

describe('coroutine runtime plugin modes', () => {
  it('rejects invalid coroutine source and forged parent token with COROUTINE_SOURCE_INVALID', () => {
    for (const options of [
      { name: 'neither' },
      { name: 'both', spawn: async () => undefined, connectToParent: {} },
      { name: 'forged', connectToParent: {} }
    ]) {
      /** Admission must preserve its original native TypeError and exact package identity. */
      let failure: unknown
      try {
        coroutinePlugin(options as never)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(TypeError)
      expect(failure).toMatchObject({
        source: 'rpc.transport.coroutine',
        code: 'COROUTINE_SOURCE_INVALID'
      })
    }
  })
  it('publishes managed controls and symmetric calls with one announced and described self', async () => {
    /** Diagnostics remain observable while both actual Hosts close. */
    const reports: unknown[] = []
    /** The existing owner retains original runtime payloads and genuine native task tokens. */
    const service = runtimeService('first', (error) => reports.push(error))
    /** Reverse notification delivery is observed independently from the sender's write. */
    const parentNotices: unknown[] = []
    /** Global Host identity/provider publication replaces retired transport-owned configuration. */
    const host = await createRpcHost({
      self: { name: 'parent', instanceId: 'coroutine-runtime-parent' },
      report: (error) => reports.push(error),
      plugins: [coroutinePlugin({ name: 'c', spawn: service.task })],
      provide: {
        parent: {
          read: (payload: unknown) => payload,
          notice: (payload: unknown) => {
            parentNotices.push(payload)
          },
          *values() {
            yield 4
            yield 5
          },
          wait: (_payload: unknown, context: IRpcContext) =>
            new Promise<void>((_resolve, reject) =>
              context.signal.addEventListener('abort', () => reject(context.signal.reason), {
                once: true
              })
            )
        }
      }
    })
    try {
      await service.installed
      expect(await host.coroutine.request('service.read', 'ready')).toEqual(['first', 'ready'])
      expect(await host.coroutine.request('service.reverse', 'reverse')).toBe('reverse')
      await host.coroutine.notify('service.notice', 'forward-notice')
      await vi.waitFor(() => expect(service.notices).toEqual(['forward-notice']))
      expect(await values(host.coroutine.stream('service.values'))).toEqual([1, 2, 3])
      /** This exact child retains its independently prepared global identity. */
      const child = service.children[0]!
      await child.coroutine.notify('parent.notice', 'reverse-notice')
      await vi.waitFor(() => expect(parentNotices).toEqual(['reverse-notice']))
      expect(await values(child.coroutine.stream('parent.values'))).toEqual([4, 5])
      /** Safe native queries read the same actual directories that admitted both channel ends. */
      const parentConnection = await host.coroutine.members.get('c')
      const childConnection = await outlet(child).members.get('coroutine')
      expect(parentConnection.identity).toMatchObject({ instanceId: child.self.instanceId })
      expect(childConnection.identity).toMatchObject({ instanceId: host.self.instanceId })
      for (const [namespace, method] of [
        [host.coroutine, 'service.wait'],
        [child.coroutine, 'parent.wait']
      ] as const) {
        /** The same canonical signal cancellation crosses each real direction. */
        const controller = new AbortController()
        const waiting = namespace.request(method, undefined, { signal: controller.signal })
        void waiting.catch(() => undefined)
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        controller.abort()
        await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
      }
      /** The new held capability preserves the exact accepted generation without a retired Peer. */
      const captured = Reflect.get(
        Reflect.get(host.coroutine.peers[child.self.name]!, 'service'),
        'read'
      )
      await host.coroutine.members.stop('c', { graceMs: 50 })
      await expect(async () =>
        host.coroutine.send(child.self.instanceId, 'service.read')
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'TARGET_UNKNOWN' })
      await expect(async () => captured()).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'TARGET_UNKNOWN'
      })
      /** A ready observer starts business work synchronously before restart resumes its caller. */
      const immediateCalls: Promise<{ value: unknown } | { error: unknown }>[] = []
      const immediatePayload = 'ready-immediate'
      const removeReady = host.coroutine.members.on('ready', (event) => {
        if (event.name !== 'c') return
        immediateCalls.push(
          host.coroutine.request('service.read', immediatePayload).then(
            (value) => ({ value }),
            (error) => ({ error })
          )
        )
      })
      try {
        expect((await host.coroutine.members.restart('c')).state).toBe('ready')
        expect(immediateCalls).toHaveLength(1)
        expect(await Promise.all(immediateCalls)).toEqual([{ value: ['first', immediatePayload] }])
      } finally {
        removeReady()
      }
      expect(await host.coroutine.request('service.read', 'restarted')).toEqual([
        'first',
        'restarted'
      ])
      await host.coroutine.members.kill('c')
    } finally {
      await host.close()
    }
  })
  it('preserves pre-connect task rejection beneath Host and managed start owners', async () => {
    /** The raw same-realm failure must remain reachable through actual construction rollback. */
    const failure = new Error('coroutine rejected before connecting')
    const host = ordinaryHost()
    const reports: unknown[] = []
    try {
      /** Observe the real Host installation failure separately from terminal diagnostics. */
      let rejected: unknown
      try {
        await host.use(
          coroutinePlugin({
            name: 'failed',
            spawn: async () => {
              throw failure
            },
            supervisor: { restart: { mode: 'never' } },
            report: (error) => reports.push(error)
          })
        )
      } catch (error) {
        rejected = error
      }
      expect(rejected).toMatchObject({ source: 'plugin.host', code: 'PLUGIN_INSTALL_FAILED' })
      /** Original owner order remains explicit, without reconstructing any native exception. */
      const chain: unknown[] = []
      for (
        let current = rejected;
        current && typeof current === 'object';
        current = Reflect.get(current, 'cause')
      )
        chain.push(current)
      expect(chain).toContain(failure)
      expect(chain[1]).toMatchObject({ source: 'rpc.remote' })
      expect(Reflect.get(host, 'coroutine')).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })
})
