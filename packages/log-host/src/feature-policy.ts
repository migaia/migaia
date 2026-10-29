import {
  PluginHostError,
  PluginHostErrorCode,
  ERROR_TEXT,
  type IFeatureOutputs
} from '@migaia/plugin-host'
import type { ILogControlExtensions, ILogFeatureRecord, ILogPluginCore } from './typing.ts'
import type { ILogDomainCore } from './core.ts'
import type { LogHost } from './host.ts'
import { type IFeatureImplementation, type ILogFeatureRuntime } from './feature-metadata.ts'
import { logCoreOwner, FeaturePhase, LogDeliveryPolicy } from './state-constants.ts'
import { invalidOption } from './errors.ts'

/** Native installation supplies the exact implementations and the output's cold cache compiler. */
type IPolicyContribution = {
  readonly name: string
  readonly output: boolean
  readonly features: ReadonlyMap<string, IFeatureImplementation>
  configure?(defaults: ReadonlyMap<string, IFeatureImplementation>): void
}
/** Four package-owned slots are singular within each output after record-key overrides. */
type ISingularCounts = { format: number; batch: number; retry: number; timeout: number }
/** This fixed domain is independent of the number of plugins, outputs and feature aliases. */
const singularSlots = [
  FeaturePhase.format,
  LogDeliveryPolicy.batch,
  LogDeliveryPolicy.retry,
  LogDeliveryPolicy.timeout
] as const
/** A slot count records only formatter placement or a private built-in delivery identity. */
type ISingularSlot = (typeof singularSlots)[number]
/** Delta frequencies allow a host change to check all outputs without visiting unrelated outputs. */
type ISingularFrequencies = Record<ISingularSlot, Map<number, number>>
/** Local slots minus overridden host slots, combined with host counts, yield this output's counts. */
type IOutputProjection = { readonly contribution: IPolicyContribution; delta: ISingularCounts }
/**
 * Native signals identify the receipt; domain flags describe cache publication, not native
 * lifecycle.
 */
type IScopeEntry = {
  readonly contribution: IPolicyContribution
  readonly projection: IOutputProjection | undefined
  committed: boolean
  enabled: boolean
}

/** Allocate one constant-size count vector for the four private singular slots. */
function emptyCounts(): ISingularCounts {
  return { format: 0, batch: 0, retry: 0, timeout: 0 }
}
/** Allocate one frequency index per fixed slot; outputs are counted by their override delta. */
function emptyFrequencies(): ISingularFrequencies {
  return { format: new Map(), batch: new Map(), retry: new Map(), timeout: new Map() }
}
/**
 * A valid published index has at most two delta values per slot because effective counts are zero
 * or one.
 */
function copyFrequencies(source: ISingularFrequencies): ISingularFrequencies {
  return {
    format: new Map(source.format),
    batch: new Map(source.batch),
    retry: new Map(source.retry),
    timeout: new Map(source.timeout)
  }
}
/** Select a singular slot without assigning roles to repeatable entry and gate features. */
function singularSlot(feature: IFeatureImplementation): ISingularSlot | undefined {
  if (feature.phase === FeaturePhase.format) return FeaturePhase.format
  if (feature.phase === FeaturePhase.delivery) return feature.policy
  return undefined
}
/** Add or remove one output's fixed delta vector from the aggregate frequency index. */
function adjustFrequencies(
  frequencies: ISingularFrequencies,
  delta: ISingularCounts,
  amount: 1 | -1
): void {
  // singularSlots has exactly four compile-time entries, regardless of input size.
  for (const slot of singularSlots) {
    /** Each output contributes exactly one bucket occurrence in this slot. */
    const count = (frequencies[slot].get(delta[slot]) ?? 0) + amount
    if (count === 0) frequencies[slot].delete(delta[slot])
    else frequencies[slot].set(delta[slot], count)
  }
}
/** Reject any effective singular count above one before publishing a prepared declaration. */
function validateFrequencies(counts: ISingularCounts, frequencies: ISingularFrequencies): void {
  // The four slot indexes have at most two keys when valid; a candidate adds only changed-output keys.
  for (const slot of singularSlots)
    for (const delta of frequencies[slot].keys())
      if (counts[slot] + delta > 1) throw invalidOption()
}

/**
 * Log owns policy composition while native features, installation, mutation order and cleanup keep
 * their original owners.
 */
export class LogFeatureScope {
  /** The host owns entry-stage publication and each output retains its own effective-policy cache. */
  readonly #host: LogHost
  /**
   * Prepared declarations stay visible to later installers until their native disposal receipts
   * run.
   */
  readonly #entries = new Map<object, IScopeEntry>()
  /** Names are reserved across host-wide carriers, including prepared or disabled registrations. */
  readonly #hostFeatures = new Map<string, IFeatureImplementation>()
  /** Output-local aliases index only outputs whose effective slot can change for that host alias. */
  readonly #localAliases = new Map<string, Set<IOutputProjection>>()
  /** All reserved host declarations contribute to cold admission counts. */
  #hostCounts = emptyCounts()
  /** Frequency buckets project all output overrides without a host-by-output validation traversal. */
  #frequencies = emptyFrequencies()
  /** Only successfully installed and enabled declarations participate in delivery caches. */
  readonly #defaults = new Map<string, IFeatureImplementation>()
  /** These outputs have completed their own installation callback and consume active defaults. */
  readonly #outputs = new Set<IOutputProjection>()

  /** Capture the domain owner without creating another native lifecycle or mutation queue. */
  constructor(host: LogHost) {
    this.#host = host
  }

  /** Reserve a validated projection inside the native install; later same-batch installers see it. */
  prepare(signal: object, contribution: IPolicyContribution): void {
    /** The output projection is present only for a declaring output plugin. */
    const projection = contribution.output ? this.#prepareOutput(contribution) : undefined
    if (!contribution.output) this.#prepareHost(contribution)
    this.#entries.set(signal, { contribution, projection, committed: false, enabled: false })
  }

  /**
   * Publish caches after this plugin's user install callback succeeds; native rollback owns
   * withdrawal.
   */
  commit(signal: object): void {
    /** Prepare() registered this signal earlier in the same native install; commit runs once. */
    const entry = this.#entries.get(signal)!
    entry.committed = true
    this.#publish(entry)
  }

  /** Reenable the original installed policies without recreating feature outputs or releasing names. */
  enable(signal: object): void {
    /** A prepared registration cannot become visible before its own install callback succeeds. */
    const entry = this.#entries.get(signal)
    if (entry?.committed && !entry.enabled) this.#publish(entry)
  }

  /**
   * Withdraw delivery policy while preserving the native registration's cold declaration
   * reservation.
   */
  disable(signal: object): void {
    /** Native lifecycle callbacks retain the exact signal used by this scope's receipt. */
    const entry = this.#entries.get(signal)
    if (entry?.enabled) this.#unpublish(entry)
  }

  /** Release a prepared or committed declaration through its native onDispose receipt, idempotently. */
  remove(signal: object): void {
    /** Rollback and onDispose can both reach this receipt; the second call finds nothing. */
    const entry = this.#entries.get(signal)
    if (!entry) return
    this.#entries.delete(signal)
    if (entry.projection) this.#removeOutput(entry.projection)
    else this.#removeHost(entry.contribution)
    if (entry.enabled) this.#unpublish(entry)
  }

  /** Validate one output in O(local aliases), then add its override edges and four count buckets. */
  #prepareOutput(contribution: IPolicyContribution): IOutputProjection {
    /** Each local singular slot adds one; its matching inherited singular slot subtracts one. */
    const delta = emptyCounts()
    for (const [alias, feature] of contribution.features) {
      /** Only the same record key can override an inherited policy. */
      const inherited = this.#hostFeatures.get(alias)
      /** Host and local placement may differ under an explicitly named override. */
      const inheritedSlot = inherited && singularSlot(inherited)
      /** Third-party entry features are already rejected by the output authoring boundary. */
      const localSlot = singularSlot(feature)
      if (inheritedSlot) delta[inheritedSlot]--
      if (localSlot) delta[localSlot]++
    }
    // singularSlots is the fixed four-slot domain; every local alias was visited exactly once.
    for (const slot of singularSlots)
      if (this.#hostCounts[slot] + delta[slot] > 1) throw invalidOption()
    /** The projection is created only after validation, so failure leaves scope state unchanged. */
    const projection = { contribution, delta }
    adjustFrequencies(this.#frequencies, delta, 1)
    for (const alias of contribution.features.keys()) {
      /** Each inverted edge is created once and removed by the output's native receipt. */
      let outputs = this.#localAliases.get(alias)
      if (!outputs) this.#localAliases.set(alias, (outputs = new Set()))
      outputs.add(projection)
    }
    return projection
  }

  /**
   * Validate host aliases using only changed override edges and constant-size frequency-index
   * snapshots.
   */
  #prepareHost(contribution: IPolicyContribution): void {
    /** Candidate counts never mutate the published admission state before all checks pass. */
    const counts = { ...this.#hostCounts }
    /** Each affected output receives one final delta vector even when several aliases match it. */
    const changes = new Map<IOutputProjection, ISingularCounts>()
    for (const [alias, feature] of contribution.features) {
      if (this.#hostFeatures.has(alias)) throw invalidOption()
      /** Gates and entry stages reserve names but cannot consume a singular slot. */
      const slot = singularSlot(feature)
      if (!slot) continue
      counts[slot]++
      for (const output of this.#localAliases.get(alias) ?? []) {
        /** A local alias suppresses the new host slot for precisely this output. */
        let delta = changes.get(output)
        if (!delta) changes.set(output, (delta = { ...output.delta }))
        delta[slot]--
      }
    }
    /**
     * Valid current indexes have at most two keys per fixed slot, so this initial copy is
     * constant-size.
     */
    const frequencies = copyFrequencies(this.#frequencies)
    for (const [output, delta] of changes) {
      adjustFrequencies(frequencies, output.delta, -1)
      adjustFrequencies(frequencies, delta, 1)
    }
    validateFrequencies(counts, frequencies)
    this.#hostCounts = counts
    this.#frequencies = frequencies
    for (const [output, delta] of changes) output.delta = delta
    for (const [alias, feature] of contribution.features) this.#hostFeatures.set(alias, feature)
  }

  /** Remove one output's local edges and fixed buckets without touching unrelated declarations. */
  #removeOutput(output: IOutputProjection): void {
    adjustFrequencies(this.#frequencies, output.delta, -1)
    for (const alias of output.contribution.features.keys()) {
      /** The same output can share an alias with any number of independent outputs. */
      const outputs = this.#localAliases.get(alias)!
      outputs.delete(output)
      if (outputs.size === 0) this.#localAliases.delete(alias)
    }
  }

  /**
   * Removing a host declaration only removes effective slots; overridden outputs retain their local
   * slot.
   */
  #removeHost(contribution: IPolicyContribution): void {
    for (const [alias, feature] of contribution.features) {
      this.#hostFeatures.delete(alias)
      /** Only a removed singular host policy changes count projections. */
      const slot = singularSlot(feature)
      if (!slot) continue
      this.#hostCounts[slot]--
      for (const output of this.#localAliases.get(alias) ?? []) {
        adjustFrequencies(this.#frequencies, output.delta, -1)
        output.delta[slot]++
        adjustFrequencies(this.#frequencies, output.delta, 1)
      }
    }
  }

  /**
   * Publish only this successful installation; effective policy arrays are materialized by their
   * output owner.
   */
  #publish(entry: IScopeEntry): void {
    entry.enabled = true
    if (entry.projection) {
      this.#outputs.add(entry.projection)
      entry.contribution.configure?.(this.#defaults)
      return
    }
    this.#republishHost(entry)
  }

  /**
   * Native disable/removal callbacks withdraw only this entry's previously published defaults or
   * output.
   */
  #unpublish(entry: IScopeEntry): void {
    entry.enabled = false
    if (entry.projection) {
      this.#outputs.delete(entry.projection)
      return
    }
    this.#republishHost(entry)
  }

  /**
   * Rebuild host-wide defaults after one host entry changes visibility. Defaults are rebuilt from
   * #entries (installation order) instead of being set or deleted in place, so a disable/enable
   * cycle never moves a plugin's entry stages or gates behind later plugins. Cold path: runs only
   * on publication changes, O(host aliases).
   */
  #republishHost(changed: IScopeEntry): void {
    if (changed.contribution.features.size === 0) return
    this.#defaults.clear()
    for (const entry of this.#entries.values())
      if (!entry.projection && entry.enabled)
        for (const [alias, feature] of entry.contribution.features)
          this.#defaults.set(alias, feature)
    /** Gate-only changes cannot alter the host ingress-stage array. */
    let entryChanged = false
    for (const feature of changed.contribution.features.values())
      if (feature.phase === FeaturePhase.entry) entryChanged = true
    this.#refreshDefaults(entryChanged)
  }

  /**
   * Recompile entry stages and existing output-policy edges only when host-wide defaults actually
   * change.
   */
  #refreshDefaults(entryChanged: boolean): void {
    if (entryChanged) this.#host.setEntryFeatures(this.#defaults)
    for (const output of this.#outputs) output.contribution.configure?.(this.#defaults)
  }
}

/** One receipt is owned by the installing plugin's native resource scope. */
export class LogPolicyInstallation {
  /** Policy composition is the receiving log host's explicitly owned domain state. */
  readonly #scope: LogFeatureScope
  /** The native lifetime signal identifies this exact installation across callbacks and cleanup. */
  readonly #signal: object

  /**
   * Prepare inside native installation and register rollback ownership before returning to caller
   * code.
   */
  constructor(core: ILogPluginCore, contribution: IPolicyContribution) {
    this.#scope = (core as ILogPluginCore & ILogDomainCore)[logCoreOwner].featureScope
    this.#signal = core.lifecycle.signal
    this.#scope.prepare(this.#signal, contribution)
    try {
      core.onDispose(() => this.close())
    } catch (error) {
      this.#scope.remove(this.#signal)
      throw error
    }
  }
  /** The authoring helper calls this only after its install callback and extension assembly succeed. */
  commit(): void {
    this.#scope.commit(this.#signal)
  }
  /** Restore cached behavior using the exact original feature instances. */
  enable(): void {
    this.#scope.enable(this.#signal)
  }
  /** Withdraw ready behavior while retaining the native registration's declarations. */
  disable(): void {
    this.#scope.disable(this.#signal)
  }
  /** Native rollback, removal and disposal share the same idempotent receipt. */
  close(): void {
    this.#scope.remove(this.#signal)
  }
}

/**
 * Publish installed controls through plugin-host's ordinary extension collision and revocation
 * guards.
 */
export function featureControlExtensions<N extends string, F extends ILogFeatureRecord>(
  name: N,
  features: F,
  outputs: IFeatureOutputs<F>
): ILogControlExtensions<N, F> {
  /** The native plugin owner validates and guards every enumerable extension data property. */
  const extensions: Record<string, unknown> = {}
  // featureScope admitted every alias as a log feature when the plugin was defined.
  for (const alias of Object.keys(features)) {
    /** Controls come from the same native instance as this alias's installed policy implementation. */
    const runtime = outputs[alias] as ILogFeatureRuntime<object>
    for (const method of Object.keys(runtime.controls))
      extensions[`${name}_${alias}_${method}`] = Reflect.get(runtime.controls, method)
  }
  return extensions as ILogControlExtensions<N, F>
}

/** Preserve native result admission and data descriptors while adding installed feature controls. */
export function composeFeatureExtensions<O extends Record<string, unknown>, C extends object>(
  name: string,
  extensions: O,
  controls: C
): O & C {
  if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions))
    return extensions as O & C
  /** Unsupported containers and own thenables must reach native admission as the exact original. */
  const prototype = Object.getPrototypeOf(extensions)
  if ((prototype !== Object.prototype && prototype !== null) || Object.hasOwn(extensions, 'then'))
    return extensions as O & C
  /** Assembly cannot erase a duplicate before native mounting; reuse its exported semantic error. */
  for (const key of Reflect.ownKeys(controls))
    if (Object.hasOwn(extensions, key))
      throw new PluginHostError(
        PluginHostErrorCode.extensionDuplicate,
        ERROR_TEXT.EXTENSION_DUPLICATE(name, key)
      )
  /** Descriptor copying avoids evaluating accessors or relaxing non-configurable property checks. */
  const combined = Object.create(prototype, Object.getOwnPropertyDescriptors(extensions)) as O & C
  Object.defineProperties(combined, Object.getOwnPropertyDescriptors(controls))
  return combined
}
