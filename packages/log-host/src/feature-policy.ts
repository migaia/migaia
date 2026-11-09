import {
  FeatureOverlay,
  type IFeatureOverlayEntry,
  type IFeatureOverlaySelection
} from '@migaia/plugin-host/feature-overlay/notifications'
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
  logFeatureRole,
  type IFeatureImplementation,
  type ILogFeatureRuntime
} from './feature-metadata.ts'
import { logCoreOwner } from './state-constants.ts'

/** Global ingress stages execute only at the actual LogHost entry. */
function publishEntryFeatures(
  host: LogHost,
  entries: readonly IFeatureOverlayEntry<IFeatureImplementation>[]
): void {
  /** Existing host compiler owns phase selection; the overlay owns composition only. */
  const features = new Map<string, IFeatureImplementation>()
  for (const entry of entries) features.set(String(entry.alias), entry.value)
  host.setEntryFeatures(features)
}
/** Construct the one canonical composition owner for this log host. */
export function createLogFeatureOverlay(host: LogHost): FeatureOverlay<IFeatureImplementation> {
  return new FeatureOverlay<IFeatureImplementation>(logFeatureRole, (entries) =>
    publishEntryFeatures(host, entries)
  )
}
/** Project original installed policies and borrow the exact native publication/cleanup receipt. */
export function registerLogPolicy(
  core: ILogPluginCore,
  features: ReadonlyMap<string, IFeatureImplementation>,
  configure?: (entries: readonly IFeatureOverlayEntry<IFeatureImplementation>[]) => void,
  disabled: readonly PropertyKey[] = []
): void {
  /** The original domain owner already has its single overlay instance. */
  const host = (core as ILogPluginCore & ILogDomainCore)[logCoreOwner]
  /** Domain alias admission is independent of generic policy-role conflicts. */
  const overlay = host.featureScope
  /** Projection happens once at installation and never during a log write. */
  const entries: IFeatureOverlayEntry<IFeatureImplementation>[] = []
  for (const [alias, value] of features) entries.push({ alias, value })
  if (!configure) {
    host.reserveFeatureAliases(core, features.keys())
    overlay.provide(core, entries)
    return
  }
  /** Explicit local disables stay out of native feature records. */
  const selected: IFeatureOverlaySelection<IFeatureImplementation>[] = [...entries]
  for (const role of disabled) selected.push({ role, value: false })
  overlay.consume(core, selected, configure)
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
