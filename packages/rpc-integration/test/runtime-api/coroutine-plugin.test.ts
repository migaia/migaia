import { describe, expect, it, vi } from 'vitest'
import { createCoroutinePlugin } from '@migaia/rpc-core/remote'
import { readRuntimeOutletConnection } from '../../../rpc-core/dist/remote/runtime-api/outlet.js'
import { coroutineFailure, coroutineService, coroutineTestHost } from './fixtures/coroutine.js'

describe('coroutine runtime plugin modes', () => {
  it('[A2] constructs only one mode before any Host call', () => {
    expect(() => createCoroutinePlugin({ name: 'neither' } as never)).toThrow(
      expect.objectContaining({ source: '@migaia/rpc/core', code: 'INVALID_CONFIG' })
    )
    expect(() =>
      createCoroutinePlugin({ name: 'both', task: async () => undefined, connect: {} } as never)
    ).toThrow(expect.objectContaining({ source: '@migaia/rpc/core', code: 'INVALID_CONFIG' }))
  })

  it('[A2] publishes managed controls and symmetric calls with one announced and described self', async () => {
    /** Each original diagnostic remains visible for cause classification at closure. */
    const reports: unknown[] = []
    /** Parent and task each install a complete genuine Host. */
    const host = coroutineTestHost()
    /** The service owns provider installation before automatic child connection. */
    const service = coroutineService('first', (error) => reports.push(error))
    /** Parent methods exercise reverse request, notify, stream and cancellation on the same channel. */
    const parentNotices: unknown[] = []
    try {
      await host.use(
        createCoroutinePlugin({
          name: 'c',
          task: service.task,
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
              wait: (_payload: unknown, context: import('@migaia/rpc-core').IRpcContext) =>
                new Promise<void>((_resolve, reject) =>
                  context.signal.addEventListener('abort', () => reject(context.signal.reason), {
                    once: true
                  })
                )
            }
          },
          report: (error) => reports.push(error)
        })
      )
      await service.installed
      expect(await host.coroutine!.request('c', 'service.read', 'ready')).toEqual([
        'first',
        'ready'
      ])
      expect(await host.coroutine!.request('c', 'service.reverse', 'reverse')).toBe('reverse')
      await host.coroutine!.notify('c', 'service.notice', 'forward-notice')
      await vi.waitFor(() => expect(service.notices).toEqual(['forward-notice']))
      /** Stream collection uses the supported target's ordinary async iterator contract. */
      const forwardValues: unknown[] = []
      for await (const value of host.coroutine!.stream('c', 'service.values'))
        forwardValues.push(value)
      expect(forwardValues).toEqual([1, 2, 3])
      /** Child receipt uses the same managed parent identity that the parent describes. */
      const child = service.hosts[0]!
      await child.coroutine!.notify('parent', 'parent.notice', 'reverse-notice')
      await vi.waitFor(() => expect(parentNotices).toEqual(['reverse-notice']))
      /** Reverse values pass through the genuine child connection's stream owner. */
      const reverseValues: unknown[] = []
      for await (const value of child.coroutine!.stream('parent', 'parent.values'))
        reverseValues.push(value)
      expect(reverseValues).toEqual([4, 5])
      /** Runtime describe can succeed only when initial announced ids match the remote directory. */
      const parentConnection = readRuntimeOutletConnection(host.coroutine!, 'c')!
      /** Both peers retain their independently prepared own identity. */
      const childConnection = readRuntimeOutletConnection(child.coroutine!, 'parent')!
      expect(parentConnection.instanceId).toBe(childConnection.peer.self.instanceId)
      expect(childConnection.instanceId).toBe(parentConnection.peer.self.instanceId)
      for (const [outlet, name, method] of [
        [host.coroutine!, 'c', 'service.wait'],
        [child.coroutine!, 'parent', 'parent.wait']
      ] as const) {
        /** Caller abort exercises the ordinary provider cancellation owner in both directions. */
        const controller = new AbortController()
        /** Rejection is observed immediately before the signal is delivered. */
        const waiting = outlet.request(name, method, undefined, { signal: controller.signal })
        void waiting.catch(() => undefined)
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        controller.abort()
        await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
      }
      /** A captured generation has a distinct closed boundary from the current Host outlet. */
      const captured = parentConnection.peer
      await host.coroutine!.stop('c', { graceMs: 50 })
      await expect(async () => host.coroutine!.request('c', 'service.read')).rejects.toMatchObject({
        source: '@migaia/rpc/core',
        code: 'TARGET_UNKNOWN'
      })
      await expect(async () => captured.request('service.read')).rejects.toMatchObject({
        source: '@migaia/rpc/remote',
        code: 'REMOTE_CLOSED'
      })
      expect((await host.coroutine!.restart('c')).state).toBe('ready')
      expect(await host.coroutine!.request('c', 'service.read', 'restarted')).toEqual([
        'first',
        'restarted'
      ])
      await host.coroutine!.kill('c')
    } finally {
      await host.dispose()
      console.info('[coroutine A2 reports]', JSON.stringify(reports.map(coroutineFailure)))
    }
  })

  it('[A2] preserves pre-connect task rejection beneath Host and managed start owners', async () => {
    /** One native task object proves no replacement error is invented by family assembly. */
    const failure = new Error('coroutine rejected before connecting')
    /** Host rollback must leave no coroutine extension or indexed receipt. */
    const host = coroutineTestHost()
    /** Existing terminal diagnostics keep the same task cause chain. */
    const reports: unknown[] = []
    try {
      /** Rejection is captured independently of the task's expected report. */
      let rejected: unknown
      try {
        await host.use(
          createCoroutinePlugin({
            name: 'failed',
            task: async () => {
              throw failure
            },
            supervisor: { restart: { mode: 'never' } },
            report: (error) => reports.push(error)
          })
        )
      } catch (error) {
        rejected = error
      }
      console.info(
        '[coroutine A2 preconnect]',
        JSON.stringify({
          install: coroutineFailure(rejected),
          reports: reports.map(coroutineFailure)
        })
      )
      expect(rejected).toMatchObject({
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED'
      })
      /** The chain follows only existing Host, managed start and supervision owner layers. */
      const chain: unknown[] = []
      for (
        let current = rejected;
        current && typeof current === 'object';
        current = Reflect.get(current, 'cause')
      )
        chain.push(current)
      expect(chain).toContain(failure)
      expect(chain[1]).toMatchObject({ source: '@migaia/rpc/remote' })
      expect(host.coroutine).toBeUndefined()
      console.info(
        '[coroutine A2 preconnect]',
        JSON.stringify({
          install: coroutineFailure(rejected),
          reports: reports.map(coroutineFailure)
        })
      )
    } finally {
      await host.dispose()
    }
  })
})

it.each(['thread', 'process'] as const)(
  '[A2] coroutine exchanges every call mode with a %s native other end',
  async (family) => {
    const { fileURLToPath } = await import('node:url')
    const { defineFeature, definePlugin } = await import('@migaia/plugin-host')
    const { createUnitBudget } = await import('@migaia/supervision')
    const { systemScheduler } = await import('@migaia/utils/scheduler')
    const { createThreadPlugin } = await import('@migaia/rpc-threads')
    const { createNodeThreadLauncher, createNodeThreadChannelFactory } =
      await import('@migaia/rpc-threads/adapters/node')
    const { createProcessPlugin, createProcessTransport } = await import('@migaia/rpc-process')
    const { createNodeProcessLauncher } =
      await import('@migaia/rpc-process/adapters/node-child-process')
    /** Native receipt counters independently prove notify delivery and provider cancellation. */
    type INativeStats = { notices: unknown[]; waiting: number; cancelled: number }
    /** The existing child fixture uses real native bootstrap and committed public outlets. */
    const entry = fileURLToPath(new URL('./fixtures/plugin-probe-child.ts', import.meta.url))
    /** Every diagnostic keeps its original semantic classification for final evidence. */
    const reports: unknown[] = []
    /** One real parent Host owns the native bridge and the coroutine unit. */
    const host = coroutineTestHost()
    /** The coroutine's provider is installed before its connected runtime plugin. */
    const service = coroutineService(`coroutine-${family}`, (error) => reports.push(error))
    /** Native readiness proves that its own Host installation has committed. */
    let nativeReady = false
    /** These original request signals prove reverse cancellation reaches the forwarding provider. */
    const reverseReasons: unknown[] = []
    /** Native callers must enter each reverse provider once rather than return fixture-only data. */
    const reverseCalls = { request: 0, notify: 0, stream: 0, cancel: 0 }
    /** Actual Worker handles remain available for native cleanup after Host disposal. */
    const threads: Awaited<ReturnType<ReturnType<typeof createNodeThreadLauncher>['launch']>>[] = []
    /** Actual child-process handles independently expose completion of native cleanup. */
    const processes: Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>[] =
      []
    try {
      await host.use(
        definePlugin({
          name: 'parent',
          features: {
            methods: defineFeature(() => ({
              /** Native requests continue through the genuine coroutine channel to its provider. */
              read: (payload: unknown) => {
                reverseCalls.request += 1
                return host.coroutine!.request('c', 'service.read', payload)
              },
              /** Native notify delivery is independently observed at the coroutine provider. */
              notice: (payload: unknown) => {
                reverseCalls.notify += 1
                return host.coroutine!.notify('c', 'service.notice', payload)
              },
              /** Coroutine iterator order survives the native caller's reverse stream. */
              async *values() {
                reverseCalls.stream += 1
                for await (const value of host.coroutine!.stream('c', 'service.values')) yield value
              },
              /** The native caller's canonical signal is forwarded unchanged into coroutine RPC. */
              wait: (payload: unknown, context: import('@migaia/rpc-core').IRpcContext) => {
                reverseCalls.cancel += 1
                context.signal.addEventListener(
                  'abort',
                  () => reverseReasons.push(context.signal.reason),
                  { once: true }
                )
                return host.coroutine!.request('c', 'service.wait', payload, {
                  signal: context.signal
                })
              },
              /** Native fixture completion is distinct from launch and transport readiness. */
              ready: () => {
                nativeReady = true
              }
            }))
          },
          install: () => ({})
        })
      )
      if (family === 'thread') {
        /** The original native launcher remains the only Worker construction owner. */
        const launcher = createNodeThreadLauncher()
        await host.use(
          createThreadPlugin({
            name: 'native',
            expose: ['parent'],
            report: (error) => reports.push(error),
            spawn: {
              spec: { entry, name: 'a2-coroutine-native-thread' },
              budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
              scheduler: systemScheduler,
              launcher: {
                ...launcher,
                launch: async (...args: Parameters<typeof launcher.launch>) => {
                  /** Capture the actual Worker receipt, never a synthetic cleanup handle. */
                  const handle = await launcher.launch(...args)
                  threads.push(handle)
                  return handle
                }
              },
              channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
              report: (error) => reports.push(error)
            }
          })
        )
      } else {
        /** Process bootstrap and byte handshake reuse the existing public deployment contract. */
        const launcher = createNodeProcessLauncher()
        /** Raw channel and remote identity belong to this precise native launch. */
        let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
        /** Fixture authentication travels only through native bootstrap and handshake. */
        const token = 'a2-coroutine-native-process'
        /** This native deployment owns execution separately from the coroutine unit. */
        const spawn: import('../../../rpc-process/dist/process/plugin/types.js').ISpawnProcessPluginDeployment =
          {
            kind: 'spawn',
            channelKind: 'byte',
            wire: 'native',
            token,
            supervision: {
              id: 'a2-coroutine-native-process',
              spec: {
                command: process.execPath,
                args: [entry],
                env: { inherit: ['PATH'], set: {} },
                stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
                bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
              },
              budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
              isolation: 'best-effort',
              report: (error) => reports.push(error),
              launcher: {
                ...launcher,
                launch: async (spec, context) => {
                  handle = await launcher.launch(spec, context)
                  processes.push(handle)
                  return handle
                }
              }
            },
            rawChannel: async () => handle!.channel!,
            establish: async (raw, prepared) =>
              createProcessTransport(raw as NonNullable<typeof handle>['channel'] & object, {
                role: 'initiator',
                offer: prepared.offer!,
                peerId: handle!.runtimeApiIdentity!.instanceId,
                scheduler: prepared.scheduler,
                ipc: { ...prepared.session, log: () => undefined },
                report: (error) => reports.push(error)
              })
          }
        await host.use(
          createProcessPlugin({
            name: 'native',
            expose: ['parent'],
            spawn,
            report: (error) => reports.push(error)
          })
        )
      }
      await vi.waitFor(() => expect(nativeReady).toBe(true))
      await host.use(
        createCoroutinePlugin({
          name: 'c',
          task: service.task,
          expose: ['native'],
          report: (error) => reports.push(error)
        })
      )
      await service.installed
      /** Coroutine requests use the exposed native catalog and execute at the native provider. */
      const child = service.hosts[0]!
      expect(await child.coroutine!.request('parent', 'native.service.read', 'forward')).toBe(
        'forward'
      )
      await child.coroutine!.notify('parent', 'native.service.notice', 'forward-notice')
      await vi.waitFor(async () => {
        /** Native stats are queried over the same coroutine-to-native forwarding path. */
        const stats = (await child.coroutine!.request(
          'parent',
          'native.service.stats'
        )) as INativeStats
        expect(stats.notices).toEqual(['forward-notice'])
      })
      /** Every native stream item reaches the coroutine caller in provider order. */
      const forwardValues: unknown[] = []
      for await (const value of child.coroutine!.stream('parent', 'native.service.values'))
        forwardValues.push(value)
      expect(forwardValues).toEqual([1, 2, 3])
      /** Cancellation starts only after the native provider independently reports entry. */
      const forwardController = new AbortController()
      /** Observe the original caller rejection immediately, before delivering abort. */
      const forwardRejection = child
        .coroutine!.request('parent', 'native.service.wait', undefined, {
          signal: forwardController.signal
        })
        .catch((error: unknown) => error)
      await vi.waitFor(async () => {
        /** Waiting is native provider state, not caller in-flight state. */
        const stats = (await child.coroutine!.request(
          'parent',
          'native.service.stats'
        )) as INativeStats
        expect([stats.waiting, stats.cancelled]).toEqual([1, 0])
      })
      forwardController.abort()
      /** The ordinary call error keeps the registered cancellation source and code. */
      const forwardError = await forwardRejection
      expect(forwardError).toMatchObject({ source: '@migaia/rpc/core', code: 'CANCELLED' })
      await vi.waitFor(async () => {
        /** Native abort receipt proves cancellation crossed both real channel boundaries. */
        const stats = (await child.coroutine!.request(
          'parent',
          'native.service.stats'
        )) as INativeStats
        expect([stats.waiting, stats.cancelled]).toEqual([1, 1])
      })
      /** Native reverse methods now call through the parent into the actual coroutine unit. */
      const native = host[family]!
      expect(await native.request('native', 'service.reverse', 'reverse')).toEqual([
        `coroutine-${family}`,
        'reverse'
      ])
      await native.request('native', 'service.reverseNotice', 'reverse-notice')
      await vi.waitFor(() => expect(service.notices).toEqual(['reverse-notice']))
      /** Reverse stream completion is checked separately from forward stream completion. */
      const reverseValues: unknown[] = []
      for await (const value of native.stream('native', 'service.reverseValues'))
        reverseValues.push(value)
      expect(reverseValues).toEqual([1, 2, 3])
      /** The native reverse caller propagates its canonical provider signal into coroutine RPC. */
      const reverseController = new AbortController()
      /** Capture the original outer rejection without an unobserved late rejection. */
      const reverseRejection = native
        .request('native', 'service.reverseWait', undefined, { signal: reverseController.signal })
        .catch((error: unknown) => error)
      await vi.waitFor(() => expect(service.cancellation).toEqual({ waiting: 1, cancelled: 0 }))
      reverseController.abort()
      /** The native caller's cancellation has the same canonical public failure identity. */
      const reverseError = await reverseRejection
      expect(reverseError).toMatchObject({ source: '@migaia/rpc/core', code: 'CANCELLED' })
      await vi.waitFor(() => expect(service.cancellation).toEqual({ waiting: 1, cancelled: 1 }))
      expect(reverseCalls).toEqual({ request: 1, notify: 1, stream: 1, cancel: 1 })
      expect(reverseReasons).toHaveLength(1)
      expect(reverseReasons[0]).toMatchObject({ source: '@migaia/rpc/core', code: 'CANCELLED' })
      /** Full cancellation evidence is distinct from expected background cleanup diagnostics. */
      console.info(
        '[coroutine A2 native cancellation]',
        JSON.stringify({
          family,
          forward: coroutineFailure(forwardError),
          reverse: coroutineFailure(reverseError),
          providerReason: coroutineFailure(reverseReasons[0]),
          coroutine: service.cancellation
        })
      )
    } finally {
      await host.dispose()
      for (const handle of threads) handle.terminate()
      for (const handle of processes) handle.terminate('force')
      await Promise.all([
        ...threads.map((handle) => handle.exited),
        ...processes.map((handle) => handle.exited)
      ])
      console.info(
        '[coroutine A2 native reports]',
        JSON.stringify({ family, reports: reports.map(coroutineFailure) })
      )
    }
  },
  15000
)
