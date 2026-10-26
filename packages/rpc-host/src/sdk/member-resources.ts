/**
 * Owns reverse-acquisition cleanup groups and the shared preparation/release Promises for one
 * member. The supplied registration remains native generation authority; rollback retains primary
 * failures and transfers only acquired resources into the accepted generation lifetime.
 */
import { createGenerationController } from '@migaia/lifecycle'
import { deferred, raceWithAbort, type IAbortSignal } from '@migaia/utils/promise'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { createRemoteLayerError } from '../host/remote-error-owner.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import { memberAggregate } from './member-errors.js'
import type { IRpcMemberRegistration } from './member-types.js'

/** Original reverse-acquisition rollback groups transfer to exactly one accepted member generation. */
export class RpcMemberResources {
  /** Original registration remains the sole native generation and supervision authority. */
  readonly registration: IRpcMemberRegistration
  /** Cleanup diagnostics retain the caller's original bare reporter. */
  #report: (error: unknown) => void
  /** Native drain ownership may detach preparation cancellation only at genuine commit. */
  #detachPreparationOnCommit: boolean
  /** Departed generations release their resource groups rather than growing a lifetime stack. */
  #retained = new Set<Set<() => Promise<void>>>()
  /** Final removal shares its first settlement with every repeated PluginHost cleanup. */
  #releasePromise: Promise<void> | undefined
  /** Observers and public commands join one original preparation of the same native generation. */
  #pendingRebind: Promise<number> | undefined

  /** Capture the existing owner ports without opening or preparing a native generation. */
  constructor(
    registration: IRpcMemberRegistration,
    report: (error: unknown) => void,
    detachPreparationOnCommit: boolean
  ) {
    this.registration = registration
    this.#report = report
    this.#detachPreparationOnCommit = detachPreparationOnCommit
  }
  /** Close original group resources in reverse acquisition order, retaining exact errors. */
  #closeGroup = async (group: Set<() => Promise<void>>): Promise<unknown[]> => {
    const failures: unknown[] = []
    for (const dispose of [...group].reverse()) {
      try {
        await dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    group.clear()
    this.#retained.delete(group)
    return failures
  }

  /** Report cleanup beside its original preparation primary without replacing that primary. */
  #rollback = async (group: Set<() => Promise<void>>, primary: unknown): Promise<boolean> => {
    const failures = await this.#closeGroup(group)
    if (failures.length > 0)
      (0, this.#report)(
        memberAggregate([primary, ...failures], RpcRemoteLayerErrorCode.startFailed)
      )
    return failures.length > 0
  }

  /** Prepare one genuine generation and transfer only its actual acquired disposer group. */
  #prepare = async (
    signal: IAbortSignal,
    cleanupOnFailure: boolean,
    reportFailure: boolean,
    failureDecided?: (error: unknown) => void
  ): Promise<number> => {
    const group = new Set<() => Promise<void>>()
    this.#retained.add(group)
    /** The existing lifecycle controller separates one preparation from its committed channel. */
    const attempt = this.#detachPreparationOnCommit
      ? createGenerationController({ parentSignal: signal })
      : undefined
    /** Initial setup and later rebinds use the same canonical cancellation transfer. */
    const request = attempt?.begin()
    try {
      const generation = await this.registration.prepareGeneration(
        request?.signal ?? signal,
        (dispose) => {
          group.add(dispose)
        }
      )
      if (request) {
        if (request.signal.aborted) throw resolveAbortReason(request.signal)
        attempt!.complete(request.token)
      }
      /** One explicit entry owns both the accepted generation and its retained rollback group. */
      const entry = { generation, group }
      this.registration.onLeave(generation, () => {
        this.#releaseDepartedGroup(entry)
      })
      return generation
    } catch (error) {
      /** Preserve a native-first decision before rollback yields to a later caller cancellation. */
      if (!signal.aborted) failureDecided?.(error)
      if (cleanupOnFailure || this.#releasePromise) {
        const hadCleanupFailure = await this.#rollback(group, error)
        if (reportFailure && !hadCleanupFailure) (0, this.#report)(error)
      }
      throw error
    } finally {
      attempt?.dispose()
    }
  }

  /** A departed generation releases its retained group only after the original close completes. */
  #releaseDepartedGroup(entry: { generation: number; group: Set<() => Promise<void>> }): void {
    void this.registration.whenClosed(entry.generation).then(() => {
      entry.group.clear()
      this.#retained.delete(entry.group)
    })
  }

  /** Use original initial setup and explicit rollback policy before publication. */
  prepareInitial = (
    signal: IAbortSignal,
    rollbackOnFailure = false,
    failureDecided?: (error: unknown) => void
  ) => this.#prepare(signal, rollbackOnFailure, false, failureDecided)

  /** Caller cancellation releases only its wait; member lifetime alone owns shared preparation. */
  prepareRebind = (signal: IAbortSignal, callerSignal: IAbortSignal): Promise<number> => {
    if (callerSignal === signal) return this.#prepareRebind(signal)
    return raceWithAbort(() => this.#prepareRebind(signal), {
      signal: callerSignal,
      report: (error, context) => {
        /** The shared preparation already reports its failure; wait cleanup still owns its errors. */
        if (context.phase !== 'late-rejection') (0, this.#report)(error)
      }
    })
  }

  /** Join one preparation of the same original native generation without retargeting. */
  #prepareRebind = (signal: IAbortSignal): Promise<number> => {
    if (signal.aborted) return Promise.reject(resolveAbortReason(signal))
    if (this.#releasePromise)
      return Promise.reject(createRemoteLayerError(RpcRemoteLayerErrorCode.closed))
    if (this.#pendingRebind) return this.#pendingRebind
    /** An accepted generation already published its original pointer and outlet receipt. */
    const current = this.registration.current()
    if (current.active && current.generation === this.registration.observedGeneration())
      return Promise.resolve(current.generation)
    this.#pendingRebind = this.#prepare(signal, true, true).finally(() => {
      this.#pendingRebind = undefined
    })
    return this.#pendingRebind
  }

  /** Count only currently retained actual generation resources. */
  retainedResourceCount = () => [...this.#retained].reduce((count, group) => count + group.size, 0)

  /** Publish final cleanup before a registration leave callback can synchronously reenter. */
  release = (): Promise<void> => {
    if (this.#releasePromise) return this.#releasePromise
    /** The original holder owns one Promise through registration and remaining group cleanup. */
    const completion = deferred<void>()
    this.#releasePromise = completion.promise
    void this.#release().then(completion.resolve, completion.reject)
    return this.#releasePromise
  }
  /** Registration drain/retire runs before reverse cleanup of every still-pending candidate group. */
  async #release(): Promise<void> {
    /** Every cleanup failure remains ordered after its original registration failure. */
    const failures: unknown[] = []
    try {
      await this.registration.releaseRegistration()
    } catch (error) {
      failures.push(error)
    }
    for (const group of this.#retained) failures.push(...(await this.#closeGroup(group)))
    if (failures.length > 0) throw memberAggregate(failures, RpcRemoteLayerErrorCode.closed)
  }
}
