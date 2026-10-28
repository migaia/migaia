/**
 * Owns one capability's activation generation, captured handle and cleanup diagnostics. Host entry
 * transitions reuse lifecycle generations and host-owned quiescence; this module does not own flags
 * or choose batch release order.
 */
import {
  containAsyncRejection,
  createGenerationController,
  type IGenerationToken
} from '@migaia/lifecycle'
import type {
  ICapabilityDefinition,
  ICapabilityEnableResult,
  ICapabilityHandle,
  ICapabilityState
} from './index.ts'
import { asHostCleanupPromise, snapshotHostDisposer } from './host-admission.ts'
import { CapabilityEnableStatus, CapabilityState } from './state-constants.ts'

/** Explicit host services used by entries; resource state never lives in captured factory locals. */
export type IHostEntryOwner<Context> = {
  readonly context: Context
  readonly allowed: (name: string) => boolean
  readonly reportError: (name: string, error: unknown) => void
  readonly transition: <T>(operation: () => T) => T
  readonly trackPending: <T>(entry: CapabilityEntry<Context>, promise: Promise<T>) => void
  readonly activated: (entry: CapabilityEntry<Context>) => void
  readonly deactivated: (name: string) => void
}

/** Single resource owner for one registration, retained for terminal read-only diagnostics. */
export class CapabilityEntry<Context> {
  /** Registration snapshot preserves activation identity and its immutable method receiver. */
  readonly #definition: ICapabilityDefinition<Context>
  /** Explicit host services share flags, transition admission, ordering and pending accounting. */
  readonly #owner: IHostEntryOwner<Context>
  /** Lifecycle owns generation invalidation and stale-result adoption. */
  readonly #generations = createGenerationController()
  /** Current lifecycle diagnostic remains separate from allowlist permission. */
  #state: ICapabilityState
  /** Current adopted handle, cleared before user cleanup may reenter diagnostics. */
  #handle: ICapabilityHandle | undefined
  /** Disposer is captured once at adoption; later handle mutation cannot replace ownership. */
  #disposer: ICapabilityHandle['dispose'] | undefined
  /** Current activation or applicable cleanup failure remains observable after disposal. */
  #error: unknown
  /** Canonical in-flight activation result is published before invoking activation. */
  #pending: Promise<ICapabilityEnableResult> | undefined

  /** Allocate generation ownership only after definition admission and duplicate lookup succeed. */
  constructor(definition: ICapabilityDefinition<Context>, owner: IHostEntryOwner<Context>) {
    this.#definition = definition
    this.#owner = owner
    this.#state = owner.allowed(definition.name) ? CapabilityState.off : CapabilityState.gated
  }

  /** Captured identity is unaffected by caller mutation of the registration definition. */
  get name(): string {
    return this.#definition.name
  }
  /** Read lifecycle state without asserting host admission. */
  get state(): ICapabilityState {
    return this.#state
  }
  /** Expose the original adopted handle, never a wrapper or superseded result. */
  get handle(): ICapabilityHandle | undefined {
    return this.#handle
  }
  /** Read retained failure identity without triggering cleanup or changing state. */
  get error(): unknown {
    return this.#error
  }

  /** Start or join this entry's canonical activation after host-level admission succeeds. */
  enable(): Promise<ICapabilityEnableResult> {
    if (!this.#owner.allowed(this.name)) {
      this.#state = CapabilityState.gated
      this.#error = undefined
      return Promise.resolve({ status: CapabilityEnableStatus.gated })
    }
    if (this.#state === CapabilityState.on)
      return Promise.resolve({ status: CapabilityEnableStatus.enabled })
    if (this.#pending) return this.#pending
    const { generation, token } = this.#generations.begin()
    this.#state = CapabilityState.activating
    this.#error = undefined
    /** Resolver settles the published result once, independently of subsequent activation attempts. */
    let resolvePending!: (result: ICapabilityEnableResult) => void
    /** Publish before user activation can synchronously begin host disposal. */
    const pending = new Promise<ICapabilityEnableResult>((resolve) => {
      resolvePending = resolve
    })
    this.#pending = pending
    this.#owner.trackPending(this, pending)
    void this.#activate(token, generation).then(resolvePending, (error: unknown) =>
      resolvePending({ status: CapabilityEnableStatus.failed, error })
    )
    return pending
  }

  /** Reconcile only this entry after its permission changes; all flags are already published. */
  reconcile(): void {
    if (!this.#owner.allowed(this.name)) {
      if (this.#state !== CapabilityState.gated) this.deactivate()
    } else if (this.#state === CapabilityState.gated) {
      this.#state = CapabilityState.off
      this.#error = undefined
    }
  }

  /** Revoke current generation and handle synchronously; the host separately waits for pending work. */
  deactivate(): boolean {
    this.#generations.supersede()
    this.#pending = undefined
    /** Return value records enabled ownership before the revocation changes diagnostics. */
    const wasOn = this.#state === CapabilityState.on
    this.#state = this.#owner.allowed(this.name) ? CapabilityState.off : CapabilityState.gated
    this.#error = undefined
    this.#owner.deactivated(this.name)
    this.#releaseHandle()
    return wasOn
  }

  /** Close generation admission while containing cancellation failures for remaining host entries. */
  disposeGeneration(): void {
    try {
      this.#generations.dispose()
    } catch (error) {
      this.#recordDisposeFailure(error)
    } finally {
      this.#pending = undefined
    }
  }

  /** Release this terminal entry when chosen by host LIFO order, preserving cleanup containment. */
  disposeHandle(): void {
    try {
      this.#releaseHandle()
    } catch (error) {
      this.#recordDisposeFailure(error)
    } finally {
      this.#state = CapabilityState.off
    }
  }

  /** Complete terminal diagnostics after the host has released every active handle. */
  finishDisposal(): void {
    this.#state = CapabilityState.off
  }

  /** Resolve one attempt, releasing stale results through the same captured-disposer path. */
  async #activate(token: IGenerationToken, generation: number): Promise<ICapabilityEnableResult> {
    try {
      /** User resource retains exact identity, including handles arriving after cancellation. */
      const handle = await this.#definition.activate(this.#owner.context)
      /** Single-read admission rejects invalid getters before any adoption or order insertion. */
      const disposer = snapshotHostDisposer(handle, this.name)
      /** Lifecycle owns stale-token release; the host release method contains cleanup failures. */
      const adopted = this.#generations.adopt(token, handle, (adoptedHandle) =>
        this.#release(adoptedHandle, generation, disposer)
      )
      if (!adopted) return this.#supersededResult()
      this.#handle = handle
      this.#disposer = disposer
      this.#state = CapabilityState.on
      this.#owner.activated(this)
      return { status: CapabilityEnableStatus.enabled }
    } catch (error) {
      /** Superseded failures report without overwriting a replacement activation's state. */
      const current = this.#generations.isCurrent(token)
      if (current) {
        this.#state = CapabilityState.failed
        this.#error = error
      }
      this.#owner.reportError(this.name, error)
      return current ? { status: CapabilityEnableStatus.failed, error } : this.#supersededResult()
    } finally {
      if (this.#generations.isCurrent(token)) this.#pending = undefined
    }
  }

  /** Classify supersession at settlement so every caller sharing the attempt sees one outcome. */
  #supersededResult(): ICapabilityEnableResult {
    return this.#state === CapabilityState.gated
      ? { status: CapabilityEnableStatus.gated }
      : { status: CapabilityEnableStatus.cancelled }
  }

  /** Detach ownership before invoking user release; recursive diagnostics cannot observe a handle. */
  #releaseHandle(): void {
    /** Preserve exact old handle until its captured disposer has been invoked. */
    const handle = this.#handle
    /** Getter was read at adoption, so cleanup cannot reread a replaced hostile getter. */
    const disposer = this.#disposer
    this.#handle = undefined
    this.#disposer = undefined
    if (handle) this.#release(handle, this.#generations.generation, disposer)
  }

  /** Keep user cleanup under host transition admission while preserving report-and-resolve policy. */
  #release(
    handle: ICapabilityHandle,
    generation: number,
    disposer?: ICapabilityHandle['dispose']
  ): void {
    this.#owner.transition(() => this.#invokeRelease(handle, generation, disposer))
  }

  /** Invoke once with the handle receiver and track returned cleanup without replacing failures. */
  #invokeRelease(
    handle: ICapabilityHandle,
    generation: number,
    disposer?: ICapabilityHandle['dispose']
  ): void {
    try {
      /** Captured callable wins; fallback retains original behavior for a missing captured method. */
      const releaseDisposer = disposer ?? handle.dispose
      /** Nominal-void methods may return thenables that still need cleanup ownership. */
      const result: unknown = Reflect.apply(releaseDisposer, handle, [])
      /** Shared admission reads a then getter once and propagates its exact failure. */
      const thenable = asHostCleanupPromise(result)
      if (thenable) {
        /** Failure is reported before this tracked cleanup settles, matching host drain semantics. */
        const pending = thenable.then(
          () => undefined,
          (error) => this.#recordCleanupFailure(error, generation)
        )
        this.#owner.trackPending(this, pending)
      }
      if (!thenable)
        containAsyncRejection(result, (error) => this.#recordCleanupFailure(error, generation))
    } catch (error) {
      this.#recordCleanupFailure(error, generation)
    }
  }

  /** Retain applicable cleanup failures without poisoning a newer healthy generation. */
  #recordCleanupFailure(error: unknown, generation: number): void {
    /** A single revocation may still retain failure when no replacement attempt exists. */
    const inactiveWithoutReplacement =
      (this.#state === CapabilityState.gated || this.#state === CapabilityState.off) &&
      this.#pending === undefined &&
      this.#handle === undefined
    if (
      generation === this.#generations.generation ||
      (this.#generations.generation === generation + 1 && inactiveWithoutReplacement)
    )
      this.#error = error
    this.#owner.reportError(this.name, error)
  }

  /** Disposal failures stay observable while allowing every remaining entry to converge to off. */
  #recordDisposeFailure(error: unknown): void {
    this.#error = error
    this.#owner.reportError(this.name, error)
  }
}
