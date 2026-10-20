import { describe, expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { Logger, getLoggerRuntimeManager, setLoggerRuntimeManager } from '../src/index.js'
import { batch, color, http } from '../src/plugins/index.js'
import type { ILoggerRuntimeManager } from '../src/runtime-manager.js'
import type { ILoggerPluginCore } from '../src/index.js'

/** Keep deterministic memory fixtures independent of PluginHost deadline timers. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** Distinct context identities are needed when the public forwarding API connects loggers. */
let nextId = 0

/** Supplies inert host capabilities; tests replace only the capability being exercised. */
function memoryRuntime(): ILoggerRuntimeManager {
  return {
    randomUUID: () => `audit-${++nextId}`,
    defer: (task) => queueMicrotask(task),
    write: () => undefined,
    console: { log: () => undefined, warn: () => undefined, error: () => undefined }
  }
}

describe('audited logger contracts', () => {
  it('drains buffered HTTP logs before aborting the transport owner', async () => {
    /** Only memory transport is used; no request leaves this process. */
    const bodies: string[] = []
    const runtime = memoryRuntime()
    runtime.fetch = async (_url, init) => {
      bodies.push(init.body)
      return { ok: true, status: 200, headers: { get: () => null } }
    }
    const log = new Logger({
      execution,
      runtimeManager: runtime,
      plugins: [batch(), http({ url: 'memory-only', retries: 0 })]
    })
    log.log('info', 'final entry')
    await log.shutdown('manual')
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(bodies[0]!).entries[0].message).toBe('final entry')
  })

  it.each([false, true])(
    'settles the shared shutdown and disposes after clock failure (cleanup failure: %s)',
    async (cleanupFails) => {
      /** Clock failure begins only after construction and plugin admission finish. */
      let failClock = false
      let disposed = 0
      const clockFailure = new Error('shutdown clock failed')
      const cleanupFailure = new Error('cleanup failed')
      const log = new Logger({
        execution,
        runtimeManager: memoryRuntime(),
        scheduler: {
          now: () => {
            if (failClock) throw clockFailure
            return 0
          },
          schedule: () => ({ cancel: () => undefined })
        },
        plugins: [
          {
            name: 'owned',
            install(core: ILoggerPluginCore) {
              core.onDispose(() => {
                disposed++
                if (cleanupFails) throw cleanupFailure
              })
              return {}
            }
          }
        ]
      })
      failClock = true
      /** Shutdown must publish one settling Promise instead of throwing outside its completion. */
      let pending!: Promise<unknown>
      expect(() => {
        pending = log.shutdown('manual')
      }).not.toThrow()
      // Match the audit repro: the clock recovers before the host's own cleanup deadlines run.
      failClock = false
      const failure = await pending.catch((error: unknown) => error)
      expect(failure).toMatchObject({ source: '@migaia/logger', code: 'INVALID_OPTION' })
      expect([...walkErrorCauses(failure)]).toContain(clockFailure)
      if (cleanupFails) expect([...walkErrorCauses(failure)]).toContain(cleanupFailure)
      expect(disposed).toBe(1)
      expect(log.shutdown('manual')).toBe(pending)
    }
  )

  it('removes only the hook registration whose handle is released', async () => {
    /** Duplicate functions still have independent subscription ownership. */
    let calls = 0
    const listener = () => {
      calls++
    }
    const log = new Logger({ execution, runtimeManager: memoryRuntime() })
    const first = log.hook('before', listener)
    const second = log.hook('before', listener)
    first()
    first()
    log.log('info', 'second registration remains')
    expect(calls).toBe(1)
    second()
    await log.shutdown('manual')
  })

  it('renders forwarded topic chains without exposing cycle bookkeeping', async () => {
    /** JSON output is the documented consumer of the display-only topic chain. */
    const lines: string[] = []
    const runtime = {
      ...memoryRuntime(),
      console: {
        log: (value: unknown) => {
          lines.push(String(value))
        },
        warn: () => undefined,
        error: () => undefined
      }
    }
    const source = new Logger({ execution, runtimeManager: memoryRuntime(), topic: 'source' })
    const target = new Logger({
      execution,
      runtimeManager: runtime,
      topic: 'audit',
      plugins: [color({ format: 'json' })]
    })
    source.extends(target)
    source.log('info', 'forwarded')
    await source.flush()
    expect(JSON.parse(lines[0]!).topics).toBe('source -> audit')
    await source.shutdown('manual')
    await target.shutdown('manual')
  })

  it('ignores raw after shutdown starts while allowing final structured logs', async () => {
    /** Shutdown handlers retain the explicit final structured dispatch allowance. */
    const writes: string[] = []
    const entries: string[] = []
    const log = new Logger({
      execution,
      runtimeManager: {
        ...memoryRuntime(),
        write: (text) => {
          writes.push(text)
        }
      }
    })
    log.useSink((entry) => {
      entries.push(entry.message)
    })
    log.onShutdown(() => {
      log.raw('ignored')
      log.log('info', 'final structured')
    })
    await log.shutdown('manual')
    expect(writes).toEqual([])
    expect(entries).toEqual(['final structured'])
  })

  it('transfers the existing error chain through HTTP without rebuilding stacks', async () => {
    /** Both cause and aggregate branches carry independently classified upstream errors. */
    const cause = Object.assign(new Error('cause'), { source: 'upstream', code: 'CAUSE' })
    const secondary = Object.assign(new TypeError('secondary'), {
      source: 'upstream',
      code: 'SECONDARY'
    })
    const original = Object.assign(new AggregateError([secondary], 'top', { cause }), {
      source: 'upstream',
      code: 'TOP'
    })
    const bodies: string[] = []
    const runtime = memoryRuntime()
    runtime.fetch = async (_url, init) => {
      bodies.push(init.body)
      return { ok: true, status: 200, headers: { get: () => null } }
    }
    const log = new Logger({
      execution,
      runtimeManager: runtime,
      plugins: [http({ url: 'memory-only', retries: 0 })]
    })
    log.log('error', 'failed operation', original)
    await log.flush()
    const projected = JSON.parse(bodies[0]!).entries[0].error
    expect(projected).toMatchObject({
      source: 'upstream',
      code: 'TOP',
      name: 'AggregateError',
      stack: original.stack,
      cause: { source: 'upstream', code: 'CAUSE', stack: cause.stack },
      errors: [{ source: 'upstream', code: 'SECONDARY', stack: secondary.stack }]
    })
    expect(projected.raw).toBeUndefined()
    await log.shutdown('manual')
  })

  it.each(['sync', 'async'] as const)(
    'surfaces %s terminal reporter failure on the shared host queue',
    async (kind) => {
      /**
       * Host delivery stays separate from business dispatch, without recursively calling the failed
       * reporter.
       */
      const callbacks: (() => void)[] = []
      const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
        callbacks.push(callback)
      })
      const reporterFailure = new Error('terminal reporter failed')
      const runtime = memoryRuntime()
      runtime.console!.error = () => {
        if (kind === 'async') return Promise.reject(reporterFailure)
        throw reporterFailure
      }
      const log = new Logger({ execution, runtimeManager: runtime })
      try {
        log.useSink(() => {
          throw new Error('business sink failed')
        })
        expect(() => log.log('info', 'entry')).not.toThrow()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(callbacks).toHaveLength(1)
        expect(callbacks[0]).toThrow(reporterFailure)
      } finally {
        await log.shutdown('manual')
        queue.mockRestore()
      }
    }
  )

  it('restores the same original default runtime manager object', () => {
    /** An outer override must not manufacture a new host capability owner when restored. */
    const previous = getLoggerRuntimeManager()
    const restore = setLoggerRuntimeManager(memoryRuntime())
    restore()
    restore()
    expect(getLoggerRuntimeManager()).toBe(previous)
  })
})
