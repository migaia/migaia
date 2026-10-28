/** ConfigOwner scoped watchers, commit-local comparisons and synchronous failure reporting. */
import type { IConfigRecord, IOwnedConfig } from './config-contract.ts'
import type { IConfigDiffEntry } from '../config-owner.ts'
import { rawAt } from './config-owner-path.ts'
import { readConfigPath } from './config-path.ts'
import { readonlyConfig } from './config-readonly.ts'
import { collectDiff } from './config-owner-diff.ts'

/** One registered watch listener; `path` is absent for root listeners. */
type IConfigWatcher = {
  readonly path: readonly string[] | undefined
  readonly listener: (next: unknown, prev: unknown) => void
}

/** Watch registrations and one notification own their complete listener/cache lifetime. */
export class ConfigWatchers {
  /** Registration order is stable; removal releases the listener and its path. */
  readonly #entries = new Set<IConfigWatcher>()
  /** Listener failure policy is fixed at owner construction. */
  readonly #report: (error: unknown) => void
  /** Reporter method calls retain the original ConfigOwner receiver after state extraction. */
  readonly #reportReceiver: object
  /** Reentrant writes are rejected while this owner is delivering a commit. */
  #notifying = false
  /** Capture the owner's report policy without registering resources. */
  constructor(report: (error: unknown) => void, reportReceiver: object) {
    this.#report = report
    this.#reportReceiver = reportReceiver
  }
  /** Exposes notification state only to the owning ConfigOwner write admission. */
  get notifying(): boolean {
    return this.#notifying
  }
  /** Register one entry; its detached disposer deletes that exact entry idempotently. */
  add(
    path: readonly string[] | undefined,
    listener: (next: unknown, prev: unknown) => void
  ): () => void {
    /** Identity serves as the O(1) removal key for this one subscription. */
    const watcher: IConfigWatcher = { path, listener }
    this.#entries.add(watcher)
    return () => {
      this.#entries.delete(watcher)
    }
  }
  /** Runs watchers once per commit; failures are reported and never stop the other watchers. */
  notify(previous: IOwnedConfig<IConfigRecord>, next: IOwnedConfig<IConfigRecord>): void {
    if (this.#entries.size === 0) return
    /** Completed branch comparisons are shared only within this commit, never across notifications. */
    const comparisons = new WeakMap<object, WeakMap<object, boolean>>()
    this.#notifying = true
    try {
      // Snapshot so watchers added during notification wait for the next commit.
      for (const watcher of Array.from(this.#entries)) {
        if (!this.#entries.has(watcher)) continue
        try {
          if (watcher.path === undefined) {
            watcher.listener(readonlyConfig(next), readonlyConfig(previous))
            continue
          }
          /** Raw values on each side of the commit. */
          const before = rawAt(previous, watcher.path)
          /** Read the next snapshot only after the corresponding previous value was observed. */
          const after = rawAt(next, watcher.path)
          /** Object-only identity keys leave primitive Object.is semantics, including signed zero. */
          const objects =
            before.value !== null &&
            typeof before.value === 'object' &&
            after.value !== null &&
            typeof after.value === 'object'
          /** A prior listener may already have compared this exact immutable branch pair. */
          const previousComparisons = objects ? comparisons.get(before.value as object) : undefined
          /** Undefined is a cache miss; both changed and unchanged comparisons are reusable. */
          let changed = previousComparisons?.get(after.value as object)
          if (changed === undefined) {
            /** Only a completed comparison is cached; thrown failures retain per-listener reporting. */
            const changes: IConfigDiffEntry[] = []
            if (before.found !== after.found) changes.push({ path: watcher.path, kind: 'changed' })
            else collectDiff(before.value, after.value, watcher.path, changes)
            changed = changes.length > 0
            if (objects) {
              /**
               * The same left branch can be paired with several independently selected right
               * branches.
               */
              const results = previousComparisons ?? new WeakMap<object, boolean>()
              results.set(after.value as object, changed)
              comparisons.set(before.value as object, results)
            }
          }
          if (!changed) continue
          watcher.listener(
            readWatchedValue(next, watcher.path),
            readWatchedValue(previous, watcher.path)
          )
        } catch (error) {
          Reflect.apply(this.#report, this.#reportReceiver, [error])
        }
      }
    } finally {
      this.#notifying = false
    }
  }
}

/** Project one path after a difference was found, preserving next-before-previous read order. */
function readWatchedValue(snapshot: IOwnedConfig<IConfigRecord>, path: readonly string[]): unknown {
  /** A missing path stays distinct until the listener's existing undefined projection. */
  const result = readConfigPath(snapshot, path)
  return result.kind === 'value' ? result.value : undefined
}
