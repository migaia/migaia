import { expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget } from '../../src/index.js'
import { createMemoryLauncher, deferred, type IMemoryHandle } from '../support/memory-launcher.js'
import { createMemoryProfile } from '../support/memory-profile.js'

/** Advances only the existing lifecycle release reactions, without advancing their deadlines. */
async function flush(): Promise<void> {
  for (let index = 0; index < 40; index++) await Promise.resolve()
}

it('[A46] per-command grace bounds the original beforeTerminate phase', async () => {
  /** One deterministic clock owns all drain, exit and reap deadlines. */
  const scheduler = createManualScheduler()
  /** The genuine supervisor handle observes each original termination invocation. */
  const launcher = createMemoryLauncher()
  /** Budget release remains contingent on actual exited fulfillment. */
  const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
  /** Drain intentionally does not settle, proving the per-command override rather than completion. */
  const supervisor = createSupervisor({
    id: 'runtime-grace',
    spec: 'unit',
    launcher,
    budget,
    scheduler,
    report: () => undefined,
    profile: createMemoryProfile({ gracefulTermination: true, autoExitOnTerminate: true }),
    stop: { drainTimeoutMs: 5000, beforeTerminate: () => new Promise<void>(() => undefined) }
  })
  await supervisor.start()
  /** This is the existing stop command, with the newly specified drain bound. */
  const stopping = supervisor.stop({ graceMs: 10 })
  try {
    await flush()
    expect(launcher.launched[0]!.termination).toEqual([])
    scheduler.advance(10)
    await flush()
    expect(launcher.launched[0]!.termination, '[A46] grace applies to beforeTerminate').toEqual([
      'graceful'
    ])
    await stopping
    expect(budget.inUse).toBe(0)
  } finally {
    launcher.launched[0]!.exit({ outcome: 'fulfilled' })
    scheduler.advance(5000)
    await stopping
    await supervisor.dispose()
  }
})

it('[A46/A47] kill upgrades the same pending drain and shares its exact stop promise', async () => {
  /** Force must happen without waiting for or advancing the current grace deadline. */
  const scheduler = createManualScheduler()
  /** Actual exit is independently controlled after the force request. */
  const launcher = createMemoryLauncher()
  /** The lease cannot be released merely because terminate was requested. */
  const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
  /** Abort proves that the original pending application drain is interrupted. */
  let aborted = false
  /** Counts only the original drain callback, not a facade stop machine. */
  let drains = 0
  /** The original supervisor owns the command queue and slot throughout the race. */
  const supervisor = createSupervisor({
    id: 'runtime-force',
    spec: 'unit',
    launcher,
    budget,
    scheduler,
    report: () => undefined,
    profile: createMemoryProfile({ gracefulTermination: true }),
    stop: {
      beforeTerminate: (_handle, signal) => {
        drains += 1
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return new Promise<void>(() => undefined)
      }
    }
  })
  await supervisor.start()
  /** The command is genuinely waiting inside beforeTerminate when kill is invoked. */
  const stopping = supervisor.stop()
  try {
    await flush()
    expect(drains).toBe(1)
    expect(launcher.launched[0]!.termination).toEqual([])
    expect(typeof supervisor.kill, '[A46] force belongs to the canonical supervisor').toBe(
      'function'
    )
    /** Joining force may not create a second teardown, reap deadline or stop promise. */
    const killing = supervisor.kill()
    expect(killing).toBe(stopping)
    expect(supervisor.kill()).toBe(stopping)
    await flush()
    expect(aborted).toBe(true)
    expect(launcher.launched[0]!.termination).toEqual(['force'])
    expect(drains).toBe(1)
    expect(budget.inUse).toBe(1)
    launcher.launched[0]!.exit({ outcome: 'fulfilled' })
    await Promise.all([stopping, killing])
    expect(budget.inUse).toBe(0)
    expect(supervisor.inspect().lastExit?.reason).toBe('killed')
  } finally {
    launcher.launched[0]!.exit({ outcome: 'fulfilled' })
    scheduler.advance(10000)
    await stopping
    await supervisor.dispose()
  }
})

it('[A52] restartCount counts successful restart causes rather than generation numbers', async () => {
  /** All retirement calls fulfill through the genuine profile and original exited owner. */
  const launcher = createMemoryLauncher()
  /** Exactly one execution lease forces stop-first replacement. */
  const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false })
  /** Repeated start and replace are deliberately different from a manual restart cause. */
  const supervisor = createSupervisor({
    id: 'runtime-restarts',
    spec: 'unit',
    launcher,
    budget,
    report: () => undefined,
    profile: createMemoryProfile({ autoExitOnTerminate: true })
  })
  try {
    await supervisor.start()
    await supervisor.start()
    expect(supervisor.inspect().restartCount, '[A52] initial start is not a restart').toBe(0)
    await supervisor.restart()
    expect(supervisor.generation).toBe(3)
    expect(supervisor.inspect().restartCount).toBe(1)
    await supervisor.replace()
    expect(supervisor.generation).toBe(4)
    expect(supervisor.inspect().restartCount).toBe(1)
    expect(launcher.launched).toHaveLength(3)
  } finally {
    await supervisor.dispose()
  }
})

it.each([
  ['ready', 'stop-first'],
  ['ready', 'restart-first'],
  ['backoff', 'stop-first'],
  ['backoff', 'restart-first']
] as const)('[A49] %s retains original command order when %s', async (state, order) => {
  /** A manual clock independently proves an obsolete backoff timer cannot resurrect a stopped unit. */
  const scheduler = createManualScheduler()
  /** Every actual launch remains in the existing owner fixture's original receipt array. */
  const launcher = createMemoryLauncher()
  /** One execution lease forces all transitions through the original serial queue. */
  const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
  /** Public commands exercise the canonical attempt cancellation and command queue together. */
  const supervisor = createSupervisor({
    id: 'runtime-command-order',
    spec: 'unit',
    launcher,
    budget,
    scheduler,
    report: () => undefined,
    profile: createMemoryProfile({ autoExitOnTerminate: true }),
    restart: { initialDelayMs: 1000, maxDelayMs: 1000 }
  })
  try {
    await supervisor.start()
    if (state === 'backoff') {
      launcher.launched[0]!.exit({ outcome: 'rejected', error: new Error('command order fixture') })
      await flush()
    }
    expect(supervisor.state).toBe(state)
    /** Submission order is deliberate; neither command awaits the other's completion. */
    const first = order === 'stop-first' ? supervisor.stop() : supervisor.restart()
    const second = order === 'stop-first' ? supervisor.restart() : supervisor.stop()
    await Promise.all([first, second])
    expect(supervisor.state).toBe(order === 'stop-first' ? 'ready' : 'stopped')
    expect(launcher.launched).toHaveLength(2)
    scheduler.advance(10_000)
    await flush()
    expect(supervisor.state).toBe(order === 'stop-first' ? 'ready' : 'stopped')
    expect(launcher.launched).toHaveLength(2)
  } finally {
    await supervisor.dispose()
  }
  expect(budget.inUse).toBe(0)
})

it('[A53] event snapshots survive listener mutation and report a returned thenable rejection', async () => {
  /** The callback error stays the exact original value at the report boundary. */
  const failure = new Error('runtime listener fixture')
  /** Reports are passive and cannot change the readiness transition. */
  const reported: unknown[] = []
  /** Records only the genuine ready state event. */
  const order: string[] = []
  /** A real startup and actual profile-owned exit exercise the original publisher. */
  const supervisor = createSupervisor({
    id: 'runtime-listeners',
    spec: 'unit',
    launcher: createMemoryLauncher(),
    budget: createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false }),
    profile: createMemoryProfile({ autoExitOnTerminate: true }),
    report: (error) => {
      reported.push(error)
    }
  })
  /** Cancellation affects the next event, not listeners captured for this one. */
  let removeA: () => void = () => undefined
  /** B must still run once in the event whose snapshot already captured it. */
  let removeB: () => void = () => undefined
  removeA = supervisor.subscribe((event) => {
    if (event.type !== 'state' || event.to !== 'ready') return
    order.push('a')
    removeA()
    removeB()
    supervisor.subscribe((next) => {
      if (next.type === 'state' && next.to === 'ready') order.push('d')
    })
  })
  removeB = supervisor.subscribe((event) => {
    if (event.type !== 'state' || event.to !== 'ready') return
    order.push('b')
    throw failure
  })
  supervisor.subscribe((event) => {
    if (event.type !== 'state' || event.to !== 'ready') return
    order.push('c')
    /** The publisher must contain an actual late Promise rejection without awaiting listeners. */
    return Promise.reject(failure)
  })
  try {
    expect((await supervisor.start()).state).toBe('ready')
    await flush()
    expect(order, '[A53] each captured listener runs once; D starts next event').toEqual([
      'a',
      'b',
      'c'
    ])
    expect(reported).toEqual([failure, failure])
    await supervisor.restart()
    await flush()
    expect(order).toEqual(['a', 'b', 'c', 'c', 'd'])
    expect(reported).toEqual([failure, failure, failure])
  } finally {
    await supervisor.dispose()
  }
})

it.each(['launch', 'ready'] as const)(
  '[A50] kill cancels starting %s immediately and reaps only the original handle',
  async (phase) => {
    /** Kill must not require a startup-timeout or a renewed reap deadline. */
    const scheduler = createManualScheduler()
    /** The genuine original launcher supplies one independently settled native unit. */
    const memory = createMemoryLauncher()
    /** A delayed handle exercises ownership before any native result is available. */
    const launch = deferred<IMemoryHandle>()
    /** Startup readiness remains deliberately pending until cancellation wins. */
    const ready = deferred<void>()
    /** Original launch cancellation is observed without a facade controller. */
    let signal: { readonly aborted: boolean } | undefined
    /** A cancelled generation must never publish readiness. */
    let readyEvents = 0
    /** Lease release is still driven by the real handle's exited fulfillment. */
    const budget = createUnitBudget({ kind: 'memory', maxUnits: 1, launchRate: false, scheduler })
    /** The canonical command queue and slot own both delayed and already-acquired handles. */
    const supervisor = createSupervisor({
      id: 'kill-starting',
      spec: 'unit',
      scheduler,
      budget,
      profile: createMemoryProfile({ autoExitOnTerminate: true }),
      report: () => undefined,
      launcher: {
        capabilities: memory.capabilities,
        launch: (spec, context) => {
          signal = context.signal
          return phase === 'launch' ? launch.promise : memory.launch(spec, context)
        }
      },
      ready: () => ready.promise
    })
    supervisor.subscribe((event) => {
      if (event.type === 'state' && event.to === 'ready') readyEvents++
    })
    /** The actual attempt enters launch/ready before the force command is submitted. */
    const starting = supervisor.start()
    await flush()
    expect(supervisor.state).toBe('starting')
    /** Cancellation is synchronous, independent of the already blocked command queue. */
    const killing = supervisor.kill()
    try {
      expect(signal?.aborted).toBe(true)
      if (phase === 'launch')
        launch.resolve(await memory.launch('unit', { signal: new AbortController().signal }))
      await flush()
      expect(memory.launched[0]!.termination).toEqual(['force'])
      expect(await starting).toEqual({ state: 'stopped' })
      await killing
      expect(readyEvents).toBe(0)
      expect(budget.inUse).toBe(0)
      expect(scheduler.now()).toBe(0)
    } finally {
      ready.resolve()
      for (const handle of memory.launched) handle.exit({ outcome: 'fulfilled' })
      scheduler.advance(10000)
      await Promise.all([starting, killing])
      await supervisor.dispose()
    }
  }
)
