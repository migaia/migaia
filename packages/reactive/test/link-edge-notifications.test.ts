import { describe, expect, it } from 'vitest'
import { createRuntime, type IReactiveEffect } from '../src/index.ts'
import {
  createStaticObserver,
  internalRuntimeOf,
  invalidateObservable
} from '../src/entry/extension.ts'
import { createControlledObserver } from './link-edge-views.fixture.ts'

/**
 * Groups notification-entry membership and static-observer behavior; each case independently owns
 * its graph and lifecycle.
 */
describe('graph notification and static observer behavior', () => {
  it('retains notification entry membership and invalidates snapshots after every membership change', () => {
    /** Custom markDirty callbacks provide the supported synchronous reentrancy boundary. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Each publication must use entry membership rather than a live diagnostic iterator. */
    const source = runtime.signal(0)
    /** Recorded callbacks distinguish the current entry snapshot from the next publication. */
    const sequence: string[] = []
    /** Only the first publication replaces membership during notification. */
    let changed = false
    /** The removed observer remains in the current notification's entry snapshot. */
    const second = createControlledObserver(runtime, () => sequence.push('second'))
    /** The new observer must wait until the next publication. */
    const late = createControlledObserver(runtime, () => sequence.push('late'))
    /** The first observer replaces subscriptions inside markDirty without bypassing the binding. */
    const first = createControlledObserver(runtime, () => {
      sequence.push('first')
      if (changed) return
      changed = true
      second.binding.clear()
      late.binding.runTracked(() => source.value)
    })
    first.binding.runTracked(() => source.value)
    second.binding.runTracked(() => source.value)
    source.value = 1
    expect(sequence).toEqual(['first', 'second'])
    expect([...source.subs]).toEqual([first.observer, late.observer])
    sequence.length = 0
    source.value = 2
    expect(sequence).toEqual(['first', 'late'])
    sequence.length = 0
    late.binding.clear()
    second.binding.runTracked(() => source.value)
    source.value = 3
    expect(sequence).toEqual(['first', 'second'])
    first.binding.clear()
    second.binding.clear()
    sequence.length = 0
    source.value = 4
    expect(sequence).toEqual([])
    first.binding.runTracked(() => source.value)
    source.value = 5
    expect(sequence).toEqual(['first'])
    first.dispose()
    second.dispose()
    late.dispose()
    source.dispose()
  })

  it('skips an effect disposed by an earlier notification and makes repeated disposal inert', () => {
    /** Real effects verify scheduler-facing disposal through the application API. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Shared membership preserves first-before-second notification order. */
    const source = runtime.signal(0)
    /** The later effect is assigned before any effective update occurs. */
    let second: IReactiveEffect | undefined
    /** Only effective notification runs enter this sequence. */
    const sequence: string[] = []
    /** Cleanup counts distinguish initial cleanup, final cleanup, and duplicate disposal. */
    let firstCleanups = 0
    /** The disposed later observer must clean up its initial run exactly once. */
    let secondCleanups = 0
    /** Last-edge hooks must also remain idempotent. */
    let unobserved = 0
    source.addObservedHooks({
      onUnobserved: () => {
        unobserved++
      }
    })
    /** The first scheduled callback terminally removes the second pending callback. */
    const first = runtime.effect(() => {
      if (source.value > 0) {
        sequence.push('first')
        second?.dispose()
      }
      return () => {
        firstCleanups++
      }
    })
    second = runtime.effect(() => {
      if (source.value > 0) sequence.push('second')
      return () => {
        secondCleanups++
      }
    })
    source.value = 1
    expect(runtime.flush()).toBe('completed')
    expect(sequence).toEqual(['first'])
    expect(second.disposed).toBe(true)
    expect(source.subs.size).toBe(1)
    expect(secondCleanups).toBe(1)
    first.dispose()
    first.dispose()
    second.dispose()
    second.dispose()
    expect(firstCleanups).toBe(2)
    expect(secondCleanups).toBe(1)
    expect(unobserved).toBe(1)
    expect(source.subs.size).toBe(0)
    source.value = 2
    runtime.flush()
    expect(sequence).toEqual(['first'])
    source.dispose()
  })

  it('recomputes each diamond branch and sink once per effective batch', () => {
    /**
     * Diamond notifications must converge through the existing scheduler rather than duplicate sink
     * work.
     */
    const runtime = createRuntime()
    /** Both branches observe this one source version. */
    const source = runtime.signal(0)
    /** Per-node counters prove a single recomputation at each diamond level. */
    const calls = { left: 0, right: 0, sink: 0 }
    /** The left branch contributes the first deterministic derived offset. */
    const left = runtime.computed(() => {
      calls.left++
      return source.value + 1
    })
    /** The right branch reaches the same sink through an independent edge. */
    const right = runtime.computed(() => {
      calls.right++
      return source.value + 2
    })
    /** The sink must observe settled values from both branches exactly once. */
    const sink = runtime.computed(() => {
      calls.sink++
      return left.value + right.value
    })
    /** Public effect observations prove final values as well as computation counts. */
    const values: number[] = []
    /** One effect keeps the complete diamond actively observed. */
    const effect = runtime.effect(() => {
      values.push(sink.value)
    })
    expect(values).toEqual([3])
    expect(calls).toEqual({ left: 1, right: 1, sink: 1 })
    source.value = 1
    runtime.flush()
    expect(values).toEqual([3, 5])
    expect(calls).toEqual({ left: 2, right: 2, sink: 2 })
    runtime.batch(() => {
      source.value = 2
      source.value = 3
    })
    expect(values).toEqual([3, 5, 9])
    expect(calls).toEqual({ left: 3, right: 3, sink: 3 })
    effect.dispose()
    sink.dispose()
    left.dispose()
    right.dispose()
    source.dispose()
  })

  it('keeps static notifications untracked and consumes callback reentrant writes once', () => {
    /** The extension's static subscription is the same public seam used by store adapters. */
    const runtime = internalRuntimeOf(createRuntime())
    /** This node is the observer's one declared source. */
    const source = runtime.signal(0)
    /** Callback-only reads must never become additional dependency edges. */
    const incidental = runtime.signal(0)
    /** Stable notifications must reuse the admitted source rather than resolve it again. */
    let resolutions = 0
    /** Values are recorded before the callback's own reentrant write. */
    const values: number[] = []
    /** The stable source object keeps node identity and its tracked read together. */
    const selected = { node: source, read: () => source.value }
    /** Callback writes must commit the post-callback source version without another notification. */
    const observer = createStaticObserver(
      runtime,
      () => {
        resolutions++
        return selected
      },
      () => {
        void incidental.value
        values.push(source.peek())
        if (source.peek() === 1) source.value = 2
      }
    )
    expect(resolutions).toBe(1)
    source.value = 1
    runtime.flush()
    expect(values).toEqual([1])
    expect(source.peek()).toBe(2)
    expect(source.subs.size).toBe(1)
    expect(incidental.subs.size).toBe(0)
    incidental.value = 1
    runtime.flush()
    expect(values).toEqual([1])
    source.value = 3
    runtime.flush()
    expect(values).toEqual([1, 3])
    expect(resolutions).toBe(1)
    observer.dispose()
    observer.dispose()
    expect(source.subs.size).toBe(0)
    source.value = 4
    runtime.flush()
    expect(values).toEqual([1, 3])
    source.dispose()
    incidental.dispose()
  })

  it('reconnects an invalidated static route and notifies even when its replacement value is equal', () => {
    /**
     * Route invalidation uses the existing extension operation rather than disposing and recreating
     * the observer.
     */
    const runtime = internalRuntimeOf(createRuntime())
    /** The original route stays readable after its downstream edge is invalidated. */
    const original = runtime.signal(1)
    /** Equal values still require notification because graph identity changed. */
    const replacement = runtime.signal(1)
    /** Resolver selection changes only after the initial route is admitted. */
    let selected = original
    /** Resolution count distinguishes invalidation admission from stable-source ticks. */
    let resolutions = 0
    /** Every delivered callback reads the currently resolved route. */
    const values: number[] = []
    /** The observer must reconnect through its normal forced-resolution path. */
    const observer = createStaticObserver(
      runtime,
      () => {
        resolutions++
        return { node: selected, read: () => selected.value }
      },
      () => {
        values.push(selected.peek())
      }
    )
    expect(original.subs.size).toBe(1)
    selected = replacement
    invalidateObservable(runtime, original)
    runtime.flush()
    expect(values).toEqual([1])
    expect(resolutions).toBe(2)
    expect(original.subs.size).toBe(0)
    expect(replacement.subs.size).toBe(1)
    replacement.value = 2
    runtime.flush()
    expect(values).toEqual([1, 2])
    expect(resolutions).toBe(2)
    observer.dispose()
    observer.dispose()
    expect(replacement.subs.size).toBe(0)
    original.dispose()
    replacement.dispose()
  })
})
