import { describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { setTimeout as delay } from 'node:timers/promises'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'
import { createEventTargetMessageResource } from '../../dist/runtime-adapter/message/resource.js'
import { prepareRuntimePeerSourceContext } from '../../dist/remote/runtime-api/peer.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { ICoroutineMessagePort } from '../../dist/remote/runtime-api/coroutine-task.js'

describe('coroutine runtime binding', () => {
  it('[A1] child recipe starts the genuine task port through EventTarget after capture', async () => {
    /** The family wrapper supplies a genuine opaque token; no physical port is hand-passed. */
    const { wrapCoroutineTask, portOf } =
      await import('../../dist/remote/runtime-api/coroutine-task.js')
    /** The child must reach the adapter definition's canonical peer constructor. */
    const { getCoroutineMessageAdapter, startOnListen } =
      await import('../../dist/remote/runtime-api/coroutine-binding.js')
    /** Task lifetime stays open while two real Peers complete their handshake. */
    const finish = deferred<void>()
    /** Parent port publication comes from the supervisor's existing task context operation. */
    const exposed = deferred<ICoroutineMessagePort>()
    /** The original task context supplies the sole opaque child connection. */
    const connected =
      deferred<import('../../dist/remote/runtime-api/coroutine-task.js').ICoroutineConnect>()
    /** Contained diagnostics remain visible during physical cleanup. */
    const reports: unknown[] = []
    /** Cooperative cancellation belongs to the task context, not the transport facade. */
    const controller = new AbortController()
    /** The wrapper owns both native ports until this user task settles. */
    const running = Promise.resolve(
      wrapCoroutineTask(
        async ({ connect }) => {
          connected.resolve(connect)
          await finish.promise
        },
        (error) => reports.push(error)
      )({
        signal: controller.signal,
        expose: (port) => exposed.resolve(port),
        heartbeat: () => undefined
      })
    )
    /** The actual native child port has both listener APIs, so a wrong branch is observable. */
    const connect = await connected.promise
    /** Node's native carrier can be inspected without changing the public opaque connection type. */
    const native = portOf(connect) as unknown as import('node:worker_threads').MessagePort
    /** Capture must attach through EventTarget before native start. */
    const attached = vi.spyOn(native, 'addEventListener')
    /** EventEmitter invocation would violate the family's single message recipe. */
    const emitter = vi.spyOn(native, 'on')
    /** The real native start still executes after asserting listener ordering. */
    const originalStart = native.start
    /** Start count proves one activation even when resource preparation adds more listeners. */
    const start = vi.spyOn(native, 'start').mockImplementation(() => {
      expect(attached.mock.calls.some(([name]) => name === 'message')).toBe(true)
      Reflect.apply(originalStart, native, [])
    })
    /** The parent uses the same existing resource handshake, without a second identity protocol. */
    const resource = createEventTargetMessageResource(startOnListen(await exposed.promise))
    /** Actual peer lifetimes close before task physical ownership settles. */
    let peers: Awaited<ReturnType<typeof createRuntimePeer>>[] = []
    try {
      peers = await Promise.all([
        createRuntimePeer({
          self: { name: 'parent', instanceId: 'child-recipe-parent' },
          provide: {},
          report: (error) => reports.push(error),
          connect: async (context) =>
            resource.open({
              peerId: await resource.exchangeIdentity(context),
              scheduler: systemScheduler,
              offer: context.capabilities,
              control: rpcMessageCapabilityControl
            })
        }),
        getCoroutineMessageAdapter().peer({
          connect,
          provide: { read: (value: unknown) => value },
          report: (error) => reports.push(error)
        })
      ])
      expect(await peers[0]!.request('read', 'child-recipe')).toBe('child-recipe')
      expect(emitter).not.toHaveBeenCalled()
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      await resource.close()
      finish.resolve()
      await running
      vi.restoreAllMocks()
    }
  })
  it('[A1] uses only EventTarget listeners and starts once after the first message listener', async () => {
    /** The native Node port supplies both branches, making facade selection observable. */
    const native = new MessageChannel()
    /** The new module is loaded inside the case so old main produces a genuine missing-owner red. */
    const { startOnListen } = await import('../../dist/remote/runtime-api/coroutine-binding.js')
    /** Native spies establish ordering without inventing a transport or receiver. */
    const attached = vi.spyOn(native.port1, 'addEventListener')
    /** Selecting EventEmitter would invoke this existing native operation. */
    const emitter = vi.spyOn(native.port1, 'on')
    /** A started port must have its capture listener before queued frames become deliverable. */
    const start = vi.spyOn(native.port1, 'start').mockImplementation(() => {
      expect(attached.mock.calls.some(([name]) => name === 'message')).toBe(true)
    })
    try {
      /** EventTarget-only shape forces the adapter's canonical branch. */
      const facade = startOnListen(native.port1 as unknown as MessagePort)
      expect(Object.isFrozen(facade)).toBe(true)
      expect('on' in facade).toBe(false)
      expect('off' in facade).toBe(false)
      facade.addEventListener('close', () => undefined)
      expect(start).not.toHaveBeenCalled()
      facade.addEventListener('message', () => undefined)
      facade.addEventListener('message', () => undefined)
      expect(start).toHaveBeenCalledTimes(1)
      expect(emitter).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      native.port1.close()
      native.port2.close()
    }
  })

  it('[A1] exchanges independently prepared identities without changing either self', async () => {
    /** Each real channel uses the resource's existing cold identity and ACK owners. */
    const { startOnListen } = await import('../../dist/remote/runtime-api/coroutine-binding.js')
    for (let index = 0; index < 2; index += 1) {
      /** Independent unit channels cannot share an address or capture receipt. */
      const native = new MessageChannel()
      /** Each preparation freezes its own canonical identity before communication. */
      const left = prepareRuntimePeerSourceContext(
        { name: 'parent', instanceId: `p-${index}` },
        true
      )
      /** The child independently owns its address; no supervisor fingerprint is supplied. */
      const right = prepareRuntimePeerSourceContext(
        { name: 'child', instanceId: `c-${index}` },
        true
      )
      /** Both held resources attach their actual capture listener through the facade. */
      const resources = [native.port1, native.port2].map((port) =>
        createEventTargetMessageResource(startOnListen(port as unknown as MessagePort))
      )
      try {
        expect(
          await Promise.all([
            resources[0]!.exchangeIdentity(left),
            resources[1]!.exchangeIdentity(right)
          ])
        ).toEqual([right.self.instanceId, left.self.instanceId])
        expect(left.self).toEqual({ name: 'parent', instanceId: `p-${index}` })
        expect(right.self).toEqual({ name: 'child', instanceId: `c-${index}` })
      } finally {
        await Promise.all(resources.map((resource) => resource.close()))
        native.port1.close()
        native.port2.close()
      }
    }
  })

  it.each(['resolve', 'reject'] as const)(
    '[A1] raw task %s keeps its supervisor outcome',
    async (outcome) => {
      /** The wrapper adds only physical ports; supervision classifies the task's exact outcome. */
      const { wrapCoroutineTask } = await import('../../dist/remote/runtime-api/coroutine-task.js')
      /** A barrier prevents task exit until the native unit has become ready. */
      const finish = deferred<void>()
      /** Task rejection identity must remain reachable in the supervisor's same-realm cause. */
      const failure = new Error('coroutine raw task rejected')
      /** Rejection also exercises a secondary native close failure without replacing task outcome. */
      const closeFailure = new Error('coroutine raw rejection close failed')
      /** Genuine ports retain their transport behavior while one cleanup operation is observed. */
      const native = outcome === 'reject' ? new MessageChannel() : undefined
      if (native) {
        vi.spyOn(native.port1, 'close').mockImplementation(() => {
          throw closeFailure
        })
        vi.stubGlobal(
          'MessageChannel',
          class {
            port1 = native.port1
            port2 = native.port2
          }
        )
      }
      /** Existing budget retains one lease until the actual wrapper settles. */
      const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
      /** Expected terminal diagnostics remain visible even for the never-restart policy. */
      const reports: unknown[] = []
      /** Native exit carries the original classified error without a second lifecycle bridge. */
      const supervisor = createCoroutineSupervisor<MessagePort>({
        id: 'raw-task',
        spec: {
          task: wrapCoroutineTask(
            async () => {
              await finish.promise
              if (outcome === 'reject') throw failure
            },
            (error) => reports.push(error)
          )
        },
        budget,
        scheduler: systemScheduler,
        restart: { mode: 'on-failure', maxRestarts: 0 },
        report: (error) => reports.push(error)
      })
      try {
        expect((await supervisor.start()).state).toBe('ready')
        finish.resolve()
        await vi.waitFor(() => expect(supervisor.inspect().lastExit).toBeDefined())
        expect(supervisor.inspect().lastExit?.reason).toBe(
          outcome === 'resolve' ? 'exited' : 'crashed'
        )
        if (outcome === 'reject') {
          expect((supervisor.inspect().lastExit!.error as Error).cause).toBe(failure)
          expect(reports).toContain(closeFailure)
        } else expect(supervisor.state).toBe('stopped')
      } finally {
        finish.resolve()
        await supervisor.dispose()
        budget.close()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        native?.port1.close()
        native?.port2.close()
      }
    }
  )

  it('[A1] aborts cooperatively and closes both ports after task finally, reporting close failure', async () => {
    /** Replacement of the global physical constructor observes wrapper ownership only. */
    const { wrapCoroutineTask } = await import('../../dist/remote/runtime-api/coroutine-task.js')
    /** Ordering is recorded independently of supervision state. */
    const order: string[] = []
    /** A native close failure must not replace the original task rejection. */
    const closeFailure = new Error('coroutine port close failed')
    /** The task's rejection identity remains the primary supervisor outcome. */
    const taskFailure = new Error('coroutine task after abort failed')
    /** Real ports preserve transport shape while spies observe physical cleanup. */
    const native = new MessageChannel()
    vi.spyOn(native.port1, 'close').mockImplementation(() => {
      order.push('port1')
      throw closeFailure
    })
    vi.spyOn(native.port2, 'close').mockImplementation(() => {
      order.push('port2')
    })
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = native.port1
        port2 = native.port2
      }
    )
    /** Wrapper cleanup and terminal reports use the same accepted reporter. */
    const reports: unknown[] = []
    /** Native unit admission remains owned by supervision. */
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
    /** Task cleanup runs after abort and before wrapper physical cleanup. */
    const supervisor = createCoroutineSupervisor<MessagePort>({
      id: 'cleanup-task',
      spec: {
        task: wrapCoroutineTask(
          async ({ signal }) => {
            try {
              await new Promise<void>((resolve) =>
                signal.addEventListener(
                  'abort',
                  () => {
                    order.push('abort')
                    resolve()
                  },
                  { once: true }
                )
              )
            } finally {
              order.push('task-finally')
            }
            throw taskFailure
          },
          (error) => reports.push(error)
        )
      },
      scheduler: systemScheduler,
      budget,
      restart: { mode: 'never' },
      report: (error) => reports.push(error)
    })
    try {
      expect((await supervisor.start()).state).toBe('ready')
      await supervisor.stop({ graceMs: 50 })
      expect(order).toEqual(['abort', 'task-finally', 'port1', 'port2'])
      expect(reports).toContain(closeFailure)
    } finally {
      await supervisor.dispose()
      budget.close()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      native.port1.close()
      native.port2.close()
    }
  })

  it('[A1] abandons at reap timeout and retains the lease until actual late settlement', async () => {
    /** The raw wrapper never turns cooperative abort into forced termination. */
    const { wrapCoroutineTask } = await import('../../dist/remote/runtime-api/coroutine-task.js')
    /** The task deliberately ignores abort for the measured late-settlement interval. */
    const finish = deferred<void>()
    /** Lease count is the existing budget owner's actual observation. */
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
    /** Reap timeout must remain reported with its canonical classification. */
    const reports: unknown[] = []
    /** Explicit timeouts avoid the old fixture's accidental five-second default. */
    const supervisor = createCoroutineSupervisor<MessagePort>({
      id: 'late-task',
      spec: {
        task: wrapCoroutineTask(
          () => finish.promise,
          (error) => reports.push(error)
        )
      },
      budget,
      scheduler: systemScheduler,
      stop: { reapTimeoutMs: 50 },
      restart: { mode: 'never' },
      report: (error) => reports.push(error)
    })
    try {
      await supervisor.start()
      /** A real late settlement proves the lease survives the 50 ms abandonment. */
      const settlement = delay(200).then(() => finish.resolve())
      await supervisor.stop({ graceMs: 50 })
      expect(supervisor.inspect().abandoned).toBe(1)
      expect(budget.inUse).toBe(1)
      expect(reports).toContainEqual(expect.objectContaining({ code: 'REAP_TIMEOUT' }))
      await settlement
      await vi.waitFor(() => expect(budget.inUse).toBe(0))
      expect(supervisor.state).toBe('stopped')
    } finally {
      finish.resolve()
      await supervisor.dispose()
      budget.close()
    }
  })
})
