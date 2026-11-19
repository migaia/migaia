import { isResourceBinding } from '../data.ts'
import { splitDescriptorId } from '../descriptor-id.ts'
import { PartContractErrorCode } from '../error-code.ts'
import { PartContractErrorText } from '../error-text.ts'
import { createPartContractError } from '../errors.ts'
import { eventEntries, modifierId } from '../event-key.ts'
import type { IBlueprint, ICatalogView, IDescriptor, IPartNode } from '../types.ts'

/** Kinds of definitions a remote module may export; the only kinds remote code can supply. */
export const RemoteExportKind = {
  enhancer: 'enhancer',
  effect: 'effect',
  derive: 'derive'
} as const

/** One remote export kind. */
export type RemoteExportKind = keyof typeof RemoteExportKind

/**
 * Reference to one built remote module carried by a snapshot. `name` is the source path relative to
 * the remote-module root and stays stable across versions; `id` is the content hash of the built
 * bytes (`sha256-<base64url>`); `integrity` is their SRI value (`sha384-<base64>`); `url` is
 * relative to the catalog project root (`m/<file>` or `drafts/m/<file>`). The reference carries no
 * trust tier: the client application decides tiers and grants.
 */
export type IRemoteModuleRef = {
  readonly name: string
  readonly id: string
  readonly url: string
  readonly integrity: string
  readonly exports: readonly { readonly id: string; readonly kind: RemoteExportKind }[]
}

/**
 * Lock of one version: the blueprints it carries with the hash of each blueprint file, every
 * definition id the blueprints reference (first-occurrence order, each once) and the remote modules
 * shipped with it.
 */
export type IPartLock = {
  readonly format: 1
  readonly project: string
  readonly tag: string
  readonly blueprints: readonly {
    readonly id: string
    readonly version: number
    readonly hash: string
  }[]
  readonly definitions: readonly string[]
  readonly modules: readonly IRemoteModuleRef[]
}

/**
 * Version snapshot: the lock, the blueprints and the descriptors of every referenced definition (no
 * code). The bytes of its `snapshot.json` file identify the version (`hashBytes` of them).
 */
export type IPartSnapshot = {
  readonly lock: IPartLock
  readonly blueprints: readonly IBlueprint[]
  readonly descriptors: readonly IDescriptor[]
}

/** One path segment of a module name: letters, digits, `_`, `.`, `-`, not starting with `.` or `-`. */
const MODULE_NAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

/** Module names end in a TypeScript source extension. */
const MODULE_NAME_EXTENSION = /\.tsx?$/

/**
 * True when `name` is a safe module name: `/`-separated segments matching
 * `[A-Za-z0-9_][A-Za-z0-9_.-]*`, none of them `.` or `..`, no leading `/`, ending in `.ts` or
 * `.tsx`. Catalog changesets, CLI write-back and `parseSnapshot` use it to refuse path traversal.
 */
export function isModuleName(name: string): boolean {
  if (!MODULE_NAME_EXTENSION.test(name)) return false
  for (const segment of name.split('/'))
    if (segment === '.' || segment === '..' || !MODULE_NAME_SEGMENT.test(segment)) return false
  return true
}

/** Encodes bytes as base64url without padding. */
function base64Url(bytes: Uint8Array): string {
  /** Binary string of the bytes; one character per byte. */
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * SHA-256 of `bytes` as `sha256-<base64url>`, via Web Crypto. The snapshot hash is this value of
 * the `snapshot.json` bytes; every party hashes the exact bytes it holds, without normalization.
 */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  /**
   * Web Crypto digest API. Only modern hosts are supported; where it is missing the call below
   * fails with the platform's own TypeError.
   */
  const subtle = globalThis.crypto?.subtle as NonNullable<
    NonNullable<typeof globalThis.crypto>['subtle']
  >
  /** Digest bytes, computed over a copy so a shared or offset view hashes exactly its bytes. */
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes.slice().buffer))
  return `sha256-${base64Url(digest)}`
}

/** Binding values a facet entry may hold that reference a definition. */
function bindingReference(value: unknown): string | undefined {
  if (isResourceBinding(value)) return value.$resource
  if (typeof value === 'object' && value !== null) {
    /** Derive id of a `{ $derive }` binding. */
    const derive = (value as { readonly $derive?: unknown }).$derive
    if (typeof derive === 'string') return derive
  }
  return undefined
}

/**
 * Walk state of `collectDefinitions`: ids found so far (insertion order is first occurrence),
 * fragment ids whose bodies were already walked, and the catalog consulted for fragments.
 */
type ICollectState = {
  readonly found: Set<string>
  readonly walkedFragments: Set<string>
  readonly catalog: ICatalogView
  readonly pending: IPartNode[]
}

/** Records one node's references and queues its child nodes; each node is visited once. */
function visitNode(state: ICollectState, node: IPartNode): void {
  state.found.add(node.tag)
  /** Descriptor of the tag, to expand fragment bodies once. */
  const descriptor = state.catalog.get(node.tag)
  if (descriptor?.fragment !== undefined && !state.walkedFragments.has(node.tag)) {
    state.walkedFragments.add(node.tag)
    state.pending.push(descriptor.fragment.node)
  }
  /** Facets of the node. */
  const facets = node.facets ?? {}
  for (const group of [facets.props, facets.attrs, facets.aria, facets.data, facets.style])
    for (const value of Object.values(group ?? {})) {
      /** Referenced definition, if the value is a binding. */
      const reference = bindingReference(value)
      if (reference !== undefined) state.found.add(reference)
    }
  for (const entry of eventEntries(facets.events)) {
    state.found.add(entry.subscription.handler)
    for (const modifier of entry.subscription.modifiers ?? []) state.found.add(modifierId(modifier))
  }
  for (const nodes of Object.values(facets.slots ?? {})) state.pending.push(...nodes)
  for (const child of node.children ?? []) state.pending.push(child)
  if (node.template !== undefined) {
    /** Rows binding of the template, if any. */
    const rows = bindingReference(node.template.rows)
    if (rows !== undefined) state.found.add(rows)
    state.pending.push(node.template.node)
  }
}

/** Adds model relation targets of every found model, following relations transitively, once each. */
function addModelRelations(state: ICollectState): void {
  /** Ids to inspect, walked with a cursor so the list grows without re-scanning. */
  const queue = [...state.found]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    /** Relations of the model at the cursor, when it is one. */
    const relations = state.catalog.get(queue[cursor] as string)?.model?.relations ?? {}
    for (const relation of Object.values(relations)) {
      if (state.found.has(relation.target)) continue
      state.found.add(relation.target)
      queue.push(relation.target)
    }
  }
}

/** Adds every enhancer whose `targets` name a part found so far; one pass over the catalog. */
function addEnhancers(state: ICollectState): void {
  /** Part names (without major) referenced by the blueprints. */
  const names = new Set<string>()
  for (const id of state.found) names.add(splitDescriptorId(id).name)
  for (const descriptor of state.catalog.all()) {
    if (descriptor.kind !== 'enhancer' || state.found.has(descriptor.id)) continue
    if ((descriptor.targets ?? []).some((target) => names.has(target)))
      state.found.add(descriptor.id)
  }
}

/**
 * Every definition id the blueprints reference: node tags, fragment bodies (each fragment once),
 * event handlers and modifiers, `$derive` and `$resource` bindings, model relation targets, and
 * enhancers targeting a referenced part. First-occurrence order, each id once; each node is visited
 * once.
 */
export function collectDefinitions(
  blueprints: readonly IBlueprint[],
  catalog: ICatalogView
): string[] {
  /** Walk state shared by the visit helpers. */
  const state: ICollectState = {
    found: new Set(),
    walkedFragments: new Set(),
    catalog,
    pending: []
  }
  for (const blueprint of blueprints) {
    state.pending.push(blueprint.root)
    for (let cursor = 0; cursor < state.pending.length; cursor += 1)
      visitNode(state, state.pending[cursor] as IPartNode)
    state.pending.length = 0
  }
  addModelRelations(state)
  addEnhancers(state)
  return [...state.found]
}

/** Throws SNAPSHOT_INVALID for the first problem at `pointer`. */
function invalid(pointer: string, reason: string): never {
  throw createPartContractError(
    PartContractErrorCode.snapshotInvalid,
    PartContractErrorText.snapshotInvalid(pointer, reason),
    { pointer, reason }
  )
}

/** True for a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fixed reasons reported on `cause` for snapshot shape problems. */
export const SnapshotInvalidReason = {
  json: 'not UTF-8 JSON',
  object: 'must be an object',
  array: 'must be an array',
  string: 'must be a string',
  format: 'must be 1',
  moduleName: 'must be a relative .ts or .tsx path without . or .. segments',
  exportKind: 'must be enhancer, effect or derive'
} as const

/** Checks that `value[key]` is a string, reporting at `pointer/key`. */
function requireString(value: Record<string, unknown>, key: string, pointer: string): void {
  if (typeof value[key] !== 'string') invalid(`${pointer}/${key}`, SnapshotInvalidReason.string)
}

/** Checks that `value[key]` is an array and returns it, reporting at `pointer/key`. */
function requireArray(value: Record<string, unknown>, key: string, pointer: string): unknown[] {
  /** Field value. */
  const field = value[key]
  if (!Array.isArray(field)) return invalid(`${pointer}/${key}`, SnapshotInvalidReason.array)
  return field
}

/** Checks one remote module reference at `pointer`. */
function checkModule(module: unknown, pointer: string): void {
  if (!isObject(module)) return invalid(pointer, SnapshotInvalidReason.object)
  for (const key of ['name', 'id', 'url', 'integrity']) requireString(module, key, pointer)
  if (!isModuleName(module.name as string))
    invalid(`${pointer}/name`, SnapshotInvalidReason.moduleName)
  /** Exports list. */
  const exports = requireArray(module, 'exports', pointer)
  for (let index = 0; index < exports.length; index += 1) {
    /** One export entry. */
    const entry = exports[index]
    if (!isObject(entry))
      return invalid(`${pointer}/exports/${index}`, SnapshotInvalidReason.object)
    requireString(entry, 'id', `${pointer}/exports/${index}`)
    if (!Object.hasOwn(RemoteExportKind, entry.kind as string))
      invalid(`${pointer}/exports/${index}/kind`, SnapshotInvalidReason.exportKind)
  }
}

/** Checks the lock object at `/lock`. */
function checkLock(lock: unknown): void {
  if (!isObject(lock)) return invalid('/lock', SnapshotInvalidReason.object)
  if (lock.format !== 1) invalid('/lock/format', SnapshotInvalidReason.format)
  requireString(lock, 'project', '/lock')
  requireString(lock, 'tag', '/lock')
  requireArray(lock, 'blueprints', '/lock')
  requireArray(lock, 'definitions', '/lock')
  /** Module references. */
  const modules = requireArray(lock, 'modules', '/lock')
  for (let index = 0; index < modules.length; index += 1)
    checkModule(modules[index], `/lock/modules/${index}`)
}

/**
 * Decodes snapshot bytes (UTF-8 JSON) and checks their shape, including every module name. Throws
 * SNAPSHOT_INVALID with the JSON Pointer of the first problem on `cause`. Blueprint documents are
 * checked by `parseBlueprint` when loaded, not here.
 */
export function parseSnapshot(bytes: Uint8Array): IPartSnapshot {
  /** Parsed JSON value. */
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    throw createPartContractError(
      PartContractErrorCode.snapshotInvalid,
      PartContractErrorText.snapshotInvalid('', SnapshotInvalidReason.json),
      error
    )
  }
  if (!isObject(parsed)) return invalid('', SnapshotInvalidReason.object)
  checkLock(parsed.lock)
  requireArray(parsed, 'blueprints', '')
  requireArray(parsed, 'descriptors', '')
  return parsed as unknown as IPartSnapshot
}
