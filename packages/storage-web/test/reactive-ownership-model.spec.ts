import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createEventChannel } from '@migaia/event-subscriber'
import {
  createGenerationController,
  createSyncLifecycleScope,
  type IGenerationRequest
} from '@migaia/lifecycle'
import { createRuntime, type ISignal } from '@migaia/reactive'
import { describe, expect, it } from 'vitest'

type IModelState =
  | { readonly status: 'loading' }
  | { readonly status: 'refreshing'; readonly value: number }
  | { readonly status: 'ready'; readonly value: number }

type IDeferredQuery = {
  readonly request: IGenerationRequest
  readonly resolve: (value: number) => void
  readonly reject: (error: unknown) => void
}

type IOwnershipModel = {
  readonly events: ReturnType<typeof createEventChannel<void>>
  readonly state: ISignal<IModelState>
  readonly queries: IDeferredQuery[]
  readonly microtasks: Array<() => void>
  readonly refresh: () => IGenerationRequest
  readonly drainReactiveQueue: () => void
  readonly dispose: () => void
}

/** Creates one controllable Promise together with its settlement functions. */
const deferredQuery = (): {
  readonly promise: Promise<number>
  readonly resolve: (value: number) => void
  readonly reject: (error: unknown) => void
} => {
  let resolve!: (value: number) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<number>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/**
 * Demonstrates the intended ownership split without introducing production live-query code:
 * event-subscriber owns invalidation fanout, reactive owns coalescing/observable state, and
 * lifecycle owns generation replacement plus the disposer stack.
 */
const createOwnershipModel = (): IOwnershipModel => {
  /** Deterministic host queue injected into the canonical reactive scheduler. */
  const microtasks: Array<() => void> = []
  /** Isolated graph whose scheduler is the only invalidation queue in this model. */
  const runtime = createRuntime({
    adapter: { scheduleMicrotask: (task) => microtasks.push(task) }
  })
  /** Canonical transient fanout owner for durable-change invalidations. */
  const events = createEventChannel<void>()
  /** Reactive source dirtied by event delivery; repeated writes share one scheduler request. */
  const invalidation = runtime.signal(0)
  /** Public settled-state node; Promise/generation state never enters the graph. */
  const state = runtime.signal<IModelState>({ status: 'loading' })
  /** Canonical replacement/cancellation owner for in-flight queries. */
  const generations = createGenerationController()
  /** Canonical synchronous disposer owner for every resource created by the model. */
  const scope = createSyncLifecycleScope()
  /** Controllable query records used to prove stale-settlement rejection. */
  const queries: IDeferredQuery[] = []

  /** Starts one query under a lifecycle-owned generation and publishes only current settlement. */
  const refresh = (): IGenerationRequest => {
    const request = generations.begin()
    const deferred = deferredQuery()
    queries.push({ request, resolve: deferred.resolve, reject: deferred.reject })
    const currentState = state.peek()
    state.value =
      currentState.status === 'ready'
        ? { status: 'refreshing', value: currentState.value }
        : currentState
    void deferred.promise.then(
      (value) => {
        if (generations.adopt(request.token, value, () => undefined))
          state.value = { status: 'ready', value }
      },
      (error: unknown) => {
        generations.adopt(request.token, error, () => undefined)
      }
    )
    return request
  }

  /** Invalidations mutate one reactive source; the graph scheduler coalesces refresh execution. */
  const unsubscribe = events.subscribe(() => {
    invalidation.value += 1
  })
  let firstEffectRun = true
  /** The graph owns refresh scheduling, so storage needs no private pending queue or microtask flag. */
  const stopRefreshEffect = runtime.effect(() => {
    void invalidation.value
    if (firstEffectRun) {
      firstEffectRun = false
      return
    }
    refresh()
  })
  let reentered = false
  /** Reentrant invalidation during state propagation exercises the same graph-owned queue. */
  const stopReentrantEffect = runtime.effect(() => {
    if (state.value.status !== 'refreshing' || reentered) return
    reentered = true
    events.publish(undefined)
  })

  /** Registers one synchronous cleanup in the lifecycle owner without a parallel registry. */
  const ownDisposer = (resource: object | (() => void), dispose: () => void): void => {
    scope.own(resource, { syncSafe: true, force: dispose })
  }
  ownDisposer(state, () => state.dispose())
  ownDisposer(invalidation, () => invalidation.dispose())
  ownDisposer(generations, () => generations.dispose())
  ownDisposer(stopRefreshEffect, stopRefreshEffect)
  ownDisposer(stopReentrantEffect, stopReentrantEffect)
  ownDisposer(unsubscribe, unsubscribe)
  ownDisposer(events, () => events.clear())

  /** Drains only tasks admitted by the injected reactive scheduler. */
  const drainReactiveQueue = (): void => {
    while (microtasks.length > 0) microtasks.shift()?.()
  }

  return {
    events,
    state,
    queries,
    microtasks,
    refresh,
    drainReactiveQueue,
    dispose: () => {
      scope.dispose()
    }
  }
}

describe('SWV2-T50 live-query ownership model', () => {
  it('requires the three canonical owners and keeps the production entry free of parallel state', () => {
    /** Storage manifest must declare every runtime owner it will compose in B06. */
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')
    ) as { readonly dependencies?: Readonly<Record<string, string>> }
    /** Reserved production entry must not pre-build another scheduler/generation/disposer stack. */
    const entry = readFileSync(resolve(import.meta.dirname, '..', 'src', 'reactive.ts'), 'utf8')
    /**
     * Build config must keep the future runtime owner external before the entry starts importing
     * it.
     */
    const buildConfig = readFileSync(resolve(import.meta.dirname, '..', 'vite.config.ts'), 'utf8')

    expect(manifest.dependencies).toMatchObject({
      '@migaia/event-subscriber': 'workspace:^',
      '@migaia/lifecycle': 'workspace:^',
      '@migaia/reactive': 'workspace:^'
    })
    expect(entry).not.toMatch(/\b(?:queueMicrotask|Set|GenerationController|disposers?)\b/)
    expect(buildConfig).toContain("'@migaia/lifecycle'")
  })

  it('coalesces rapid events, fences reentrant refresh, and disposes through canonical owners', async () => {
    const model = createOwnershipModel()
    /** Initial generation establishes old data before refresh behavior is exercised. */
    const initial = model.refresh()
    model.queries[0]?.resolve(1)
    await Promise.resolve()
    model.drainReactiveQueue()
    expect(model.state.peek()).toEqual({ status: 'ready', value: 1 })

    model.events.publish(undefined)
    model.events.publish(undefined)
    model.events.publish(undefined)
    expect(model.microtasks).toHaveLength(1)
    model.drainReactiveQueue()

    /** Rapid events coalesce once; a state-observer reentry then creates exactly one replacement. */
    expect(model.queries).toHaveLength(3)
    expect(initial.signal.aborted).toBe(true)
    expect(model.queries[1]?.request.signal.aborted).toBe(true)
    expect(model.queries[2]?.request.signal.aborted).toBe(false)

    model.queries[1]?.resolve(2)
    await Promise.resolve()
    expect(model.state.peek()).toEqual({ status: 'refreshing', value: 1 })
    model.queries[2]?.resolve(3)
    await Promise.resolve()
    model.drainReactiveQueue()
    expect(model.state.peek()).toEqual({ status: 'ready', value: 3 })

    /** Explicit replacement and disposal are both owned by the same generation/scope pair. */
    const replaced = model.refresh()
    const terminal = model.refresh()
    expect(replaced.signal.aborted).toBe(true)
    model.dispose()
    expect(terminal.signal.aborted).toBe(true)
    expect(model.events.size).toBe(0)
    model.dispose()
  })
})
