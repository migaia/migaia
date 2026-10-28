/** Owns bounded idle-pool membership and refill policy; entries own their resources. */
import { OutcomeKind } from '../text.ts'
import { PROCESS_KIND, ProcessField } from './text.ts'
import { IsolationMode } from '../index.ts'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import { admitCapabilities } from '../admission.ts'
import { processRequirements, validateCapabilityDeclaration } from './capabilities.ts'
import { invalidProcessOption, validateProcessSpec } from './spec.ts'
import { PrewarmEntry, type IPrewarmContext } from './prewarm-entry.ts'
import type {
  IPrewarmEntry,
  IPrewarmPool,
  IPrewarmPoolOptions,
  IProcessHandle,
  IProcessRegistry
} from './types.ts'
import { validateUsageOptions } from './usage-monitor.ts'

/** Provenance of an already-owned record; it does not create or duplicate the durable record. */
type IPrewarmRecordOwner = Readonly<{ id: string; port: IProcessRegistry; namespace: string }>
/** Only entries produced by a real pool can reuse that pool's existing record at adoption. */
const prewarmRecordOwners = new WeakMap<IPrewarmEntry<IProcessHandle>, IPrewarmRecordOwner>()

/** Reads private record handoff metadata without adding a public pool or entry capability. */
export function readPrewarmRecordOwner(
  entry: IPrewarmEntry<IProcessHandle>
): IPrewarmRecordOwner | undefined {
  return prewarmRecordOwners.get(entry)
}

/**
 * Keeps `size` idle processes started ahead of time so a supervisor can take one instead of
 * spawning.
 *
 * The pool must share the same budget, launcher and spec objects with the supervisor that takes
 * from it, and every idle process holds a budget slot. Taking hands over the handle and its lease;
 * the supervisor still runs its own readiness check. Idle processes are ended after `idleTimeoutMs`
 * (default 60000). The pool has no restart policy of its own; it only refills toward its size.
 */
export function createPrewarmPool<THandle extends IProcessHandle>(
  options: IPrewarmPoolOptions<THandle>
): IPrewarmPool<THandle> {
  validatePrewarmOptions(options)
  return PrewarmPool.port(new PrewarmPool(options))
}

/** Rejects invalid construction before any budget lease or native unit is acquired. */
function validatePrewarmOptions<THandle extends IProcessHandle>(
  options: IPrewarmPoolOptions<THandle>
): void {
  validateProcessSpec(options.spec)
  validateCapabilityDeclaration(options.launcher.capabilities)
  validateUsageOptions(options.usage)
  if (options.budget.kind !== PROCESS_KIND) invalidProcessOption(ProcessField.budget)
  if (!Number.isSafeInteger(options.size) || options.size < 0)
    invalidProcessOption(ProcessField.size, true)
  if (typeof options.report !== 'function') invalidProcessOption(ProcessField.report)
  if (
    options.registry &&
    (typeof options.launcher.probe !== 'function' ||
      typeof options.launcher.terminateRecord !== 'function')
  )
    invalidProcessOption(ProcessField.registry)
  admitCapabilities(
    [...processRequirements(options.spec), ...(options.requires ?? [])],
    options.launcher.capabilities,
    options.isolation ?? IsolationMode.required,
    PROCESS_KIND
  )
}

/** Owns entry membership; all unit-specific lifecycle behavior lives in PrewarmEntry. */
class PrewarmPool<THandle extends IProcessHandle> {
  /** Shared admitted options and resolved timing ports are immutable for the pool lifetime. */
  #context: IPrewarmContext<THandle>
  /** Ready entries preserve first-ready iteration order for take. */
  #idle = new Set<PrewarmEntry<THandle>>()
  /** Starting entries count toward size and leave on readiness or retirement. */
  #starting = new Set<PrewarmEntry<THandle>>()
  /** Outstanding retirements remain joinable even after membership is removed. */
  #retiring = new Set<Promise<void>>()
  /** Closing is synchronous so reentrant callbacks cannot start replacement units. */
  #closed = false
  /** Disposal preserves exact Promise identity across repeated calls. */
  #disposePromise?: Promise<void>

  /** Resolves scheduler before timeout validation, matching the baseline failure order. */
  constructor(options: IPrewarmPoolOptions<THandle>) {
    this.#context = {
      options,
      scheduler: resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler),
      wallClock: options.wallClock ?? systemWallClock,
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
      idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
      exitTimeoutMs: options.exitTimeoutMs ?? 5_000,
      reapTimeoutMs: options.reapTimeoutMs ?? 5_000
    }
    // Exactly four timeout fields, fixed by the pool option contract.
    for (const [field, value] of Object.entries({
      startupTimeoutMs: this.#context.startupTimeoutMs,
      idleTimeoutMs: this.#context.idleTimeoutMs,
      exitTimeoutMs: this.#context.exitTimeoutMs,
      reapTimeoutMs: this.#context.reapTimeoutMs
    }))
      if (!Number.isFinite(value) || value < 0) invalidProcessOption(field, true)
    this.#refill()
  }

  /** Entries read closure state through their explicit pool owner. */
  get closed(): boolean {
    return this.#closed
  }

  /** Keeps the original own accessor, method order, mutability and detached-call behavior. */
  static port<THandle extends IProcessHandle>(pool: PrewarmPool<THandle>): IPrewarmPool<THandle> {
    const { options } = pool.#context
    return {
      id: options.id,
      spec: options.spec,
      budget: options.budget,
      launcher: options.launcher,
      get idle() {
        return pool.#idle.size
      },
      take: () => pool.#take(),
      invalidate: () => pool.#invalidate(),
      dispose: () => pool.#dispose()
    }
  }

  /** Membership is removed synchronously before entry cancellation can reenter the pool. */
  remove(entry: PrewarmEntry<THandle>): void {
    this.#idle.delete(entry)
    this.#starting.delete(entry)
  }

  /** Startup enters idle only after durable registration and sampling admission. */
  admit(entry: PrewarmEntry<THandle>): void {
    this.#starting.delete(entry)
    this.#idle.add(entry)
  }

  /** The original finally observer removes each settled cleanup task from the join set. */
  track(task: Promise<void>): void {
    this.#retiring.add(task)
    void task.finally(() => this.#retiring.delete(task))
  }

  /** Adds one idle unit using only immediate nonqueuing admission. */
  #spawnOne(): boolean {
    /** Rejected admission never creates an entry or consumes pending queue capacity. */
    const grant = this.#context.options.budget.tryAcquire()
    if (grant.kind === OutcomeKind.rejected) return false
    /** One named entry owns the same controller and lifecycle resources as the baseline. */
    const entry = new PrewarmEntry(this.#context, this, grant.lease)
    this.#starting.add(entry)
    entry.start()
    return true
  }

  /** Refills only after construction, take, or explicit invalidation. */
  #refill(): void {
    if (this.#closed) return
    while (this.#idle.size + this.#starting.size < this.#context.options.size)
      if (!this.#spawnOne()) break
  }

  /** Transfers the oldest ready entry and only then refills toward the configured size. */
  #take(): IPrewarmEntry<THandle> | undefined {
    if (this.#closed) return undefined
    /** Insertion order is readiness order; lookup does not scan entries. */
    const entry = this.#idle.values().next().value
    if (!entry) {
      this.#refill()
      return undefined
    }
    this.#idle.delete(entry)
    /** Handoff detaches monitors and exit-owned resources before exposing the public entry. */
    const result = entry.take()!
    const { options } = this.#context
    if (entry.record && options.registry)
      prewarmRecordOwners.set(result, {
        id: options.id,
        port: options.registry.port,
        namespace: entry.record.namespace
      })
    this.#refill()
    return result
  }

  /** Snapshot semantics preserve the original membership during reentrant cleanup. */
  #retireAll(): Promise<void>[] {
    return [...this.#idle, ...this.#starting].map((entry) => entry.retire())
  }

  /** Explicit invalidation joins current entries before starting replacements. */
  #invalidate(): void {
    if (this.#closed) return
    /** The complete current batch is retired exactly once before refill. */
    const tasks = this.#retireAll()
    void Promise.all(tasks).then(() => this.#refill())
  }

  /** Closing freezes refill synchronously and shares the original all-retirements join. */
  #dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#closed = true
    /** Include both newly retired entries and previously outstanding cleanup. */
    const tasks = this.#retireAll()
    this.#disposePromise = Promise.all([...tasks, ...this.#retiring]).then(ignoreResult)
    return this.#disposePromise
  }
}

/** Preserves the original value-discarding Promise fulfillment stage. */
function ignoreResult(): void {}
