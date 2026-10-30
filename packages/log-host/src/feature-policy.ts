import {
  PluginHostError,
  PluginHostErrorCode,
  ERROR_TEXT,
  type IFeatureOutputs
} from '@migaia/plugin-host'
import type { ILogControlExtensions, ILogFeatureRecord, ILogPluginCore } from './typing.ts'
import type { ILogDomainCore } from './core.ts'
import type { LogHost } from './host.ts'
import {
  singularSlot,
  type IFeatureImplementation,
  type ILogFeatureRuntime
} from './feature-metadata.ts'
import { logCoreOwner, FeaturePhase } from './state-constants.ts'
import { invalidOption } from './errors.ts'

/** Native installation supplies the exact implementations and the output's cold cache compiler. */
type IPolicyContribution = {
  readonly name: string
  readonly output: boolean
  readonly features: ReadonlyMap<string, IFeatureImplementation>
  configure?(defaults: ReadonlyMap<string, IFeatureImplementation>): void
}
/** Native signals identify the receipt; `published` marks a committed entry that is visible. */
type IScopeEntry = {
  readonly contribution: IPolicyContribution
  published: boolean
}

/**
 * Log owns policy composition while native features, installation, mutation order and cleanup keep
 * their original owners. Host-wide policies are defaults; an output's own format, batch, retry or
 * timeout replaces the host-wide one of the same slot (see resolveFeatureScope).
 */
export class LogFeatureScope {
  /** The host owns entry-stage publication and each output retains its own effective-policy cache. */
  readonly #host: LogHost
  /** Installed declarations in installation order, from prepare until their disposal receipt. */
  readonly #entries = new Map<object, IScopeEntry>()
  /** Host-wide aliases are unique across host plugins, including prepared registrations. */
  readonly #hostAliases = new Set<string>()
  /** Host-wide singular slots (format, batch, retry, timeout) held by some host plugin. */
  readonly #hostSlots = new Set<string>()
  /** Published host-wide defaults, rebuilt in installation order. */
  readonly #defaults = new Map<string, IFeatureImplementation>()
  /** Published outputs that consume the host-wide defaults. */
  readonly #outputs = new Set<IPolicyContribution>()

  /** Capture the domain owner without creating another native lifecycle or mutation queue. */
  constructor(host: LogHost) {
    this.#host = host
  }

  /** Reserve a host declaration inside the native install; later same-batch installers see it. */
  prepare(signal: object, contribution: IPolicyContribution): void {
    if (!contribution.output) this.#reserveHost(contribution)
    this.#entries.set(signal, { contribution, published: false })
  }

  /** Publish after this plugin's install callback succeeds; native rollback owns withdrawal. */
  commit(signal: object): void {
    /** Prepare() registered this signal earlier in the same native install; commit runs once. */
    const entry = this.#entries.get(signal)!
    entry.published = true
    if (entry.contribution.output) {
      this.#outputs.add(entry.contribution)
      entry.contribution.configure?.(this.#defaults)
    } else this.#republishHost(entry.contribution)
  }

  /** Release a prepared or committed declaration through its native onDispose receipt, idempotently. */
  remove(signal: object): void {
    /** Rollback and onDispose can both reach this receipt; the second call finds nothing. */
    const entry = this.#entries.get(signal)
    if (!entry) return
    this.#entries.delete(signal)
    if (entry.contribution.output) {
      this.#outputs.delete(entry.contribution)
      return
    }
    for (const [alias, feature] of entry.contribution.features) {
      this.#hostAliases.delete(alias)
      /** A released singular policy frees its host-wide slot. */
      const slot = singularSlot(feature)
      if (slot) this.#hostSlots.delete(slot)
    }
    if (entry.published) this.#republishHost(entry.contribution)
  }

  /** Reject a host alias or singular slot already held by another host plugin. */
  #reserveHost(contribution: IPolicyContribution): void {
    for (const [alias, feature] of contribution.features) {
      /** One plugin's record already has unique aliases and at most one feature per slot. */
      const slot = singularSlot(feature)
      if (this.#hostAliases.has(alias) || (slot && this.#hostSlots.has(slot))) throw invalidOption()
    }
    for (const [alias, feature] of contribution.features) {
      this.#hostAliases.add(alias)
      /** Validation above guarantees this slot is free. */
      const slot = singularSlot(feature)
      if (slot) this.#hostSlots.add(slot)
    }
  }

  /**
   * Rebuild host-wide defaults in installation order after one host plugin is published or removed,
   * then recompile entry stages and every published output. Cold path: O(host aliases + outputs).
   */
  #republishHost(changed: IPolicyContribution): void {
    if (changed.features.size === 0) return
    this.#defaults.clear()
    for (const entry of this.#entries.values())
      if (!entry.contribution.output && entry.published)
        for (const [alias, feature] of entry.contribution.features)
          this.#defaults.set(alias, feature)
    /** Gate-only changes cannot alter the host ingress-stage array. */
    let entryChanged = false
    for (const feature of changed.features.values())
      if (feature.phase === FeaturePhase.entry) entryChanged = true
    if (entryChanged) this.#host.setEntryFeatures(this.#defaults)
    for (const output of this.#outputs) output.configure?.(this.#defaults)
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
