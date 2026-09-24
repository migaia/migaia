/** Hardening regression cases for logger lifecycle and dispatch invariants. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Logger } from '../src/log'
import { batch } from '../src/plugins/batch'
import { http } from '../src/plugins/http'
import { process as processPlugin } from '../src/plugins/process'
import { setLoggerRuntimeManager } from '../src/runtime-manager'
import { boundedWait as waitUntil, createManualScheduler, systemScheduler } from '@migaia/lifecycle'
import type { ILogEntry } from '../src/typing'
import { LoggerErrorCode, LOGGER_SOURCE } from '../src/errors.js'
import { LoggerErrorText } from '../src/error-text.js'
import { installSilentLoggerReporter } from './helpers/silent-runtime.js'

/** Restores the reporter layer installed for the currently running hostile regression. */
let restoreSilentReporter: (() => void) | undefined

beforeEach(() => {
  restoreSilentReporter = installSilentLoggerReporter()
})

afterEach(() => {
  restoreSilentReporter?.()
  restoreSilentReporter = undefined
})

/** Finds a logger-tagged error through both cause and AggregateError branches. */
const findLoggerError = (value: unknown, code: string): (Error & { code?: string }) | undefined => {
  const visited = new Set<unknown>()
  const visit = (candidate: unknown): (Error & { code?: string }) | undefined => {
    if (visited.has(candidate)) return undefined
    visited.add(candidate)
    if (candidate instanceof Error && (candidate as Error & { code?: string }).code === code)
      return candidate as Error & { code?: string }
    if (candidate instanceof AggregateError) {
      for (const nested of candidate.errors) {
        const found = visit(nested)
        if (found) return found
      }
    }
    if (candidate instanceof Error) {
      const found = visit((candidate as Error & { cause?: unknown }).cause)
      if (found) return found
    }
    if (candidate && typeof candidate === 'object') {
      const result = candidate as {
        readonly cleanupErrors?: unknown
        readonly errors?: unknown
        readonly error?: unknown
      }
      if (Array.isArray(result.cleanupErrors)) {
        for (const nested of result.cleanupErrors) {
          const found = visit(nested)
          if (found) return found
        }
      }
      if (Array.isArray(result.errors)) {
        for (const nested of result.errors) {
          const found = visit(nested)
          if (found) return found
        }
      }
      if (result.error !== undefined) {
        const found = visit(result.error)
        if (found) return found
      }
    }
    return undefined
  }
  return visit(value)
}

describe('#1 shutting-down 期间 raw() 拒绝但 dispatchRaw() 照收', () => {
  it('两条入口对同一状态的判定不一致', async () => {
    const seen: string[] = []
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    log.useSink((entry: ILogEntry) => {
      seen.push(entry.message)
    })
    log.onShutdown(async () => {
      // shutdown 已把状态置为 shutting-down
      log.raw('raw-during-shutdown')
      log.log('t', 'dispatch-during-shutdown')
    })

    await log.shutdown('manual')
    expect(seen).toContain('dispatch-during-shutdown') // 被接收
  })
})

describe('#2 sink 在派发中注销自己会跳过下一个 sink', () => {
  it('#sinks 是活数组，splice 使 for...of 漏项', () => {
    const called: string[] = []
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const off = log.useSink(() => {
      called.push('a')
      off()
    })
    log.useSink(() => called.push('b'))
    log.useSink(() => called.push('c'))

    log.log('t', 'x')
    expect(called).toEqual(['a', 'b', 'c'])
  })
})

describe('#3 ctx 的「逐层冻结」声明不成立', () => {
  it('createdAt 与 options 的嵌套值仍可被插件改写', () => {
    const nested = { flag: true }
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      options: { nested }
    })

    log.ctx.createdAt.setTime(0)
    expect(log.ctx.createdAt.getTime()).toBe(0)

    ;(log.ctx.options.nested as any).flag = false
    expect(nested.flag).toBe(false)
  })
})

describe('#4 用户可控的 data.extendPath 能关掉 extends 转发', () => {
  it('调用方伪造 extendPath 即可让目标收不到日志', () => {
    const target: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'target'
    })
    const received: string[] = []
    target.useSink((entry: ILogEntry) => received.push(entry.message))

    const source: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'source'
    })
    source.extends(target)

    source.dispatchRaw({ tag: 't', message: 'normal' })
    expect(received).toEqual(['normal'])

    source.dispatchRaw({
      tag: 't',
      message: 'suppressed',
      data: { extendPath: [target.ctx.id] }
    })
    expect(received).toEqual(['normal', 'suppressed'])
  })
})

describe('#5 onFlush 处理器在一次 flush() 里被调用多次', () => {
  it('flusher 自身产生 pending 时循环会重跑 flusher', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let flusherCalls = 0
    let scheduled = false

    log.onFlush(async () => {
      flusherCalls += 1
      if (!scheduled) {
        scheduled = true
        log.defer(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
        })
      }
    })

    await log.flush()
    expect(flusherCalls).toBe(1)
  })
})

describe('#6 shutdown 失败会把实例卡在 shutting-down', () => {
  it('插件 dispose 抛错后 shutdown 返回结构化错误，且实例仍拒绝日志', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [
        {
          name: 'boom',
          install: () => ({}),
          dispose: () => {
            throw new Error('dispose-boom')
          }
        }
      ]
    })
    const seen: string[] = []
    log.useSink((entry: ILogEntry) => seen.push(entry.message))

    const failures: unknown[] = []
    log.onFailure((failure: unknown) => failures.push(failure))

    const shutdown = await log.shutdown('manual')
    expect(shutdown.cleanupComplete).toBe(true)
    expect(shutdown.cleanupErrors.length).toBeGreaterThan(0)

    // Failed shutdown is terminal and must not route entries into a disposed host.
    log.log('t', 'after-failed-shutdown')
    expect(seen).toEqual([])
    expect(failures).toHaveLength(0)

    // 终态失败仍复用同一个 rejected promise，不伪装成成功。
    const repeated = await log.shutdown('manual')
    expect(repeated).toBe(shutdown)
  })
})

describe('third adversarial pass', () => {
  it('rejects invalid HTTP retry counts before installation', () => {
    // LG-T6-8
    for (const retries of [-1, Infinity]) {
      try {
        http({ url: 'https://example.test/logs', retries })
        throw new Error('expected http() to reject invalid retries')
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_RETRY_COUNT' })
      }
    }
  })

  it('rolls back process listeners when runtime installation fails partway through', async () => {
    // LG-T6-9
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'beforeExit') throw new Error('listener-boom')
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) =>
        listeners.get(event)?.delete(listener),
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'rollback-id',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      expect(
        () =>
          new Logger({
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
            plugins: [processPlugin()]
          })
      ).toThrow('listener-boom')
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true)
    } finally {
      restore()
    }
  })
  it('keeps the primary install error reachable when listener rollback also fails', () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'beforeExit') throw new Error('install-primary')
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'SIGTERM') throw new Error('rollback-secondary')
        listeners.get(event)?.delete(listener)
      },
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'rollback-primary',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [processPlugin()]
        })
      } catch (error) {
        failure = error
      }
      const aggregate = (failure as Error & { cause?: unknown }).cause
      expect(aggregate).toBeInstanceOf(AggregateError)
      expect(aggregate).toMatchObject({
        source: '@migaia/logger',
        code: 'PROCESS_INSTALL_ROLLBACK_FAILED'
      })
      expect((aggregate as AggregateError).errors[0]).toMatchObject({
        message: expect.stringContaining('install-primary')
      })
      expect((aggregate as AggregateError).errors[1]).toMatchObject({
        message: 'rollback-secondary'
      })
    } finally {
      restore()
    }
  })

  it('runs async before hooks in registration order', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const seen: boolean[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    log.hook('before', async (entry: ILogEntry) => {
      await gate
      entry.data.ready = true
    })
    log.hook('before', (entry: ILogEntry) => {
      seen.push(entry.data.ready === true)
    })
    log.useSink((entry: ILogEntry) => {
      seen.push(entry.data.ready === true)
    })
    log.log('info', 'ordered-hooks')
    await Promise.resolve()
    expect(seen).toEqual([])
    release()
    await log.flush()
    expect(seen).toEqual([true, true])
  })
  it('waits for asynchronous before hooks before entering the sink', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const seen: unknown[] = []
    log.hook('before', async (entry: ILogEntry) => {
      await Promise.resolve()
      entry.data.ready = true
    })
    log.useSink((entry: ILogEntry) => seen.push(entry.data.ready))

    log.log('info', 'async-before')
    expect(seen).toEqual([])
    await log.flush()
    expect(seen).toEqual([true])
  })

  it('does not retain a logger when process plugin configuration conflicts', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        listeners.get(event)?.delete(listener)
      },
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'conflict-id',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const first: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin({ shutdownTimeoutMs: 10 })]
      })
      expect(
        () =>
          new Logger({
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
            plugins: [processPlugin({ shutdownTimeoutMs: 20 })]
          })
      ).toThrow()
      await first.shutdown('manual')
      expect(listeners.get('SIGINT')?.size ?? 0).toBe(0)
    } finally {
      restore()
    }
  })
})

describe('shutdown dispatch admission', () => {
  it('drains handler-era work, then blocks disposer-era logs before PluginHost disposal', async () => {
    const seen: string[] = []
    let releaseInitial!: () => void
    let initialStarted = false
    let disposerRan = false
    let disposerLogRouted = false
    let deferredDisposerWorkRan = false
    let installedCore: any
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [
        {
          name: 'disposer-log',
          install: (core: any) => {
            installedCore = core
            return {}
          },
          dispose: () => {
            disposerRan = true
            installedCore.log('late', 'disposer-log')
            installedCore.defer(() => {
              deferredDisposerWorkRan = true
              installedCore.log('late', 'deferred-disposer-log')
            })
          }
        }
      ]
    })
    log.useSink((entry: ILogEntry) => {
      seen.push(entry.message)
      if (entry.message === 'initial') {
        initialStarted = true
        return new Promise<void>((resolve) => {
          releaseInitial = resolve
        })
      }
      if (entry.message === 'disposer-log') disposerLogRouted = true
      return Promise.resolve()
    })
    log.onShutdown(() => {
      log.log('info', 'handler-work')
    })

    process.on('unhandledRejection', onUnhandled)
    try {
      log.log('info', 'initial')
      const shutdown = log.shutdown('manual')
      let settled = false
      void shutdown.then(() => {
        settled = true
      })
      await Promise.resolve()

      expect(initialStarted).toBe(true)
      expect(settled).toBe(false)
      expect(log.shutdown('signal')).toBe(shutdown)

      releaseInitial()
      await shutdown

      expect(disposerRan).toBe(true)
      expect(seen).toEqual(['initial', 'handler-work'])
      expect(disposerLogRouted).toBe(false)
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      expect(deferredDisposerWorkRan).toBe(false)
      expect(settled).toBe(true)
      log.log('info', 'after-close')
      expect(seen).toEqual(['initial', 'handler-work'])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
})

describe('#7（批次0）fireHook 遍历活数组，派发期间新注册的 hook 会在本轮内被调用', () => {
  it('hook A 在自己的回调里注册 hook B，B 在同一轮 fireHook 内就被执行', () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const order: string[] = []

    log.hook('custom', () => {
      order.push('a')
      log.hook('custom', () => order.push('b'))
    })

    log.fireHook('custom', {})
    expect(order).toEqual(['a', 'b']) // 当前实现：B 参与了本轮，而非要等下一次 fireHook
  })
})

describe('#8（批次0）#snapshotEntry 只隔离 sink，"after" hook 的变更能泄漏进 extends 转发', () => {
  it('sink 拿到派发前的快照，extends 目标拿到 after-hook 修改之后的值', () => {
    const target: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'target'
    })
    const forwarded: unknown[] = []
    target.useSink((entry: ILogEntry) => forwarded.push((entry.data as any).injected))

    const source: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'source'
    })
    const sourceSeen: unknown[] = []
    source.useSink((entry: ILogEntry) => sourceSeen.push((entry.data as any).injected))
    source.extends(target)

    source.hook('after', (entry: ILogEntry) => {
      ;(entry.data as Record<string, unknown>).injected = 'mutated-by-after-hook'
    })

    source.dispatchRaw({ tag: 't', message: 'x' })

    expect(sourceSeen).toEqual([undefined]) // sink 已经在 after hook 跑之前拿到快照，看不到这次修改
    expect(forwarded).toEqual(['mutated-by-after-hook']) // 但 extends 转发发生在 after hook 之后，泄漏了
  })
})

describe('second adversarial pass', () => {
  it('LG-R4-1: batch flush returns after deadline when onBatch never settles', async () => {
    vi.useFakeTimers()
    try {
      const log: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      const [batchHandle] = await log.use(batch())
      const { createBatcher } = batchHandle.getFeature('batch')
      const batcher = createBatcher({ maxSize: 1 }, () => new Promise<void>(() => undefined))
      batcher.push('stuck')
      const pending = batcher.flush()
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('LG-R4-2: one flush shares one absolute deadline across phases and extends targets', async () => {
    vi.useFakeTimers()
    try {
      const log: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      log.extends({
        ctx: { id: 'never-flush', topic: 'target' },
        dispatchRaw: () => undefined,
        flush: () => new Promise<void>(() => undefined)
      })
      const pending = log.flush()
      await vi.advanceTimersByTimeAsync(3_000)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush deadline cannot interrupt a never-settling tracked sink', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    log.useSink(() => new Promise<void>(() => undefined))
    log.log('t', 'never')
    const outcome = await Promise.race([
      log.flush().then(() => 'flushed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still-pending'), 20))
    ])
    expect(outcome).toBe('still-pending')
  })

  it('LG-R3-2 fixed: cross-realm-style thenables (not instanceof Promise) are tracked by flush', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let settled = false
    log.useSink(
      () =>
        ({
          // oxlint-disable-next-line unicorn/no-thenable -- models a Promise from another realm.
          then(resolve: () => void) {
            setTimeout(() => {
              settled = true
              resolve()
            }, 20)
          }
        }) as any
    )
    log.log('t', 'thenable')
    await log.flush()
    expect(settled).toBe(true) // flush() now waits for the thenable instead of missing it entirely
  })

  it('LG-R3-3 fixed: reentrant shutdown() calls alias to the same in-flight promise instead of starting a second pass', async () => {
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let calls = 0
    let reentrantPromise: Promise<void> | undefined
    log.onShutdown(() => {
      calls += 1
      // Fire reentrantly but do not await it here — a handler awaiting the very shutdown
      // promise its own execution is a step of is a self-reference no implementation can
      // resolve (same class of misuse as a plugin-host install() awaiting its own nested
      // use() call). What this test verifies is that the reentrant call is recognized as
      // "already in flight" and aliases to the same promise, rather than kicking off an
      // independent second pass that would run every handler again.
      reentrantPromise = log.shutdown('manual')
    })

    const outer = log.shutdown('manual')
    expect(reentrantPromise).toBe(outer)
    await outer
    expect(calls).toBe(1) // the handler ran exactly once, not twice
  })

  it('runtime extend guard does not propagate through a structural logger target', () => {
    const source: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'source'
    })
    let deliveries = 0
    const structuralTarget: any = {
      ctx: { id: 'structural', topic: 'target' },
      dispatchRaw() {
        deliveries += 1
        if (deliveries === 1) source.log('loop', 'again')
      }
    }
    source.extends(structuralTarget)
    source.log('loop', 'first')
    expect(deliveries).toBe(2)
  })
})

describe('fifth adversarial pass', () => {
  it('LG-R5-1: a never-settling onShutdown handler no longer blocks shutdown() past the shared deadline', async () => {
    // #drain()/flusher()/extends-target waits are all bounded by an absolute deadline (LG-R3-1,
    // LG-R4-2/3). The onShutdown handler loop that runs *before* any of that was still a raw,
    // unbounded `await handler(reason)` — a handler shaped like "flush a client then resolve" that
    // has a bug and never settles hangs shutdown() forever, the exact failure mode already closed
    // for every other pending source.
    vi.useFakeTimers()
    try {
      const log: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      log.onShutdown(() => new Promise<void>(() => undefined))
      const pending = log.shutdown('manual')
      let settled = false
      void pending.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('LG-R5-1: shutdown handlers registered after a stuck one are still invoked, only their wait is bounded', async () => {
    vi.useFakeTimers()
    try {
      const log: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      const order: string[] = []
      log.onShutdown(() => {
        order.push('stuck-start')
        return new Promise<void>(() => undefined)
      })
      log.onShutdown(() => {
        order.push('second')
      })
      const pending = log.shutdown('manual')
      await vi.advanceTimersByTimeAsync(3_000)
      await pending
      expect(order).toEqual(['stuck-start', 'second'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('LG-R5-2: waitUntil clears its deadline timer once the raced task settles first', async () => {
    vi.useFakeTimers()
    try {
      await waitUntil(Promise.resolve('done'), systemScheduler.now() + 3_000)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('LG-R5-2: #drain clears its per-round deadline timer once pending work settles before the deadline', async () => {
    vi.useFakeTimers()
    try {
      const log: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      log.useSink(() => Promise.resolve())
      log.log('t', 'x')
      await log.flush()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('LG-R5-3: waitUntil must observe a task even when the deadline has already elapsed, or a later rejection goes unhandled', async () => {
    // Every waitUntil() call site (flusher loop, extends-target loop, and the LG-R5-1 shutdown
    // handler loop) can be reached *after* #drain() has already burned the whole deadline — at
    // that point waitUntil's early "deadline already elapsed" branch returns false without ever
    // touching `task`. If the caller built that task fresh (e.g. `Promise.resolve(handler(reason))`)
    // instead of passing an already-tracked/observed promise, an eventual rejection on it becomes a
    // genuine Node unhandledRejection instead of flowing into the caller's failure-reporting path.
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const rejecting = Promise.reject(new Error('boom-after-deadline'))
      const alreadyElapsed = systemScheduler.now() - 1
      const result = await waitUntil(rejecting, alreadyElapsed)
      expect(result).toBe(false)
      // Give Node's unhandledRejection detector (queued for a later tick) a chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
})

describe('AF-66/AF-67 scheduler and terminal reporter boundaries', () => {
  it('uses one scheduler snapshot for the host disposer, logger lifecycle, and plugin core', async () => {
    vi.useFakeTimers()
    const schedulerReads = { now: 0, schedule: 0 }
    const receivers: unknown[] = []
    const pendingTasks: Array<() => void> = []
    const scheduler = {
      get now() {
        schedulerReads.now += 1
        return function (this: unknown): number {
          receivers.push(this)
          return 0
        }
      },
      get schedule() {
        schedulerReads.schedule += 1
        return function (this: unknown, callback: () => void, _delayMs: number) {
          receivers.push(this)
          pendingTasks.push(callback)
          return { cancel: () => undefined }
        }
      }
    }
    let optionReads = 0
    let pluginScheduler: unknown
    const options = {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      get scheduler() {
        optionReads += 1
        return scheduler
      },
      plugins: [
        {
          name: 'scheduler-observer',
          install: (core: any) => {
            pluginScheduler = core.scheduler
            return {}
          }
        },
        {
          name: 'stuck-disposer',
          install: () => ({}),
          dispose: () => new Promise<void>(() => undefined)
        }
      ] as const
    }
    try {
      const log: any = new Logger(options as any)
      expect(optionReads).toBe(1)
      expect(schedulerReads).toEqual({ now: 1, schedule: 1 })
      expect(pluginScheduler).toBe(log.scheduler)

      const shutdown = log.shutdown('manual')
      for (let index = 0; index < 20 && pendingTasks.length === 0; index += 1)
        await Promise.resolve()
      expect(pendingTasks.length).toBeGreaterThan(0)
      for (const callback of pendingTasks.splice(0)) callback()
      const result = await shutdown
      expect(result.cleanupComplete).toBe(false)
      expect(result.cleanupErrors.length).toBeGreaterThan(0)
      expect(receivers.length).toBeGreaterThan(0)
      expect(receivers.every((receiver) => receiver === scheduler)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains synchronous, asynchronous, console, and write reporter failures', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      for (const withConsole of [true, false]) {
        const restore = setLoggerRuntimeManager({
          randomUUID: () => `reporter-${withConsole}`,
          defer: (task) => task(),
          write: () => {
            if (!withConsole) throw new Error('writer-failed')
          },
          ...(withConsole
            ? {
                console: {
                  log: () => undefined,
                  warn: () => undefined,
                  error: () => {
                    throw new Error('console-failed')
                  }
                }
              }
            : {})
        })
        try {
          const log: any = new Logger({
            execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
          })
          log.onFailure(() => {
            throw new Error('sync-hook-failed')
          })
          log.onFailure(async () => {
            throw new Error('async-hook-failed')
          })
          log.useSink(() => Promise.reject(new Error('sink-failed')))
          log.log('error', 'reporter-boundary')
          await expect(log.flush()).resolves.toBeUndefined()
        } finally {
          restore()
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })
})

describe('Round18 logger scheduler and uninstall regressions', () => {
  it('LG-T19 / AF-126 aggregates uninstall cleanup failures, resets runtime state, and permits reinstall', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const originalExit = (() => undefined as never) as (code?: number) => never
    let exitValue = originalExit
    let failRestore = true
    let failRemove = true
    const removeAttempts: string[] = []
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        removeAttempts.push(event)
        if (failRemove && (event === 'SIGINT' || event === 'SIGTERM'))
          throw new Error(`${event}-remove-failed`)
        listeners.get(event)?.delete(listener)
      },
      get exit() {
        return exitValue
      },
      set exit(value: typeof originalExit) {
        exitValue = value
        if (value === originalExit && failRestore) {
          failRestore = false
          throw new Error('exit-restore-failed')
        }
      }
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round18-uninstall',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const first = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin({ interceptProcessExit: true })]
      })
      const uninstall = await first.unUse('process')
      expect(uninstall).toMatchObject({ ok: false })
      expect(removeAttempts).toEqual([
        'SIGINT',
        'SIGTERM',
        'beforeExit',
        'uncaughtException',
        'unhandledRejection'
      ])
      expect(runtimeProcess.exit).toBe(originalExit)

      failRemove = false
      const second = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin({ interceptProcessExit: true })]
      })
      expect(runtimeProcess.exit).not.toBe(originalExit)
      await second.unUse('process')
      expect(runtimeProcess.exit).toBe(originalExit)
    } finally {
      failRemove = false
      restore()
    }
  })

  it('LG-T20 / AF-128 settles HTTP flush when scheduler task cancellation throws and reports once', async () => {
    const cancelError = new Error('http-timer-cancel-failed')
    const scheduled: Array<() => void> = []
    let cancelCalls = 0
    const scheduler = {
      now: () => 0,
      schedule: (callback: () => void) => {
        scheduled.push(callback)
        return {
          cancel: () => {
            cancelCalls += 1
            if (cancelCalls === 1) throw cancelError
          }
        }
      }
    }
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const failures: unknown[] = []
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'round18-http-cancel',
      defer: (task) => task(),
      write: () => undefined,
      fetch: async () => ({ ok: true, status: 200, headers: { get: () => null } })
    })
    process.on('unhandledRejection', onUnhandled)
    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [http({ url: 'https://example.test/logs', retries: 0 })]
      })
      logger.onFailure(({ error }: { error: unknown }) => failures.push(error))
      logger.log('info', 'cancel failure')
      await expect(logger.flush()).resolves.toBeUndefined()
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatchObject({ code: LoggerErrorCode.deliveryFailed })
      expect((failures[0] as Error & { cause?: unknown }).cause).toBe(cancelError)
      expect(scheduled.length).toBeGreaterThan(0)
      await logger.shutdown('manual')
      await Promise.resolve()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      restore()
    }
    expect(unhandled).toEqual([])
  })

  it('LG-T21/LG-T22/LG-T23 / AF-129 drives process, batch, and HTTP timers through one manual scheduler', async () => {
    const scheduler = createManualScheduler()
    const processListeners = new Map<string, (...args: any[]) => void>()
    const exits: number[] = []
    let fetchAttempts = 0
    const batches: string[][] = []
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) =>
        processListeners.set(event, listener),
      removeListener: () => undefined,
      exit: ((code?: number) => {
        exits.push(code ?? 0)
        return undefined as never
      }) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round18-manual',
      defer: (task) => task(),
      write: () => undefined,
      fetch: async () => {
        fetchAttempts += 1
        if (fetchAttempts === 1) throw new Error('retry-on-manual-clock')
        return { ok: true, status: 200, headers: { get: () => null } }
      }
    })
    try {
      const batchLogger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler
      })
      const [batchHandle] = await batchLogger.use(batch())
      const { createBatcher } = batchHandle.getFeature('batch')
      const batcher = createBatcher({ maxSize: 2, maxWaitMs: 10 }, (items: string[]) => {
        batches.push(items)
      })
      batcher.push('debounced')
      expect(batches).toEqual([])
      scheduler.advance(10)
      await Promise.resolve()
      await batcher.flush()
      expect(batches).toEqual([['debounced']])
      await batchLogger.shutdown('manual')

      const httpLogger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [http({ url: 'https://example.test/logs', retries: 1, requestTimeoutMs: 100 })]
      })
      httpLogger.log('info', 'http-manual')
      const httpFlush = httpLogger.flush()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(fetchAttempts).toBe(1)
      scheduler.advance(200)
      await httpFlush
      expect(fetchAttempts).toBe(2)
      await httpLogger.shutdown('manual')

      const processLogger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [processPlugin({ shutdownTimeoutMs: 25 })]
      })
      let pendingProcessFlush = true
      let releaseProcessFlush!: () => void
      processLogger.onFlush(() =>
        pendingProcessFlush
          ? new Promise<void>((resolve) => {
              releaseProcessFlush = () => {
                pendingProcessFlush = false
                resolve()
              }
            })
          : undefined
      )
      processListeners.get('beforeExit')?.()
      scheduler.advance(25)
      await Promise.resolve()
      expect(pendingProcessFlush).toBe(true)
      releaseProcessFlush()
      scheduler.advance(3000)
      await Promise.resolve()
      await processLogger.unUse('process')
      expect(exits).toEqual([])
      await processLogger.shutdown('manual')
    } finally {
      restore()
    }
  })
})

describe('Round21 ProcessPlugin scheduler-domain admission', () => {
  it('accepts two cores from one injected scheduler source despite separate snapshots', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) =>
        listeners.get(event)?.delete(listener),
      exit: (() => undefined as never) as (code?: number) => never
    }
    const scheduler = createManualScheduler()
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round21-same-source',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const first = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [processPlugin()]
      })
      const second = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [processPlugin()]
      })
      expect(first.scheduler).not.toBe(second.scheduler)
      expect(listeners.get('SIGINT')?.size).toBe(1)

      let flushed = 0
      first.onFlush(() => {
        flushed += 1
      })
      await first.flush()
      expect(flushed).toBe(1)

      await second.unUse('process')
      await first.unUse('process')
    } finally {
      restore()
    }
  })

  it('rejects a different scheduler domain before adding the second core', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) =>
        listeners.get(event)?.delete(listener),
      exit: (() => undefined as never) as (code?: number) => never
    }
    const firstScheduler = createManualScheduler()
    const secondScheduler = createManualScheduler()
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round21-different-domain',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const first = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler: firstScheduler,
        plugins: [processPlugin()]
      })
      const before = [...(listeners.get('SIGINT') ?? [])]
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          scheduler: secondScheduler,
          plugins: [processPlugin()]
        })
      } catch (error) {
        failure = error
      }
      expect(findLoggerError(failure, LoggerErrorCode.pluginConfigConflict)).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.pluginConfigConflict
      })
      expect([...(listeners.get('SIGINT') ?? [])]).toEqual(before)

      let flushed = 0
      first.onFlush(() => {
        flushed += 1
      })
      await first.flush()
      expect(flushed).toBe(1)

      await first.unUse('process')
      const replacement = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler: secondScheduler,
        plugins: [processPlugin()]
      })
      expect(listeners.get('SIGINT')?.size).toBe(1)
      await replacement.unUse('process')
    } finally {
      restore()
    }
  })

  it('keeps scheduler source admission single-read while preserving the source domain', async () => {
    const scheduler = createManualScheduler()
    let schedulerReads = 0
    const options = {
      get scheduler() {
        schedulerReads += 1
        return scheduler
      }
    }
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: () => undefined,
      removeListener: () => undefined,
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round21-hostile-option',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        ...options,
        plugins: [processPlugin()]
      })
      expect(schedulerReads).toBe(1)
      await logger.unUse('process')
    } finally {
      restore()
    }
  })
})

describe('Round23 HTTP response-commit cleanup failures', () => {
  /** Installs an AbortController whose listener removal fails without affecting abort state. */
  const stubRemovalFailure = (
    removeError: Error,
    shouldThrow: (call: number) => boolean = () => true
  ): (() => void) => {
    const originalAbortController = globalThis.AbortController
    let removeCalls = 0
    class ThrowingAbortController {
      readonly signal = {
        aborted: false,
        addEventListener: (
          _type: string,
          _listener: () => void,
          _options?: { readonly once?: boolean }
        ): void => undefined,
        removeEventListener: (_type: string, _listener: () => void): void => {
          removeCalls += 1
          if (shouldThrow(removeCalls)) throw removeError
        }
      }

      abort(): void {
        this.signal.aborted = true
      }
    }
    vi.stubGlobal('AbortController', ThrowingAbortController)
    return () => vi.stubGlobal('AbortController', originalAbortController)
  }

  it('LG-T28 does not retry a successful POST when timer and listener cleanup both fail', async () => {
    const cancelError = new Error('round23-timer-cancel')
    const removeError = new Error('round23-listener-remove')
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
    const scheduler = {
      now: () => 0,
      schedule: (callback: () => void, delay: number) => {
        if (delay <= 400) callback()
        return {
          cancel: () => {
            if (delay === 10000) throw cancelError
          }
        }
      }
    }
    const unhandled: unknown[] = []
    const failures: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const restoreAbortController = stubRemovalFailure(removeError)
    const restoreRuntime = setLoggerRuntimeManager({
      randomUUID: () => 'round23-success-cleanup',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    })
    process.on('unhandledRejection', onUnhandled)
    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [http({ url: 'https://example.test/logs', retries: 2 })]
      })
      logger.onFailure(({ error }: { error: unknown }) => failures.push(error))
      logger.log('info', 'round23-success')

      await expect(logger.flush()).resolves.toBeUndefined()
      expect(fetch).toHaveBeenCalledOnce()
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.deliveryFailed
      })
      expect((failures[0] as AggregateError).errors).toEqual([cancelError, removeError])
      await logger.shutdown('manual')
      await Promise.resolve()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      restoreRuntime()
      restoreAbortController()
    }
    expect(unhandled).toEqual([])
  })

  it('LG-T29 keeps status retry count while retaining 503 primary and cleanup errors', async () => {
    const cancelError = new Error('round23-status-timer-cancel')
    const removeError = new Error('round23-status-listener-remove')
    const fetch = vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => '0' } }))
    const scheduler = {
      now: () => 0,
      schedule: (callback: () => void, delay: number) => {
        if (delay <= 400) callback()
        return {
          cancel: () => {
            if (delay === 10000) throw cancelError
          }
        }
      }
    }
    const unhandled: unknown[] = []
    const failures: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const restoreAbortController = stubRemovalFailure(removeError, (call) => call % 2 === 1)
    const restoreRuntime = setLoggerRuntimeManager({
      randomUUID: () => 'round23-status-cleanup',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    })
    process.on('unhandledRejection', onUnhandled)
    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [http({ url: 'https://example.test/logs', retries: 1 })]
      })
      logger.onFailure(({ error }: { error: unknown }) => failures.push(error))
      logger.log('info', 'round23-status')

      await expect(logger.flush()).resolves.toBeUndefined()
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(failures).toHaveLength(1)
      const failure = failures[0] as AggregateError
      expect(failure).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.deliveryFailed
      })
      expect(failure.errors[0]).toMatchObject({ message: '日志推送失败: HTTP 503' })
      expect(failure.errors.slice(1)).toEqual([cancelError, removeError])
      await logger.shutdown('manual')
      await Promise.resolve()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      restoreRuntime()
      restoreAbortController()
    }
    expect(unhandled).toEqual([])
  })
})

describe('Logger-owned scheduler option admission', () => {
  it('keeps stable public error text out of logger implementation modules', () => {
    const sources = [
      readFileSync(new URL('../src/log.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/plugins/http.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/plugins/process.ts', import.meta.url), 'utf8')
    ].join('\n')
    for (const text of [
      '[logger] process runtime is shutting down',
      '[logger] process plugin already installed with different configuration',
      '[logger] http 日志序列化失败',
      '[logger] HTTP transport is unavailable in this runtime',
      '未捕获异常，进程即将退出',
      '未处理的 Promise rejection，进程即将退出'
    ]) {
      expect(sources).not.toContain(text)
    }
  })

  it('wraps an options.scheduler getter failure as logger TypeError with the original cause', () => {
    const getterError = new Error('scheduler-option-getter')
    const options = {
      get scheduler(): never {
        throw getterError
      }
    }
    let failure: unknown
    try {
      new Logger(options as any)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.invalidOption,
      message: LoggerErrorText.schedulerGetterFailed
    })
    expect((failure as { cause?: unknown }).cause).toBe(getterError)
    expect((failure as { source?: string }).source).not.toBe('@migaia/plugin-host')
  })

  it('rejects an invalid scheduler shape with logger TypeError and no foreign error owner', () => {
    let failure: unknown
    try {
      new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler: { now: () => 0 }
      } as any)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.invalidOption,
      message: LoggerErrorText.invalidScheduler
    })
    expect((failure as { cause?: unknown }).cause).toBeUndefined()
    expect((failure as { source?: string }).source).not.toBe('@migaia/plugin-host')
  })

  it('preserves a scheduler capability getter failure directly as the logger TypeError cause', () => {
    const accessorError = new Error('scheduler-now-getter')
    const scheduler = {
      get now(): never {
        throw accessorError
      },
      schedule: () => ({ cancel: () => undefined })
    }
    let failure: unknown
    try {
      new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler
      } as any)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.invalidOption,
      message: LoggerErrorText.schedulerGetterFailed
    })
    expect((failure as { cause?: unknown }).cause).toBe(accessorError)
  })
})

describe('Round20 logger uninstall isolation', () => {
  it('LG-T24 / LG-R23 drains buffered items, cancels every batcher, and isolates reinstall', async () => {
    const scheduled: Array<() => void> = []
    const cancelError = new Error('batch-cancel-failed')
    let cancelCalls = 0
    let deferCalls = 0
    const scheduler = {
      now: () => 0,
      schedule: (callback: () => void, delay: number) => {
        if (delay === 10) scheduled.push(callback)
        return {
          cancel: () => {
            if (delay === 10) {
              cancelCalls += 1
              throw cancelError
            }
          }
        }
      }
    }
    const oldBatches: string[][] = []
    const newBatches: string[][] = []
    const restore = setLoggerRuntimeManager({
      randomUUID: () => `round20-${scheduled.length}`,
      defer: (task) => {
        deferCalls += 1
        task()
      },
      write: () => undefined
    })
    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler
      })
      const [oldBatchHandle] = await logger.use(batch())
      const { createBatcher: oldFactory } = oldBatchHandle.getFeature('batch')
      const oldBatcher = oldFactory({ maxSize: 3, maxWaitMs: 10 }, (items: string[]) =>
        oldBatches.push(items)
      )
      const secondOldBatcher = oldFactory({ maxSize: 3, maxWaitMs: 10 }, (items: string[]) =>
        oldBatches.push(items)
      )
      oldBatcher.push('drop-one')
      secondOldBatcher.push('drop-two')
      expect(scheduled).toHaveLength(2)

      const uninstallFailure = await logger.unUse('batch')
      expect(uninstallFailure).toBeDefined()
      const taggedUninstall = findLoggerError(
        uninstallFailure,
        LoggerErrorCode.pluginUninstallCleanupFailed
      )
      expect(taggedUninstall).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.pluginUninstallCleanupFailed
      })
      expect((taggedUninstall as Error & { cause?: AggregateError }).cause?.errors).toEqual([
        cancelError,
        cancelError
      ])
      expect(cancelCalls).toBe(2)

      const deferredBeforeLateCallbacks = deferCalls
      for (const callback of scheduled) callback()
      oldBatcher.push('late-old')
      await oldBatcher.flush()
      expect(oldBatches).toEqual([['drop-one'], ['drop-two']])
      expect(deferCalls).toBe(deferredBeforeLateCallbacks)
      expect(scheduled).toHaveLength(2)

      expect(() => oldFactory({ maxSize: 1 }, (items: string[]) => oldBatches.push(items))).toThrow(
        expect.objectContaining({ code: 'REGISTRATION_REVOKED' })
      )
      expect(scheduled).toHaveLength(2)

      const reinstalled: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler
      })
      const [newBatchHandle] = await reinstalled.use(batch())
      const { createBatcher: newFactory } = newBatchHandle.getFeature('batch')
      const newBatcher = newFactory({ maxSize: 2, maxWaitMs: 10 }, (items: string[]) =>
        newBatches.push(items)
      )
      newBatcher.push('new-install')
      expect(scheduled).toHaveLength(3)
      scheduled[2]!()
      await newBatcher.flush()
      expect(newBatches).toEqual([['new-install']])
      // Reinstall must not route the new logger's batch into the old owner; its prior
      // losslessly drained batches remain the only entries observed by the old callback.
      expect(oldBatches).toEqual([['drop-one'], ['drop-two']])
      await reinstalled.shutdown('manual')
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('LG-T25 / LG-R23 contains synchronous batch callback failure without throwing from push', async () => {
    const callbackError = new Error('batch-callback-failed')
    const failures: Array<{ source: string; error: unknown }> = []
    const logger: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    logger.onFailure((failure: { source: string; error: unknown }) => failures.push(failure))
    const [batchHandle] = await logger.use(batch())
    const { createBatcher } = batchHandle.getFeature('batch')
    const batcher = createBatcher({ maxSize: 1, asyncOutput: false }, () => {
      throw callbackError
    })

    expect(() => batcher.push('sync-failure')).not.toThrow()
    await expect(batcher.flush()).resolves.toBeUndefined()
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(failures).toContainEqual({ source: 'defer', error: callbackError })
    await logger.shutdown('manual')
  })
})

describe('phase transition continuation containment', () => {
  it('tracks a before continuation rejection and drains it without unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const failures: Array<{ source: string; error: unknown }> = []
    const continuationError = new Error('before-continuation')
    const tag = {
      [Symbol.toPrimitive]: () => {
        throw continuationError
      }
    } as unknown as string
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const log: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      log.onFailure((failure: { source: string; error: unknown }) => failures.push(failure))
      log.hook('before', async () => undefined)
      log.dispatchRaw({ tag, message: 'before-continuation' })

      await expect(log.flush()).resolves.toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled).toEqual([])
    expect(failures).toContainEqual({ source: 'hook', error: continuationError })
  })

  it('drains tagBefore, after, and tagAfter continuation chains in order', async () => {
    const order: string[] = []
    const log: any = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    log.hook('before', async () => {
      order.push('before-start')
      await Promise.resolve()
      order.push('before-end')
    })
    log.hook('before:info', async () => {
      order.push('tag-before-start')
      await Promise.resolve()
      order.push('tag-before-end')
    })
    log.useSink(() => order.push('sink'))
    log.hook('after', async () => {
      order.push('after-start')
      await Promise.resolve()
      order.push('after-end')
    })
    log.hook('after:info', async () => {
      order.push('tag-after-start')
      await Promise.resolve()
      order.push('tag-after-end')
    })

    log.log('info', 'phase-order')
    await log.flush()

    expect(order).toEqual([
      'before-start',
      'before-end',
      'tag-before-start',
      'tag-before-end',
      'sink',
      'after-start',
      'after-end',
      'tag-after-start',
      'tag-after-end'
    ])
  })

  it('contains after and tagAfter continuation callback failures and drains pending work', async () => {
    const unhandled: unknown[] = []
    const failures: Array<{ source: string; error: unknown }> = []
    const afterError = new Error('after-continuation')
    const tagAfterError = new Error('tag-after-continuation')
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    const restoreRuntime = setLoggerRuntimeManager({
      randomUUID: () => 'continuation-failure',
      defer: (task) => task(),
      write: () => undefined
    })
    process.on('unhandledRejection', onUnhandled)
    try {
      const makeTarget = (error: Error): any => {
        let reads = 0
        return {
          get ctx() {
            reads += 1
            if (reads > 1) throw error
            return { id: `target-${error.message}`, topic: 'target' }
          },
          dispatchRaw: () => undefined,
          flush: () => Promise.resolve()
        }
      }
      const afterLog: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      afterLog.onFailure((failure: { source: string; error: unknown }) => failures.push(failure))
      afterLog.extends(makeTarget(afterError))
      afterLog.hook('after', async () => undefined)
      afterLog.log('info', 'after-continuation')

      const tagAfterLog: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      tagAfterLog.onFailure((failure: { source: string; error: unknown }) => failures.push(failure))
      tagAfterLog.extends(makeTarget(tagAfterError))
      tagAfterLog.hook('after:info', async () => undefined)
      tagAfterLog.log('info', 'tag-after-continuation')

      await expect(afterLog.flush()).resolves.toBeUndefined()
      await expect(tagAfterLog.flush()).resolves.toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
      restoreRuntime()
    }

    expect(unhandled).toEqual([])
    expect(failures).toContainEqual({ source: 'hook', error: afterError })
    expect(failures).toContainEqual({ source: 'hook', error: tagAfterError })
  })
})
