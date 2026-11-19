import { hashBytes, type IRemoteModuleRef } from '@migaia/part-contract'
import {
  defineEffect,
  definePartPlugin,
  EFFECT_GRANTS_META,
  partCorePlugin,
  type IDefinition,
  type IDeriveDefinition,
  type IEffectDefinition,
  type IEffectGrants,
  type IEnhancerDefinition,
  type IGenerationSignal,
  type IPartHost,
  type IPartPlugin
} from '@migaia/part-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { importModuleBytes } from './browser/blob-import.ts'
import type { SnapshotCache } from './cache.ts'
import { authHeaders, fetchChecked } from './client.ts'
import { PartRemoteErrorCode } from './error-code.ts'
import { createPartRemoteError } from './errors.ts'
import { PartRemoteText, REMOTE_MODULES_PLUGIN, RejectReason } from './text.ts'

/** Trust tier and grants the application gives one remote module. */
export type ITrustEntry = {
  readonly tier: 'page' | 'restricted' | 'isolated'
  readonly grants?: IEffectGrants
}

/**
 * Application trust table keyed by module `name`; modules without an entry are `restricted` without
 * grants.
 */
export type ITrust = Readonly<Record<string, ITrustEntry>>

/** Shared runtime namespaces placed on the shared global before remote modules import. */
export type ISharedRuntime = Readonly<Record<string, unknown>>

/** Definitions one remote module contributes to `remote:modules`, keyed by its stable `name`. */
export type IRemoteModuleEntry = {
  readonly name: string
  readonly definitions: readonly IDefinition[]
}

/** Verified bytes of one isolated module, handed to the Worker as a whole set per version. */
export type IIsolatedModule = { readonly name: string; readonly bytes: Uint8Array }

/** Where and how module bytes are fetched. `base` resolves the relative `url` of each reference. */
export type IModuleSource = {
  readonly base: string
  readonly token?: string
  readonly shared: ISharedRuntime
  readonly trust?: ITrust
  /** Byte cache consulted before the network; absent for editor previews. */
  readonly cache?: SnapshotCache
}

/** Outcome of preparing a set of module references: entries, isolated bytes and bytes to cache. */
export type IPreparedModules = {
  readonly entries: readonly IRemoteModuleEntry[]
  readonly isolated: readonly IIsolatedModule[]
  /** Bytes of every prepared module by `id`, written to the cache once the version is accepted. */
  readonly bytes: ReadonlyMap<string, Uint8Array>
}

/** Trust entry of a module: the application's entry, or `restricted` without grants. */
export function trustOf(trust: ITrust | undefined, name: string): ITrustEntry {
  return trust?.[name] ?? { tier: 'restricted' }
}

/** SRI value (`sha384-<base64>`) of bytes, via Web Crypto. */
async function sri384(bytes: Uint8Array): Promise<string> {
  /** Digest bytes. */
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', bytes.slice().buffer))
  /** Binary string of the digest; one character per byte. */
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return `sha384-${btoa(binary)}`
}

/** Throws REMOTE_MODULE_INTEGRITY unless the bytes match both `integrity` and `id`. */
export async function verifyModule(ref: IRemoteModuleRef, bytes: Uint8Array): Promise<void> {
  if ((await sri384(bytes)) !== ref.integrity || (await hashBytes(bytes)) !== ref.id)
    throw createPartRemoteError(
      PartRemoteErrorCode.moduleIntegrity,
      PartRemoteText.moduleIntegrity(ref.name)
    )
}

/** Module bytes from the cache, else from the network with the bearer token. Not yet verified. */
async function moduleBytes(ref: IRemoteModuleRef, source: IModuleSource): Promise<Uint8Array> {
  /** Cached bytes, when present. */
  const cached = await source.cache?.module(ref.id)
  if (cached !== undefined && cached !== null) return cached
  /** Response of the module request. */
  const response = await fetchChecked(new URL(ref.url, source.base).href, {
    headers: authHeaders(source.token)
  })
  return new Uint8Array(await response.arrayBuffer())
}

/** Definitions of an imported module's default export (one definition or an array of them). */
function definitionsOf(namespace: { readonly default?: unknown }): readonly IDefinition[] {
  /** Default export. */
  const value = namespace.default
  return (Array.isArray(value) ? value : [value]) as readonly IDefinition[]
}

/**
 * Effect definition whose tier and grants come from the application; whatever tier and grants the
 * module wrote are dropped. Other kinds are returned unchanged.
 */
function withTrust(definition: IDefinition, entry: ITrustEntry): IDefinition {
  if (definition.descriptor.kind !== 'effect') return definition
  return Object.freeze({
    ...definition,
    descriptor: Object.freeze({
      ...definition.descriptor,
      tier: entry.tier,
      meta: { ...definition.descriptor.meta, [EFFECT_GRANTS_META]: entry.grants ?? {} }
    })
  })
}

/** No-op run of an isolated placeholder; the host hands isolated effects to the registered runner. */
function placeholderRun(): void {}

/**
 * Placeholder definitions of an isolated module: one `isolated` effect per export with the
 * application's grants. Throws REMOTE_VERSION_REJECTED when the module exports anything but
 * effects.
 */
function isolatedPlaceholders(ref: IRemoteModuleRef, entry: ITrustEntry): IEffectDefinition[] {
  if (ref.exports.some((item) => item.kind !== 'effect'))
    throw createPartRemoteError(
      PartRemoteErrorCode.versionRejected,
      PartRemoteText.versionRejected(ref.name, RejectReason.isolatedKind),
      new TypeError(PartRemoteText.isolatedKind(ref.name))
    )
  return ref.exports.map((item) =>
    defineEffect({
      id: item.id,
      tier: 'isolated',
      meta: { [EFFECT_GRANTS_META]: entry.grants ?? {} },
      run: placeholderRun
    })
  )
}

/**
 * Fetches (cache first), verifies and imports every reference. Page and restricted modules are
 * imported through a Blob URL with the shared runtime on the shared global; isolated modules are
 * not imported on the page: their verified bytes are returned for the Worker and placeholders stand
 * in.
 */
export async function prepareModules(
  refs: readonly IRemoteModuleRef[],
  source: IModuleSource
): Promise<IPreparedModules> {
  /** Entries in reference order. */
  const entries: IRemoteModuleEntry[] = []
  /** Isolated module bytes in reference order. */
  const isolated: IIsolatedModule[] = []
  /** Bytes by module id. */
  const bytes = new Map<string, Uint8Array>()
  for (const ref of refs) {
    /** Module bytes, verified before any use. */
    const body = await moduleBytes(ref, source)
    await verifyModule(ref, body)
    bytes.set(ref.id, body)
    /** Trust entry of the module. */
    const entry = trustOf(source.trust, ref.name)
    if (entry.tier === 'isolated') {
      entries.push({ name: ref.name, definitions: isolatedPlaceholders(ref, entry) })
      isolated.push({ name: ref.name, bytes: body })
      continue
    }
    /** Imported module namespace. */
    const namespace = await importModuleBytes(body, source.shared)
    entries.push({
      name: ref.name,
      definitions: definitionsOf(namespace).map((definition) => withTrust(definition, entry))
    })
  }
  return { entries, isolated, bytes }
}

/**
 * Current remote module set of each host, written by the installed `remote:modules` generation.
 * Deliberately private module-level state: the plugin is the only owner of the set, and this map
 * only lets `loadRemoteModules` read it back from a host.
 */
const installedSets = new WeakMap<IPartHost, RemoteModuleSet>()

/** Feature output of `remote:modules`: the module entries this generation installed. */
export class RemoteModuleSet {
  /** Entries in install order. */
  readonly #entries: readonly IRemoteModuleEntry[]
  /** Host the generation is installed in; the key of `installedSets`. */
  readonly #host: IPartHost

  /** Holds the entries of one generation and the host it belongs to. */
  constructor(entries: readonly IRemoteModuleEntry[], host: IPartHost) {
    this.#entries = entries
    this.#host = host
  }

  /** Entries installed by this generation. */
  current(): readonly IRemoteModuleEntry[] {
    return this.#entries
  }

  /** Records this set as its host's current set until `signal` aborts (generation released). */
  record(signal: IGenerationSignal): void {
    installedSets.set(this.#host, this)
    signal.addEventListener('abort', () => this.#release(), { once: true })
  }

  /** Forgets this set unless a newer generation already replaced it. */
  #release(): void {
    if (installedSets.get(this.#host) === this) installedSets.delete(this.#host)
  }
}

/** Splits entry definitions by kind into the `definePartPlugin` lists. */
function definitionLists(entries: readonly IRemoteModuleEntry[]): {
  readonly enhancers: IEnhancerDefinition<never>[]
  readonly derives: IDeriveDefinition<never, unknown>[]
  readonly effects: IEffectDefinition[]
} {
  /** Lists by kind. */
  const lists = {
    enhancers: [] as IEnhancerDefinition<never>[],
    derives: [] as IDeriveDefinition<never, unknown>[],
    effects: [] as IEffectDefinition[]
  }
  for (const entry of entries)
    for (const definition of entry.definitions) {
      if (definition.descriptor.kind === 'enhancer')
        lists.enhancers.push(definition as IEnhancerDefinition<never>)
      else if (definition.descriptor.kind === 'derive')
        lists.derives.push(definition as IDeriveDefinition<never, unknown>)
      else lists.effects.push(definition as IEffectDefinition)
    }
  return lists
}

/** `onInstall` of `remote:modules`: records the generation's set for its host. */
function recordSet(features: Readonly<Record<string, unknown>>, signal: IGenerationSignal): void {
  ;(features.remoteModules as RemoteModuleSet).record(signal)
}

/**
 * Plugin `remote:modules` holding every remote definition. It provides Feature `remoteModules`
 * whose `current()` returns the entries; the remote plugin and the editor preview both install
 * remote definitions only through it, so the current set has one owner.
 */
export function remoteModulesPlugin(entries: readonly IRemoteModuleEntry[]): IPartPlugin {
  return definePartPlugin({
    name: REMOTE_MODULES_PLUGIN,
    ...definitionLists(entries),
    features: {
      remoteModules: defineFeature(
        (_core, deps: { readonly runtime: { host(): IPartHost } }) =>
          new RemoteModuleSet(entries, deps.runtime.host()),
        { runtime: partCorePlugin.getFeature('runtime') } as never
      )
    },
    onInstall: recordSet
  })
}

/** Entries currently installed in `remote:modules` of a host, or undefined when none is installed. */
export function currentRemoteModules(host: IPartHost): readonly IRemoteModuleEntry[] | undefined {
  return installedSets.get(host)?.current()
}

/** Installs `remote:modules` with `entries`, replacing the installed one when present. */
export async function installRemoteModules(
  host: IPartHost,
  entries: readonly IRemoteModuleEntry[]
): Promise<void> {
  /** New plugin. */
  const plugin = remoteModulesPlugin(entries)
  if (installedSets.has(host)) await host.replace(REMOTE_MODULES_PLUGIN, plugin)
  else await host.use(plugin)
}

/** Current entries with `next` overriding entries of the same `name`; other entries are kept. */
export function overrideEntries(
  current: readonly IRemoteModuleEntry[],
  next: readonly IRemoteModuleEntry[]
): IRemoteModuleEntry[] {
  /** Entries by name, current first so overrides keep their position. */
  const byName = new Map<string, IRemoteModuleEntry>()
  for (const entry of current) byName.set(entry.name, entry)
  for (const entry of next) byName.set(entry.name, entry)
  return [...byName.values()]
}

/**
 * Fetches, verifies and imports `refs`, then installs them into `remote:modules` over the current
 * set: entries of the same `name` are replaced, others kept. Used by the editor preview to load
 * draft modules. Isolated modules get placeholders only; they run when a runner is registered.
 */
export async function loadRemoteModules(
  host: IPartHost,
  refs: readonly IRemoteModuleRef[],
  options: {
    readonly base: string
    readonly token?: string
    readonly shared: ISharedRuntime
    readonly trust?: ITrust
  }
): Promise<void> {
  /** Prepared modules. */
  const prepared = await prepareModules(refs, options)
  await installRemoteModules(
    host,
    overrideEntries(currentRemoteModules(host) ?? [], prepared.entries)
  )
}
