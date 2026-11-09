import { getPluginRuntimeIntegration, type IPluginRuntimeSharedSlot } from './core.ts'
import { reportTerminalFailure } from './diagnostic-report.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'
import { FeatureOverlayText } from './feature-overlay-text.ts'

import {
  FeatureOverlay as CompiledFeatureOverlay,
  type IFeatureOverlayEntry,
  type IFeatureOverlaySelection,
  type IFeatureOverlayRole
} from './feature-overlay.ts'
/** Notification entry accepts only genuine native installation lifetime/cleanup authority. */
export type IFeatureOverlayOwner = Pick<IPluginHostCore, 'lifecycle' | 'onDispose'>
/** Each consumer owns its compiled result through this cold callback. */
type IFeatureOverlayConsumer<T> = {
  readonly local: readonly IFeatureOverlaySelection<T>[]
  readonly accept: (entries: readonly IFeatureOverlayEntry<T>[]) => void
  published: boolean
}
/** The native shared slot holds only original lifetime receipt identity. */
type IFeatureOverlayReceipt = Readonly<{ signal: object }>

/** Cold composition borrows native publication/rollback; hot paths read consumer-owned caches. */
export class FeatureOverlay<T> extends CompiledFeatureOverlay<T> {
  /** Host ingress/default cache optionally consumes the same published global result. */
  readonly #onChange: ((entries: readonly IFeatureOverlayEntry<T>[]) => void) | undefined
  /** One private key borrows the canonical native shared-slot owner without a public alias. */
  readonly #key = Symbol(FeatureOverlayText.slot)
  /** Only pending native receipts belong here; rule data stays solely in the light owner. */
  readonly #pendingGlobals = new Set<object>()
  /** Consumer callbacks hold only cold compilation state, never a parallel lifecycle. */
  readonly #consumers = new Map<object, IFeatureOverlayConsumer<T>>()
  /** The first native commit in a batch drains all prepared receipts once. */
  #pending = 0
  /** Native diagnostic policy is borrowed from the installing Host. */
  #report: ((error: unknown) => void) | undefined

  /** Capture role projection and an optional host-default cache compiler. */
  constructor(
    roleOf: (value: T) => IFeatureOverlayRole,
    onChange?: (entries: readonly IFeatureOverlayEntry<T>[]) => void
  ) {
    super(roleOf)
    this.#onChange = onChange
  }

  /** Reserve complete global data, then let the existing native receipt publish or roll it back. */
  provide(core: IFeatureOverlayOwner, values: readonly IFeatureOverlayEntry<T>[]): void {
    if (values.length === 0) return
    /** Original registration signal, not a fabricated transaction token. */
    const signal = core.lifecycle.signal
    super.prepare(signal, values)
    this.#pendingGlobals.add(signal)
    this.#pending += 1
    this.#enlist(core, signal)
  }

  /** Publish a local cache only when its own original installation commits successfully. */
  consume(
    core: IFeatureOverlayOwner,
    local: readonly IFeatureOverlaySelection<T>[],
    accept: (entries: readonly IFeatureOverlayEntry<T>[]) => void
  ): void {
    /** Borrow the actual native lifetime; local containers are copied only at this cold boundary. */
    const signal = core.lifecycle.signal
    this.#consumers.set(signal, { local: Object.freeze([...local]), accept, published: false })
    this.#pending += 1
    this.#enlist(core, signal)
  }

  /** Register with the existing native publication and onDispose owners; no transaction is created. */
  #enlist(core: IFeatureOverlayOwner, signal: object): void {
    try {
      /** Genuine core provenance is enforced by the canonical integration owner. */
      const integration = getPluginRuntimeIntegration(core)
      this.#report = integration.report
      core.onDispose(() => this.#remove(signal))
      /** Private facade exists solely to reuse the canonical publication receipt. */
      const slot = integration.acquireSharedSlot(this.#key, this, () => this)
      slot.register(Object.freeze({ signal }), () => this.#publish(slot))
    } catch (error) {
      this.#remove(signal)
      throw error
    }
  }

  /** Activate every committed receipt once, so observers see the entire committed batch. */
  #publish(slot: IPluginRuntimeSharedSlot<this>): void {
    if (this.#pending === 0) return
    /** Newly installed local consumers need exactly one initial compilation. */
    const fresh = new Set<object>()
    /** One changed global layer recompiles every already-published consumer once. */
    let changed = false
    for (const value of slot.registered()) {
      /** Metadata is issued only by this overlay into its private family slot. */
      const signal = (value as IFeatureOverlayReceipt).signal
      if (this.#pendingGlobals.delete(signal)) {
        changed = super.commit(signal) || changed
        this.#pending -= 1
      }
      /** Consumers from the same batch see all of its committed global contributions. */
      const consumer = this.#consumers.get(signal)
      if (consumer && !consumer.published) {
        consumer.published = true
        this.#pending -= 1
        fresh.add(signal)
      }
    }
    this.#notify(changed, fresh)
  }

  /** Release reservations through the same native cleanup receipt; rollback publishes nothing. */
  #remove(signal: object): void {
    /** Prepared receipts have no visible withdrawal and consume their pending marker once. */
    if (this.#pendingGlobals.delete(signal)) this.#pending -= 1
    /** Retired consumer callbacks cannot observe future global changes. */
    const consumer = this.#consumers.get(signal)
    this.#consumers.delete(signal)
    if (consumer && !consumer.published) this.#pending -= 1
    if (super.remove(signal)) this.#notify(true)
  }

  /** Cold propagation charges each consumer's inherited/local input plus its callback work. */
  #notify(changed: boolean, fresh?: ReadonlySet<object>): void {
    if (changed && this.#onChange) this.#accept(this.#onChange, this.compile())
    for (const [signal, consumer] of this.#consumers)
      if (consumer.published && (changed || fresh?.has(signal)))
        this.#accept(consumer.accept, this.compile(consumer.local))
  }

  /** A failed observer is reported without withholding other consumers' committed notification. */
  #accept(
    accept: (entries: readonly IFeatureOverlayEntry<T>[]) => void,
    entries: readonly IFeatureOverlayEntry<T>[]
  ): void {
    try {
      accept(entries)
    } catch (error) {
      try {
        if (this.#report) this.#report(error)
        else reportTerminalFailure(error)
      } catch (failure) {
        reportTerminalFailure(failure, this.#report)
      }
    }
  }
}

export type {
  IFeatureOverlayEntry,
  IFeatureOverlaySelection,
  IFeatureOverlayRole
} from './feature-overlay.ts'
