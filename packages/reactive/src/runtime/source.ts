import { internalsOf } from './internals.js'
import { claimOwnership } from './ownership.js'
import type { IObservable, IObserver, IRuntime } from './types.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

type IRuntimeFieldSource = {
  track(): void
  notify(): void
  commit<T>(write: () => T): T
  readonly observed: boolean
  readonly disposed: boolean
  dispose(): void
}

/**
 * Creates a controlled source for extension layers.
 *
 * Callers receive `track`, `notify`, `commit`, `dispose`, and read-only observation and disposal
 * state. The node, `subs`, `version`, and tracker stay private. Callers cannot create one-sided
 * edges, fabricate versions, or notify another runtime's graph.
 */
export function createFieldSource(runtime: IRuntime, debugName?: string): IRuntimeFieldSource {
  const node: IObservable = {
    runtime,
    debugName,
    subs: new Set<IObserver>(),
    version: internalsOf(runtime).clock.next()
  }
  claimOwnership(node, runtime)
  let disposed = false

  const assertActive = (): void => {
    if (disposed)
      throw createReactiveError(
        ReactiveErrorCode.nodeDisposed,
        ReactiveErrorText.disposedFieldSource
      )
  }

  return {
    track() {
      assertActive()
      internalsOf(runtime).tracker.track(node)
    },
    notify() {
      assertActive()
      internalsOf(runtime).notify(node)
    },
    commit<T>(write: () => T): T {
      assertActive()
      return internalsOf(runtime).commitSource(node, write)
    },
    get observed() {
      return !disposed && node.subs.size > 0
    },
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      internalsOf(runtime).tracker.disconnectObservable(node, 'dispose')
    }
  }
}
