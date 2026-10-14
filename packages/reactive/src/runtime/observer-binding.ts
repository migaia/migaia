import type { ICapture } from './dependency-tracker.class.js'
import { internalsOf } from './internals.js'
import type { IDisposer, IReactiveNodeOptions, IRuntime } from './types.js'
import { Effect } from '../reactive/effect.class.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

/**
 * Outcome of a capture commit.
 *
 * - `committed`: dependency edges are installed.
 * - `stale`: dependencies change after capture; the token is consumed and requires a fresh capture.
 * - `no-observer`: the target does not exist yet; the token remains reusable when the observer is
 *   ready.
 */
export type IObserverCommitResult = 'committed' | 'stale' | 'no-observer'
export type IObserverRetrackResult = 'changed' | 'unchanged' | 'no-observer'

/**
 * Public interface for capture, observation, and commit.
 *
 * Concurrent host adapters capture dependencies read-only during render and install them during
 * commit. React can discard an intermediate render, so capture cannot create edges. Dependencies
 * can change before commit, so commit can fail and request a fresh capture.
 *
 * This replaces privileged access to `runtime/internals` in the repository's React adapter.
 * Third-party Vue, Solid, Svelte, or React adapters can use the same concurrent-safe path without
 * creating edges at subscription time and reopening the tearing window.
 *
 * `capture` records reads and versions without creating edges, enqueueing work, or changing
 * versions. `ICapture` is an opaque branded token whose dependencies stay in the tracker's private
 * WeakMap. Token holders cannot inspect those dependencies or modify versions. `commit` installs
 * the token only on this binding's observer, never on another observer or as a one-sided edge.
 */
export type IObserverBinding = {
  /**
   * Captures dependencies during render.
   *
   * Records the nodes read and their versions without creating dependency edges. Discarded renders
   * therefore leave no subscriptions.
   */
  capture<R>(read: () => R): ICapture<R>
  /**
   * Install the binding-owned observer. Keeping the concrete Effect private prevents adapters from
   * mutating deps/versions or calling run/markDirty.
   */
  observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer
  /**
   * Installs captured dependencies during commit.
   *
   * Three outcomes distinguish a required fresh capture from a missing observer. Invalidate the
   * snapshot and reread only for `stale`. Do not pull dirty nodes during commit, because evaluation
   * errors would bypass the Error Boundary.
   */
  commit(capture: ICapture<unknown>): IObserverCommitResult
  /** Force one committed observer run and report whether its dependency set changed. */
  retrack(): IObserverRetrackResult
}

/**
 * Creates a binding for one observer.
 *
 * Capture runs during render; the observer exists only during host subscription. The binding owns
 * its `Effect` and exposes `capture`, `observe`, `commit`, and `retrack`. Adapters cannot access
 * dependencies, versions, or forced scheduling ports.
 */
export function createObserverBinding(runtime: IRuntime): IObserverBinding {
  const tracker = internalsOf(runtime).tracker
  let observer: Effect | undefined
  const dependenciesChanged = (
    before: ReadonlyMap<object, number>,
    after: ReadonlyMap<object, number>
  ): boolean => {
    if (before.size !== after.size) return true
    for (const [dependency, version] of after) {
      if (before.get(dependency) !== version) return true
    }
    return false
  }
  return {
    capture: (read) => tracker.capture(read),
    observe: (fn, options) => {
      if (observer && !observer.disposed) {
        throw createReactiveError(
          ReactiveErrorCode.bindingDuplicate,
          ReactiveErrorText.observerBindingAlreadyObserved
        )
      }
      const current = new Effect(fn, runtime, options)
      observer = current
      let active = true
      return () => {
        if (!active) return
        active = false
        current.dispose()
        if (observer === current) observer = undefined
      }
    },
    commit: (capture) => {
      const current = observer
      if (!current || current.disposed) return 'no-observer'
      return tracker.commitCapture(current, capture) ? 'committed' : 'stale'
    },
    retrack: () => {
      const current = observer
      if (!current || current.disposed) return 'no-observer'
      const before = new Map(current.depVersions)
      current.run()
      if (current.disposed) return 'no-observer'
      return dependenciesChanged(before, current.depVersions) ? 'changed' : 'unchanged'
    }
  }
}
