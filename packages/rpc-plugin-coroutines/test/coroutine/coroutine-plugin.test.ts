import { expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  createRpcHost,
  type IRpcHost,
  type IRpcContext,
  type IRpcNamespace
} from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { processPlugin, type ISpawnProcessPluginDeployment } from '@migaia/rpc-plugin-process'
import { createUnitBudget } from '@migaia/supervision'
import { serializeErrorChain } from '@migaia/utils'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/node-launcher.js'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { runtimeService, values } from './fixture.js'

/** The same original business matrix runs over each actual native execution family. */
type INativeFamily = 'thread' | 'process'
/** Provider entry and cancellation are independently observed at the real native child. */
type INativeStats = { notices: unknown[]; waiting: number; cancelled: number }
/** Native Node executes this owning TypeScript fixture without a loader or protocol model. */
const entry = fileURLToPath(new URL('./fixtures/native-child.ts', import.meta.url))

/** Preserve complete error classification through the existing bounded diagnostic serializer. */
function coroutineFailure(error: unknown) {
  return serializeErrorChain(error, {
    fields: ['name', 'source', 'code', 'reason', 'message', 'stack']
  })
}

/** One case owns original provider counters, genuine native receipts and both actual namespaces. */
class NativeCoroutineCase {
  /** The selected actual native family determines only acquisition and namespace selection. */
  readonly #family: INativeFamily
  /** Every native or coroutine diagnostic remains observable through final cleanup. */
  readonly #reports: unknown[] = []
  /** The existing fixture owns the actual coroutine task, child Host and cancellation counters. */
  readonly #service
  /** Parent calls reach this real Host only after its native installations have committed. */
  #host: IRpcHost | undefined
  /** Readiness is a reverse business call, independent from launch and handshake completion. */
  #nativeReady = false
  /** These reasons come only from actual canonical provider abort signals. */
  readonly #reverseReasons: unknown[] = []
  /** Every reverse mode must enter its genuine parent provider once. */
  readonly #reverseCalls = { request: 0, notify: 0, stream: 0, cancel: 0 }
  /** Actual Worker receipts remain available for force cleanup and exit joining. */
  readonly #threads: Awaited<ReturnType<ReturnType<typeof createNodeThreadLauncher>['launch']>>[] =
    []
  /** Actual child-process receipts independently prove native cleanup completion. */
  readonly #processes: INodeProcessHandle[] = []

  /** Allocate only case observations; native acquisition begins in the public Host installation. */
  constructor(family: INativeFamily) {
    this.#family = family
    this.#service = runtimeService(`coroutine-${family}`, this.#report)
  }
  /** Retain original diagnostics without replacing their errors or suppressing native failures. */
  readonly #report = (error: unknown): void => {
    this.#reports.push(error)
  }
  /** Native requests continue through the genuine coroutine namespace to its provider. */
  readonly #read = (payload: unknown) => {
    this.#reverseCalls.request += 1
    return this.#host!.coroutine.send(
      this.#service.children[0]!.self.instanceId,
      'service.read',
      payload as never
    )
  }
  /** Notify retains physical completion while its actual destination separately records delivery. */
  readonly #notice = (payload: unknown) => {
    this.#reverseCalls.notify += 1
    return this.#host!.coroutine.notify('service.notice', payload as never, {
      targetId: this.#service.children[0]!.self.instanceId
    })
  }
  /** This namespace has one actual coroutine member, preserving the original stream selection. */
  readonly #values = () => {
    this.#reverseCalls.stream += 1
    return this.#host!.coroutine.stream('service.values') as AsyncIterableIterator<unknown>
  }
  /** The incoming native provider signal is forwarded unchanged into the coroutine request. */
  readonly #wait = (payload: unknown, context: IRpcContext) => {
    this.#reverseCalls.cancel += 1
    context.signal.addEventListener(
      'abort',
      () => this.#reverseReasons.push(context.signal.reason),
      {
        once: true
      }
    )
    return this.#host!.coroutine.send(
      this.#service.children[0]!.self.instanceId,
      'service.wait',
      payload as never,
      {
        signal: context.signal
      }
    )
  }
  /** Preserve full native launch recipes and capture original receipts instead of synthetic handles. */
  #nativePlugin() {
    if (this.#family === 'thread') {
      /** The original launcher is still the sole actual Worker construction owner. */
      const launcher = createNodeThreadLauncher()
      return threadPlugin({
        name: 'native',
        expose: ['parent'],
        report: this.#report,
        spawn: {
          spec: { entry, name: 'coroutine-native-thread' },
          budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (...args: Parameters<typeof launcher.launch>) => {
              /** The exact actual Worker receipt survives until final cleanup. */
              const handle = await launcher.launch(...args)
              this.#threads.push(handle)
              return handle
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          report: this.#report
        }
      })
    }
    /** Native bootstrap keeps the original private token and stdio-backed deployment. */
    const launcher = createNodeProcessLauncher()
    /** The credential stays in actual native bootstrap, never in trusted identity facts. */
    const token = 'coroutine-native-process'
    /** The existing full source borrows the original launch handle's exact raw channel. */
    const spawn: ISpawnProcessPluginDeployment = {
      kind: 'spawn',
      channelKind: 'byte',
      token,
      supervision: {
        id: 'coroutine-native-process',
        spec: {
          command: process.execPath,
          args: [entry],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
        },
        budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
        isolation: 'best-effort',
        report: this.#report,
        launcher: {
          ...launcher,
          launch: async (spec, context) => {
            /** Capture the actual child and leave construction, budget and exit with its launcher. */
            const handle = await launcher.launch(spec, context)
            this.#processes.push(handle)
            return handle
          }
        }
      },
      rawChannel: async (handle) => (handle as INodeProcessHandle).channel!
    }
    return processPlugin({ name: 'native', expose: ['parent'], spawn, report: this.#report })
  }
  /** Original forward request, notify, ordered stream and cancellation cross both real boundaries. */
  async #forward(child: IRpcHost): Promise<unknown> {
    expect(await child.coroutine.send('parent', 'native.service.read', 'forward')).toBe('forward')
    await child.coroutine.notify('native.service.notice', 'forward-notice', { targetId: 'parent' })
    await vi.waitFor(async () => {
      /** Native provider state independently proves actual notify delivery. */
      const stats = (await child.coroutine.send('parent', 'native.service.stats')) as INativeStats
      expect(stats.notices).toEqual(['forward-notice'])
    })
    expect(await values(child.coroutine.stream('native.service.values'))).toEqual([1, 2, 3])
    /** Cancellation begins only after the native provider independently confirms entry. */
    const controller = new AbortController()
    /** Observe rejection before delivering the original caller abort. */
    const rejection = child.coroutine
      .send('parent', 'native.service.wait', undefined, { signal: controller.signal })
      .catch((error: unknown) => error)
    await vi.waitFor(async () => {
      /** Waiting is cumulative native provider entry, never caller in-flight state. */
      const stats = (await child.coroutine.send('parent', 'native.service.stats')) as INativeStats
      expect([stats.waiting, stats.cancelled]).toEqual([1, 0])
    })
    controller.abort()
    /** Preserve registered cancellation identity at the ordinary outer caller. */
    const error = await rejection
    expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
    await vi.waitFor(async () => {
      /** The native abort receipt proves both real channel boundaries were crossed. */
      const stats = (await child.coroutine.send('parent', 'native.service.stats')) as INativeStats
      expect([stats.waiting, stats.cancelled]).toEqual([1, 1])
    })
    return error
  }
  /** Original reverse modes execute actual parent forwarding providers and coroutine business. */
  async #reverse(native: IRpcNamespace): Promise<unknown> {
    expect(await native.send('native', 'service.reverse', 'reverse')).toEqual([
      `coroutine-${this.#family}`,
      'reverse'
    ])
    await native.send('native', 'service.reverseNotice', 'reverse-notice')
    await vi.waitFor(() => expect(this.#service.notices).toEqual(['reverse-notice']))
    expect(await values(native.stream('service.reverseValues'))).toEqual([1, 2, 3])
    /** The actual native caller's abort must traverse the reverse forwarding request. */
    const controller = new AbortController()
    /** Attach rejection handling before abort to retain the original public error. */
    const rejection = native
      .send('native', 'service.reverseWait', undefined, { signal: controller.signal })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(this.#service.cancellation).toEqual({ entered: 1, cancelled: 0 }))
    controller.abort()
    /** The old fixture's waiting count is this same cumulative entered count in its canonical owner. */
    const error = await rejection
    expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
    await vi.waitFor(() => expect(this.#service.cancellation).toEqual({ entered: 1, cancelled: 1 }))
    expect(this.#reverseCalls).toEqual({ request: 1, notify: 1, stream: 1, cancel: 1 })
    expect(this.#reverseReasons).toHaveLength(1)
    expect(this.#reverseReasons[0]).toMatchObject({
      name: controller.signal.reason.name,
      message: controller.signal.reason.message,
      source: 'unknown',
      code: 'UNKNOWN'
    })
    return error
  }
  /** Install native first, then coroutine, and exercise the unchanged cross-family business matrix. */
  async run(): Promise<void> {
    try {
      this.#host = await createRpcHost({
        self: { name: 'parent', instanceId: `coroutine-native-parent-${this.#family}` },
        report: this.#report,
        plugins: [
          this.#nativePlugin(),
          coroutinePlugin({
            name: 'c',
            spawn: this.#service.task,
            expose: ['native'],
            report: this.#report
          })
        ],
        provide: {
          parent: {
            read: this.#read,
            notice: this.#notice,
            values: this.#values,
            wait: this.#wait,
            ready: () => {
              this.#nativeReady = true
            }
          }
        }
      })
      await vi.waitFor(() => expect(this.#nativeReady).toBe(true))
      await this.#service.installed
      /** This exact coroutine child owns its actual accepted parent Session. */
      const child = this.#service.children[0]!
      /** Both outer errors retain their distinct original channel paths for final evidence. */
      const forwardError = await this.#forward(child)
      /** Native selection borrows the one real namespace installed for this family. */
      const reverseError = await this.#reverse(this.#host[this.#family])
      console.info(
        '[coroutine native cancellation]',
        JSON.stringify({
          family: this.#family,
          forward: coroutineFailure(forwardError),
          reverse: coroutineFailure(reverseError),
          providerReason: coroutineFailure(this.#reverseReasons[0]),
          coroutine: this.#service.cancellation
        })
      )
    } finally {
      await this.#host?.close()
      for (const handle of this.#threads) handle.terminate()
      for (const handle of this.#processes) handle.terminate('force')
      await Promise.all([
        ...this.#threads.map((handle) => handle.exited),
        ...this.#processes.map((handle) => handle.exited)
      ])
      console.info(
        '[coroutine native reports]',
        JSON.stringify({
          family: this.#family,
          reports: this.#reports.map(coroutineFailure)
        })
      )
    }
  }
}

it.each(['thread', 'process'] as const)(
  'coroutine exchanges every call mode with a %s native other end',
  async (family) => new NativeCoroutineCase(family).run(),
  15000
)
