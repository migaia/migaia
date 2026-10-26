import { describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { setTimeout as delay } from 'node:timers/promises'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { coroutineCarrier, CoroutinePort } from '../../dist/coroutine-port.js'
import type { ICoroutineMessagePort } from '../../dist/coroutine-task.js'

/** The actual coroutine carrier attaches through the public Host, with no Peer or ACK bridge. */
function portHost(
  port: ICoroutineMessagePort,
  self: { name: string; instanceId: string },
  report: (error: unknown) => void
) {
  return createRpcHost({
    self,
    report,
    provide: { identity: () => self.instanceId },
    plugins: [
      defineTransportPlugin({
        name: self.name,
        namespace: 'coroutine',
        async open(context) {
          /** The sole original physical carrier is acquired by its real Session owner. */
          const carrier = coroutineCarrier(port, self.instanceId, context.report)
          expect(carrier.closingWrites).toBe(true)
          expect(carrier.mapRetirement).toBeUndefined()
          /** The original Host attachment remains the only receiver and close authority. */
          const session = context.attach(carrier)
          await session.ready
          return { dispose: () => context.detach(session) }
        }
      })
    ]
  })
}

describe('coroutine runtime binding', () => {
  it('child recipe starts the genuine task port through EventTarget after capture', async () => {
    const { wrapCoroutineTask, connectionOf } = await import('../../dist/coroutine-task.js')
    const finish = deferred<void>()
    const exposed = deferred<ICoroutineMessagePort>()
    const connected = deferred<import('../../dist/coroutine-task.js').ICoroutineConnect>()
    const reports: unknown[] = []
    const controller = new AbortController()
    const running = Promise.resolve(
      wrapCoroutineTask(
        async ({ connect }) => {
          connected.resolve(connect)
          await finish.promise
        },
        (error) => reports.push(error)
      )({ signal: controller.signal, expose: exposed.resolve, heartbeat: () => undefined })
    )
    const connect = await connected.promise
    const native = connectionOf(connect)
      .port as unknown as import('node:worker_threads').MessagePort
    const attached = vi.spyOn(native, 'addEventListener')
    const emitter = vi.spyOn(native, 'on')
    const originalStart = native.start
    const start = vi.spyOn(native, 'start').mockImplementation(() => {
      expect(attached.mock.calls.some(([name]) => name === 'message')).toBe(true)
      Reflect.apply(originalStart, native, [])
    })
    /** Both actual Hosts settle before the task's physical ports are released. */
    const [parent, child] = await Promise.all([
      portHost(
        await exposed.promise,
        { name: 'parent', instanceId: 'child-recipe-parent' },
        (error) => reports.push(error)
      ),
      createRpcHost({
        provide: { read: (value: unknown) => value },
        report: (error) => reports.push(error),
        plugins: [coroutinePlugin({ connectToParent: connect })]
      })
    ])
    try {
      expect(await parent.coroutine.request('read', 'child-recipe')).toBe('child-recipe')
      expect(emitter).not.toHaveBeenCalled()
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      await Promise.all([parent.close(), child.close()])
      finish.resolve()
      await running
      vi.restoreAllMocks()
    }
  })
  it('uses only EventTarget listeners and starts once after the first message listener', () => {
    const native = new MessageChannel()
    const attached = vi.spyOn(native.port1, 'addEventListener')
    const emitter = vi.spyOn(native.port1, 'on')
    const start = vi.spyOn(native.port1, 'start').mockImplementation(() => {
      expect(attached.mock.calls.some(([name]) => name === 'message')).toBe(true)
    })
    const port = new CoroutinePort(native.port1)
    /** Exact acquired removers belong to the physical carrier, not a frozen compatibility facade. */
    const remove: (() => void)[] = []
    try {
      remove.push(port.onClose(() => undefined))
      expect(start).not.toHaveBeenCalled()
      remove.push(
        port.onMessage(() => undefined),
        port.onMessage(() => undefined)
      )
      expect(start).toHaveBeenCalledTimes(1)
      expect(emitter).not.toHaveBeenCalled()
    } finally {
      for (const dispose of remove) dispose()
      vi.restoreAllMocks()
      native.port1.close()
      native.port2.close()
    }
  })
  it('exchanges independently prepared identities without changing either self', async () => {
    for (let index = 0; index < 2; index += 1) {
      const native = new MessageChannel()
      const left = { name: 'parent', instanceId: `p-${index}` }
      const right = { name: 'child', instanceId: `c-${index}` }
      const hosts = await Promise.all([
        portHost(native.port1, left, () => undefined),
        portHost(native.port2, right, () => undefined)
      ])
      try {
        expect(
          await Promise.all([
            hosts[0].coroutine.send(right.instanceId, 'identity'),
            hosts[1].coroutine.send(left.instanceId, 'identity')
          ])
        ).toEqual([right.instanceId, left.instanceId])
        expect(left).toEqual({ name: 'parent', instanceId: `p-${index}` })
        expect(right).toEqual({ name: 'child', instanceId: `c-${index}` })
      } finally {
        await Promise.all(hosts.map((host) => host.close()))
        native.port1.close()
        native.port2.close()
      }
    }
  })
  it('retains the native heartbeat clock through the original task context', async () => {
    const { wrapCoroutineTask } = await import('../../dist/coroutine-task.js')
    const entered = deferred<import('../../dist/coroutine-task.js').ICoroutineTaskContext>()
    const finish = deferred<void>()
    const reports: unknown[] = []
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
    const native = createCoroutineSupervisor<ICoroutineMessagePort>({
      budget,
      id: 'heartbeat-context',
      spec: {
        task: wrapCoroutineTask(
          async (context) => {
            entered.resolve(context)
            await finish.promise
          },
          (error) => reports.push(error)
        )
      },
      scheduler: systemScheduler,
      report: (error) => reports.push(error)
    })
    try {
      const ready = await native.start()
      expect(ready.state).toBe('ready')
      if (ready.state !== 'ready') return
      const context = await entered.promise
      const before = ready.unit.lastHeartbeatAt
      await vi.waitFor(() => expect(systemScheduler.now()).toBeGreaterThan(before))
      context.heartbeat()
      expect(ready.unit.lastHeartbeatAt).toBeGreaterThan(before)
    } finally {
      finish.resolve()
      await native.dispose()
      budget.close()
    }
  })

  it.each(['resolve', 'reject'] as const)(
    'raw task %s keeps its supervisor outcome',
    async (outcome) => {
      /** The wrapper adds only physical ports; supervision classifies the task's exact outcome. */
      const { wrapCoroutineTask } = await import('../../dist/coroutine-task.js')
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
        /**
         * The genuine ports the stubbed constructor hands out; read before the class closes over
         * them.
         */
        const { port1, port2 } = native
        vi.stubGlobal(
          'MessageChannel',
          class {
            port1 = port1
            port2 = port2
          }
        )
      }
      /** Existing budget retains one lease until the actual wrapper settles. */
      const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
      /** Expected terminal diagnostics remain visible even for the never-restart policy. */
      const reports: unknown[] = []
      /** Native exit carries the original classified error without a second lifecycle bridge. */
      /** Configuration tasks must not receive the wrapper's private input record as this. */
      const taskReceivers: unknown[] = []
      const supervisor = createCoroutineSupervisor<MessagePort>({
        id: 'raw-task',
        spec: {
          task: wrapCoroutineTask(
            async function (this: unknown) {
              taskReceivers.push(this)
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
        expect(taskReceivers).toEqual([undefined])
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

  it('aborts cooperatively and closes both ports after task finally, reporting close failure', async () => {
    /** Replacement of the global physical constructor observes wrapper ownership only. */
    const { wrapCoroutineTask } = await import('../../dist/coroutine-task.js')
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

  it('abandons at reap timeout and retains the lease until actual late settlement', async () => {
    /** The raw wrapper never turns cooperative abort into forced termination. */
    const { wrapCoroutineTask } = await import('../../dist/coroutine-task.js')
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
