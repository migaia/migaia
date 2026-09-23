import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import {
  createMutationPolicy,
  createStoreMiddlewareHost,
  bindStoreMiddleware,
  loggerMiddleware,
  middlewarePlugin,
  type IDevToolsCommand,
  type IMiddlewareEvent,
  type IStoreMiddlewarePlugin
} from '../src/index'
import { ClonePolicy } from '../src/tolerant-clone'

type IState = { readonly value: number }

/** Explicit unbounded policy used by legacy Store behavior tests. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

function makeRuntime() {
  const errors: Array<{ error: unknown; phase: string }> = []
  const runtime = createRuntime({
    onError: (error, context) => errors.push({ error, phase: context.phase })
  })
  return { runtime, errors }
}

describe('IStoreMiddlewareHost construction', () => {
  it('rejects an invalid DevTools adapter before plugin installation', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    await expect(host.connectDevTools(null as never)).rejects.toThrow(
      '[store] DevTools adapter must provide init/send functions'
    )
    await host.dispose()
  })

  it('rejects null options with a tagged configuration error', () => {
    expect(() => createStoreMiddlewareHost(null as never)).toThrow(
      '[store] middleware host options must be an object'
    )
  })

  it('contains revoked host options proxies before PluginHost construction', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(() => createStoreMiddlewareHost(proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-middleware',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
  })
  it('diagnostic clone keeps non-cloneable leaves without throwing', () => {
    const handler = () => 1
    const snapshot = ClonePolicy.diagnostic({ handler, value: 1 })
    expect(snapshot.handler).toBe(handler)
    expect(snapshot.value).toBe(1)
  })

  it('default state snapshots tolerate functions and non-cloneable values', async () => {
    const runtime = createRuntime()
    const store = createStore({ value: 1, handler: () => 1 }, { runtime })
    const binding = bindStoreMiddleware(store, { execution })
    expect(() => store.value++).not.toThrow()
    await binding.dispose()
    store.$dispose()
  })
  it('forces pipeline mode to sync even when caller passes pipeline.mode: "async"', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 }),
      pipeline: { mode: 'async' }
    })
    // A stage registered via useAsyncPipeline only fits an 'async' mode host;
    // since the host is forced to 'sync', installing it must fail.
    await expect(
      host.use({
        name: 'bad-async-stage',
        install: (core) => {
          core.useAsyncPipeline(async (_event, next) => {
            await next(_event)
          })
          return {}
        }
      } satisfies IStoreMiddlewarePlugin<IState>)
    ).rejects.toThrow()
    await host.dispose()
  })

  it('defaults mutationPolicy to a fresh "off" instance when none is supplied', () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    expect(() => host.mutationPolicy.assertMutationAllowed()).not.toThrow()
  })

  it('reuses the exact mutationPolicy instance passed in options', () => {
    const { runtime } = makeRuntime()
    const policy = createMutationPolicy('actions-only')
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 }),
      mutationPolicy: policy
    })
    expect(host.mutationPolicy).toBe(policy)
  })
})

it('snapshots accessor-backed host options before construction reuses them', async () => {
  const { runtime } = makeRuntime()
  const options = {
    execution,
    runtime,
    getState: () => ({ value: 0 })
  } as Record<string, unknown>
  let pipelineReads = 0
  Object.defineProperty(options, 'pipeline', {
    get: () => {
      pipelineReads++
      if (pipelineReads > 1) throw new Error('pipeline reread')
      return { mode: 'async' }
    }
  })
  const host = createStoreMiddlewareHost(options as never)
  expect(pipelineReads).toBe(1)
  await host.dispose()
})

describe('IStoreMiddlewareHost.emit', () => {
  it('reports a trace-listener error when a pipeline stage never calls next()', async () => {
    const { runtime, errors } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    await host.use({
      name: 'swallow',
      install: (core) => {
        core.usePipeline(() => {
          // deliberately never calls next()
        })
        return {}
      }
    })
    host.recordState('test', { value: 0 }, { value: 1 })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.phase).toBe('trace-listener')
    expect(String((errors[0]!.error as Error).message)).toContain(
      '[store] middleware did not call next()'
    )
    await host.dispose()
  })

  it('does not report an error when every stage calls next()', async () => {
    const { runtime, errors } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const seen: IMiddlewareEvent<IState>[] = []
    await host.use(
      middlewarePlugin<IState>('capture', (event, _ctx, next) => {
        seen.push(event)
        next()
      })
    )
    host.recordState('test', { value: 0 }, { value: 1 })
    expect(errors).toHaveLength(0)
    expect(seen).toHaveLength(1)
    await host.dispose()
  })

  it('contains a throwing Runtime reporter at the trace boundary', async () => {
    const runtime = createRuntime()
    const reporterFailure = new Error('runtime reporter failed')
    const hostReportError = vi.fn()
    vi.spyOn(runtime, 'reportError').mockImplementation(() => {
      throw reporterFailure
    })
    vi.stubGlobal('reportError', hostReportError)
    try {
      const host = createStoreMiddlewareHost<IState>({
        execution,
        runtime,
        getState: () => ({ value: 0 })
      })
      await host.use({
        name: 'swallow-hostile-reporter',
        install: (core) => {
          core.usePipeline(() => {
            throw new Error('pipeline failure')
          })
          return {}
        }
      })

      expect(() => host.recordState('test', { value: 0 }, { value: 1 })).not.toThrow()
      expect(hostReportError).toHaveBeenCalledWith(reporterFailure)
      await host.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('IStoreMiddlewareHost.runAction', () => {
  it('dispatches action:start then action:end with a numeric durationMs, and returns fn result', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const events: IMiddlewareEvent<IState>[] = []
    await host.use(
      middlewarePlugin<IState>('capture', (event, _ctx, next) => {
        events.push(event)
        next()
      })
    )
    const result = host.runAction('increment', () => 7, { source: 'test' })
    expect(result).toBe(7)
    expect(events.map((e) => e.type + ':' + (e as { phase?: string }).phase)).toEqual([
      'action:start',
      'action:end'
    ])
    const endEvent = events[1] as Extract<IMiddlewareEvent<IState>, { phase: 'end' }>
    expect(endEvent.name).toBe('increment')
    expect(typeof endEvent.durationMs).toBe('number')
    expect(endEvent.durationMs).toBeGreaterThanOrEqual(0)
    expect(endEvent.metadata).toEqual({ source: 'test' })
    await host.dispose()
  })

  it('runInAction is true for mutationPolicy while fn executes', async () => {
    const { runtime } = makeRuntime()
    const policy = createMutationPolicy('actions-only')
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 }),
      mutationPolicy: policy
    })
    let observedInsideAction = false
    host.runAction('act', () => {
      observedInsideAction = policy.insideAction
    })
    expect(observedInsideAction).toBe(true)
    expect(policy.insideAction).toBe(false)
    await host.dispose()
  })

  it('on fn error: dispatches action:error and rethrows the original error unchanged', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const events: IMiddlewareEvent<IState>[] = []
    await host.use(
      middlewarePlugin<IState>('capture', (event, _ctx, next) => {
        events.push(event)
        next()
      })
    )
    const boom = new Error('business failure')
    expect(() =>
      host.runAction('risky', () => {
        throw boom
      })
    ).toThrow(boom)
    expect(events.map((e) => e.type + ':' + (e as { phase?: string }).phase)).toEqual([
      'action:start',
      'action:error'
    ])
    const errorEvent = events[1] as Extract<IMiddlewareEvent<IState>, { phase: 'error' }>
    expect(errorEvent.error).toBe(boom)
    await host.dispose()
  })
})

describe('IStoreMiddlewareHost.recordState / recordError', () => {
  it('recordState dispatches a "state" event with previous/next verbatim', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const events: IMiddlewareEvent<IState>[] = []
    await host.use(
      middlewarePlugin<IState>('capture', (event, _ctx, next) => {
        events.push(event)
        next()
      })
    )
    host.recordState('name', { value: 1 }, { value: 2 }, { by: 'test' })
    expect(events).toEqual([
      expect.objectContaining({
        type: 'state',
        name: 'name',
        previous: { value: 1 },
        next: { value: 2 },
        metadata: { by: 'test' }
      })
    ])
    await host.dispose()
  })

  it('recordError dispatches an "error" event carrying the phase and error', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const events: IMiddlewareEvent<IState>[] = []
    await host.use(
      middlewarePlugin<IState>('capture', (event, _ctx, next) => {
        events.push(event)
        next()
      })
    )
    const err = new Error('diagnostic failure')
    host.recordError('custom-phase', err)
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', phase: 'custom-phase', error: err })
    ])
    await host.dispose()
  })

  it('recordError re-entrancy: a nested recordError call while handling one bypasses the pipeline', async () => {
    const { runtime, errors } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const events: IMiddlewareEvent<IState>[] = []
    let triggeredNested = false
    await host.use(
      middlewarePlugin<IState>('capture', (event, _ctx, next) => {
        events.push(event)
        next()
        if (event.type === 'error' && !triggeredNested) {
          triggeredNested = true
          // Calling recordError() again from inside the first error's stage
          // must NOT re-enter the pipeline (would recurse); it must be
          // forwarded straight to runtime.reportError instead.
          host.recordError('nested-phase', new Error('nested'))
        }
      })
    )
    host.recordError('first-phase', new Error('first'))

    // Only the first error event went through the pipeline.
    expect(events).toHaveLength(1)
    expect((events[0] as { phase: string }).phase).toBe('first-phase')

    // The nested error was forwarded directly to runtime.reportError.
    expect(errors).toHaveLength(1)
    expect(errors[0]?.phase).toBe('trace-listener')
    expect((errors[0]!.error as Error).message).toBe('nested')
    await host.dispose()
  })
})

describe('IStoreMiddlewareHost.attachBindingDisposer / dispose', () => {
  it('is single-flight and replays binding cleanup failure to every caller', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const cleanupError = new Error('binding cleanup failed')
    host.attachBindingDisposer(() => {
      throw cleanupError
    })

    const first = host.dispose()
    const second = host.dispose()
    expect(second).toBe(first)
    await expect(first).resolves.toMatchObject({
      logicalTerminal: true,
      cleanupComplete: true,
      cleanupErrors: [cleanupError]
    })
    expect(host.dispose()).toBe(first)
  })

  it('runs attached disposers in LIFO order before super.dispose() tears down plugins', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const order: string[] = []
    host.attachBindingDisposer(() => {
      order.push('first-attached')
    })
    host.attachBindingDisposer(() => {
      order.push('second-attached')
    })
    let pluginDisposed = false
    await host.use({
      name: 'tracked',
      install: () => ({}),
      dispose: () => {
        pluginDisposed = true
        order.push('plugin-dispose')
      }
    })
    await host.dispose()
    expect(order).toEqual(['second-attached', 'first-attached', 'plugin-dispose'])
    expect(pluginDisposed).toBe(true)
  })
})

describe('loggerMiddleware', () => {
  it('uses console.log as the default sink, called with (event, state)', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 9 })
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await host.use(loggerMiddleware<IState>())
    host.recordState('name', { value: 1 }, { value: 2 })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0]?.[0]).toBe('[store]')
    expect((logSpy.mock.calls[0]![2] as IState).value).toBe(9)
    logSpy.mockRestore()
    await host.dispose()
  })

  it('sync pipeline is flat, not onion: sink() runs (and reads getState()) before any downstream stage executes', async () => {
    // IStoreMiddlewareHost forces pipeline mode 'sync', which the USEGUIDE documents as a flat
    // transform pipe: calling next(event) inside a stage only records the value to hand the next
    // stage — it does not synchronously run that next stage. The next stage only runs after the
    // current stage's function fully returns. So loggerMiddleware's sink(), even though it is
    // written *after* next(event) in source order, still observes state from *before* any
    // downstream stage (like 'mutator' below) has run.
    const { runtime } = makeRuntime()
    let currentValue = 1
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: currentValue })
    })
    const seenBySink: IState[] = []
    const downstreamSeenSinkAlreadyRan: boolean[] = []
    let sinkRan = false
    await host.use(
      loggerMiddleware<IState>((_event, state) => {
        sinkRan = true
        seenBySink.push(state as IState)
      })
    )
    await host.use(
      middlewarePlugin<IState>('mutator', (_event, _ctx, next) => {
        downstreamSeenSinkAlreadyRan.push(sinkRan)
        currentValue = 99
        next()
      })
    )
    host.recordState('name', { value: 0 }, { value: 1 })
    expect(seenBySink).toEqual([{ value: 1 }])
    expect(downstreamSeenSinkAlreadyRan).toEqual([true])
    await host.dispose()
  })
})

describe('IStoreMiddlewareHost.connectDevTools', () => {
  it('contains revoked adapter proxies as tagged configuration errors', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 0 })
    })
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    await expect(host.connectDevTools(proxy as never)).rejects.toMatchObject({
      source: '@migaia/store-middleware',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
    await host.dispose()
  })
  function makeAdapter(_getState: () => IState) {
    const initCalls: IState[] = []
    const sendCalls: Array<{ event: IMiddlewareEvent<IState>; state: IState }> = []
    let listener: ((command: IDevToolsCommand<IState>) => void) | undefined
    return {
      adapter: {
        init: (state: IState) => initCalls.push(state),
        send: (event: IMiddlewareEvent<IState>, state: IState) => sendCalls.push({ event, state }),
        subscribe: (l: (command: IDevToolsCommand<IState>) => void) => {
          listener = l
          return () => {
            listener = undefined
          }
        }
      },
      initCalls,
      sendCalls,
      emit: (command: IDevToolsCommand<IState>) => listener?.(command)
    }
  }

  it('calls adapter.init(getState()) at install time, then adapter.send() for every event', async () => {
    const { runtime } = makeRuntime()
    let state: IState = { value: 5 }
    const host = createStoreMiddlewareHost<IState>({ execution, runtime, getState: () => state })
    const { adapter, initCalls, sendCalls } = makeAdapter(() => state)
    await host.connectDevTools(adapter)
    expect(initCalls).toEqual([{ value: 5 }])
    host.recordState('name', { value: 4 }, { value: 5 })
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0]?.state).toEqual({ value: 5 })
    await host.dispose()
  })

  it('re-inits the adapter with the current state on a "commit" command', async () => {
    const { runtime } = makeRuntime()
    let state: IState = { value: 1 }
    const host = createStoreMiddlewareHost<IState>({ execution, runtime, getState: () => state })
    const { adapter, initCalls, emit } = makeAdapter(() => state)
    await host.connectDevTools(adapter)
    state = { value: 2 }
    emit({ type: 'commit' })
    expect(initCalls).toEqual([{ value: 1 }, { value: 2 }])
    await host.dispose()
  })

  it('applies "jump"/"reset" commands via runAction(devtools:<type>, applyState) and emits an action event', async () => {
    const { runtime } = makeRuntime()
    let state: IState = { value: 1 }
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => state,
      applyState: (s) => {
        state = s
      }
    })
    const { adapter, sendCalls, emit } = makeAdapter(() => state)
    await host.connectDevTools(adapter)
    sendCalls.length = 0
    emit({ type: 'jump', state: { value: 42 } })
    expect(state).toEqual({ value: 42 })
    expect(sendCalls.map((c) => c.event.type)).toEqual(['action', 'action'])
    const names = sendCalls.map((c) => (c.event as { name?: string }).name)
    expect(names).toEqual(['devtools:jump', 'devtools:jump'])
    await host.dispose()
  })

  it('throws "[store] DevTools state command requires applyState" when applyState was not configured', async () => {
    const { runtime } = makeRuntime()
    const host = createStoreMiddlewareHost<IState>({
      execution,
      runtime,
      getState: () => ({ value: 1 })
    })
    const { adapter, emit } = makeAdapter(() => ({ value: 1 }))
    await host.connectDevTools(adapter)
    expect(() => emit({ type: 'reset', state: { value: 0 } })).toThrow(
      '[store] DevTools state command requires applyState'
    )
    await host.dispose()
  })
})
