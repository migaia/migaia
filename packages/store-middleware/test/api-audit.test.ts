import { immutableSnapshotClone } from '../src/tolerant-clone.ts'
import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { isManagedHost } from '@migaia/plugin-host/composition'
import {
  createStoreMiddlewareHost,
  bindStoreMiddleware,
  createMutationPolicy,
  createReduxDevToolsAdapter,
  type IReduxDevToolsMessage,
  type IDevToolsCommand,
  type IStoreMiddlewareHost
} from '../src/index.ts'

describe('store-middleware audit regressions', () => {
  it.each(['host', 'binding'] as const)(
    'preserves the canonical managed %s and its fluent/live surface',
    async (mode) => {
      /** Both public factories use the same real Runtime and Store state. */
      const runtime = createRuntime({ onError: () => {} })
      /** The binding owns subscriptions to this actual Store. */
      const store = createStore({ count: 0 }, { runtime })
      /** Explicit disabled deadlines are supported execution budgets, not fabricated host internals. */
      const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
      /** Widen only the ordinary state shape; no managed brand is injected. */
      const host: IStoreMiddlewareHost<Record<string, unknown>> =
        mode === 'host'
          ? createStoreMiddlewareHost({ execution, runtime, getState: () => store.$plain() })
          : bindStoreMiddleware(store, { execution })
      try {
        expect(isManagedHost(host)).toBe(true)
        expect(Object.isFrozen(host)).toBe(true)
        /** A chainable canonical entry must return this same public domain handle. */
        const fluent = host.usePipeline((event, next) => next(event))
        expect(fluent).toBe(host)
        expect(typeof Reflect.get(fluent, 'runAction')).toBe('function')
        if (mode === 'binding') expect(Reflect.get(fluent, 'store')).toBe(store)
        /** Reading the getter again must observe a committed registration and removal. */
        const before = host.revision
        await host.use({ name: 'audit-domain', install: () => ({}) })
        expect(host.revision).toBeGreaterThan(before)
        expect(fluent.revision).toBe(host.revision)
        /** Capture the intermediate revision before actual lifecycle removal. */
        const installed = host.revision
        await host.unUse('audit-domain')
        expect(host.revision).toBeGreaterThan(installed)
        expect(fluent.revision).toBe(host.revision)
      } finally {
        await host.dispose()
        await store.$dispose()
      }
    }
  )
  it('executes binding disposal registered after close instead of abandoning it', async () => {
    /** Disposal uses the real canonical Host. */
    const host = createStoreMiddlewareHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      runtime: createRuntime(),
      getState: () => ({})
    })
    /** Completion is cached before any late registration can occur. */
    const first = host.dispose()
    await first
    /** A synchronous disposer has no later owner once the host is terminal. */
    const dispose = vi.fn()
    host.attachBindingDisposer(dispose)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(host.dispose()).toBe(first)
    await host.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['unsupported', 'missing-native'] as const)(
    'retains the caught Utils error for %s cloning',
    (mode) => {
      if (mode === 'missing-native') vi.stubGlobal('structuredClone', undefined)
      try {
        /** The actual Utils wrapper, rather than only its native leaf, must stay on cause. */
        let failure: unknown
        try {
          immutableSnapshotClone(() => 1)
        } catch (error) {
          failure = error
        }
        expect(failure).toMatchObject({
          source: 'store.middleware',
          code: mode === 'unsupported' ? 'CLONE_UNSUPPORTED' : 'ENV_UNSUPPORTED'
        })
        expect((failure as Error).cause).toMatchObject({
          source: 'foundation.utils',
          code: mode === 'unsupported' ? 'CLONE_UNSUPPORTED' : 'ENV_UNSUPPORTED'
        })
        expect(((failure as Error).cause as Error).stack).toBeTruthy()
      } finally {
        vi.unstubAllGlobals()
      }
    }
  )

  it.each(['policy', 'host'] as const)(
    'identifies a fresh native %s action callback failure',
    async (mode) => {
      /** This error has never passed through another pipeline or Runtime callback. */
      const primary = new TypeError('fresh action failed')
      /** Policy is a supported independent public entry. */
      const policy = createMutationPolicy('actions-only')
      /** The Host uses the same policy, with an actual Runtime. */
      const host = createStoreMiddlewareHost({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        runtime: createRuntime({ onError: () => {} }),
        getState: () => ({}),
        mutationPolicy: policy
      })
      try {
        expect(() =>
          mode === 'policy'
            ? policy.runInAction(() => {
                throw primary
              })
            : host.runAction('audit', () => {
                throw primary
              })
        ).toThrow(primary)
        expect(primary).toMatchObject({
          source: mode === 'policy' ? 'store.middleware' : 'reactive',
          code: 'CALLBACK_FAILED'
        })
        expect(policy.insideAction).toBe(false)
      } finally {
        await host.dispose()
      }
    }
  )

  it('reports malformed Redux JSON and still accepts a later valid command', () => {
    /** Runtime reporting is observed through its public callback. */
    const reports: unknown[] = []
    /** The adapter must report to the requested real Runtime instead of swallowing parse errors. */
    const runtime = createRuntime({
      onError: (error) => {
        reports.push(error)
      }
    })
    /** The complete structural connection receives messages through its actual subscription. */
    let receive: (message: IReduxDevToolsMessage) => void = () => {}
    /** Only valid commands may reach the consumer. */
    const commands: IDevToolsCommand<unknown>[] = []
    /** No extension browser API is invoked by this public protocol fixture. */
    const adapter = createReduxDevToolsAdapter<unknown>(
      {
        init() {},
        send() {},
        subscribe(listener) {
          receive = listener
          return () => {
            receive = () => {}
          }
        }
      },
      runtime
    )
    /** Connection ownership remains the original returned disposer. */
    const stop = adapter.subscribe!((command) => {
      commands.push(command)
    })
    try {
      expect(() =>
        receive({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' }, state: '{invalid' })
      ).not.toThrow()
      expect(commands).toEqual([])
      expect(reports).toHaveLength(1)
      expect(reports[0]).toBeInstanceOf(SyntaxError)
      expect(reports[0]).toMatchObject({
        source: 'store.middleware',
        code: 'DEVTOOLS_MESSAGE_INVALID'
      })
      receive({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' }, state: '{"count":3}' })
      expect(commands).toEqual([{ type: 'jump', state: { count: 3 } }])
    } finally {
      stop()
    }
  })
  it('reads the public pipeline option getter once', async () => {
    /** Count the supported stable getter on a complete actual host configuration. */
    let reads = 0
    /** Domain creation must reuse the captured option in canonical host admission. */
    const host = createStoreMiddlewareHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      runtime: createRuntime(),
      getState: () => ({}),
      get pipeline() {
        reads++
        return { mode: 'sync' as const }
      }
    })
    try {
      expect(reads).toBe(1)
    } finally {
      await host.dispose()
    }
  })

  it.each(['root', 'nested', 'map-key', 'set-member'] as const)(
    'rejects a class at %s without flattening its behavior',
    (location) => {
      /** Prototype behavior is part of the input type and cannot survive native data projection. */
      class BusinessState {
        read() {
          return 1
        }
      }
      /** Every case uses a real class value in a supported graph position. */
      const state = new BusinessState()
      /** The strict policy rejects classes throughout the data graph. */
      const value =
        location === 'root'
          ? state
          : location === 'nested'
            ? { state }
            : location === 'map-key'
              ? new Map([[state, 1]])
              : new Set([state])
      expect(() => immutableSnapshotClone(value)).toThrow(
        expect.objectContaining({ source: 'store.middleware', code: 'CLONE_UNSUPPORTED' })
      )
    }
  )

  it('rejects an accessor before executing it', () => {
    /** Strict data admission must not execute a getter once for validation and again for cloning. */
    let reads = 0
    expect(() =>
      immutableSnapshotClone({
        get value() {
          reads++
          return 1
        }
      })
    ).toThrow(expect.objectContaining({ source: 'store.middleware', code: 'CLONE_UNSUPPORTED' }))
    expect(reads).toBe(0)
  })

  it('keeps canonical cloning of supported built-ins, cycles and shared graph identity', () => {
    /** Shared identity must survive across ordinary fields and collection entries. */
    const shared = { count: 1 }
    /** Native copy remains the sole clone implementation. */
    const value = {
      shared,
      date: new Date(123),
      expression: /audit/g,
      map: new Map([[shared, shared]]),
      set: new Set([shared]),
      bytes: new Uint8Array([7]),
      cycle: undefined as unknown
    }
    value.cycle = value
    /** The real copied graph is observed through normal native interfaces. */
    const copy = immutableSnapshotClone(value)
    expect(copy).not.toBe(value)
    expect(copy.shared).not.toBe(shared)
    expect(copy.cycle).toBe(copy)
    expect(copy.map.get(copy.shared)).toBe(copy.shared)
    expect(copy.set.has(copy.shared)).toBe(true)
    expect(copy.date.getTime()).toBe(123)
    expect(copy.expression.source).toBe('audit')
    expect(copy.bytes).toEqual(new Uint8Array([7]))
    expect(copy.bytes.buffer).not.toBe(value.bytes.buffer)
  })
})
