import {
  applyPatch,
  artifactKey,
  auditTargets,
  ChangesetStatus,
  checkBase,
  hashBytes,
  descriptorView,
  isModuleName,
  mergeBlueprint,
  parseBlueprint,
  parseSnapshot,
  type IAuditTarget,
  type IBlueprint,
  type IChangeset,
  type IChangesetArtifact,
  type IChangesetResult,
  type IDescriptor,
  type IIssue,
  type IPartSnapshot,
  type IRemoteModuleRef
} from '@migaia/part-contract'
import { buildDraftModule } from './remote-build.ts'
import type { CatalogStore, ICatalogKv } from './store.ts'
import { CatalogRule, StoreKey } from './text.ts'
import type { IProjectRecord } from './tokens.ts'
import { blueprintIssues } from './validate.ts'

/** One draft module: its source when known and its current build. */
export type IDraftModule = {
  readonly name: string
  readonly source?: string
  readonly built: IRemoteModuleRef
}

/** One conflict left by a rebase, shown to the editor. */
export type IDraftConflict = {
  readonly address?: string
  readonly facet?: string
  readonly blueprint?: string
  readonly module?: string
}

/** Stored draft of a project. */
export type IDraft = {
  readonly base: { readonly snapshot: string; readonly tag: string }
  readonly conflicts: readonly IDraftConflict[]
  readonly blueprints: readonly { readonly id: string; readonly document: IBlueprint }[]
  readonly modules: readonly IDraftModule[]
}

/** Draft as returned to clients: every item with its catalog-computed hash. */
export type IDraftView = {
  readonly base: IDraft['base']
  readonly conflicts: IDraft['conflicts']
  readonly blueprints: readonly {
    readonly id: string
    readonly hash: string
    readonly document: IBlueprint
  }[]
  readonly modules: readonly (IDraftModule & { readonly hash: string })[]
}

/** UTF-8 bytes of a string. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Catalog hash of a draft blueprint: `hashBytes` of its JSON text. */
export function blueprintHash(document: unknown): Promise<string> {
  return hashBytes(utf8(JSON.stringify(document)))
}

/** Catalog hash of a draft module: its source bytes, or its built id without source. */
export function moduleHash(module: IDraftModule): Promise<string> {
  return module.source === undefined
    ? Promise.resolve(module.built.id)
    : hashBytes(utf8(module.source))
}

/** Parsed snapshot of a stored hash. */
export async function snapshotOf(
  store: CatalogStore,
  project: string,
  hash: string
): Promise<IPartSnapshot> {
  return parseSnapshot((await store.bytes(StoreKey.snapshot(project, hash))) as Uint8Array)
}

/** Draft seeded from a snapshot: its blueprints and its modules with their recorded sources. */
async function draftFrom(store: CatalogStore, project: string, hash: string): Promise<IDraft> {
  /** Snapshot of the base. */
  const snapshot = await snapshotOf(store, project, hash)
  /** Recorded sources by module name. */
  const sources = new Map(
    (await store.json<{ name: string; source: string }[]>(StoreKey.sources(project, hash), [])).map(
      (entry) => [entry.name, entry.source]
    )
  )
  return {
    base: { snapshot: hash, tag: snapshot.lock.tag },
    conflicts: [],
    blueprints: snapshot.blueprints.map((document) => ({ id: document.id, document })),
    modules: snapshot.lock.modules.map((built) => {
      /** Recorded source of the module. */
      const source = sources.get(built.name)
      return source === undefined
        ? { name: built.name, built }
        : { name: built.name, source, built }
    })
  }
}

/** Current draft, created from the dev pointer on first read; undefined when dev is unpublished. */
export async function loadDraft(store: CatalogStore, project: string): Promise<IDraft | undefined> {
  /** Stored draft. */
  const stored = await store.json<IDraft | null>(StoreKey.draft(project), null)
  if (stored !== null) return stored
  /** Dev pointer. */
  const dev = (await store.json<IProjectRecord | null>(StoreKey.project(project), null))?.envs.dev
    .snapshot
  if (dev === undefined) return undefined
  /** Seeded draft. */
  const draft = await draftFrom(store, project, dev)
  await store.putJson(StoreKey.draft(project), draft)
  return draft
}

/** Draft with hashes for clients. */
export async function draftView(draft: IDraft): Promise<IDraftView> {
  return {
    base: draft.base,
    conflicts: draft.conflicts,
    blueprints: await Promise.all(
      draft.blueprints.map(async (entry) => ({
        ...entry,
        hash: await blueprintHash(entry.document)
      }))
    ),
    modules: await Promise.all(
      draft.modules.map(async (module) => ({ ...module, hash: await moduleHash(module) }))
    )
  }
}

/** Issue reported for an artifact the catalog refuses before any rule runs. */
function artifactIssue(path: string, rule: string, basis: string): IIssue {
  return {
    address: '',
    facet: 'changeset',
    path,
    code: rule,
    rule,
    messageKey: rule,
    severity: 'error',
    basis
  }
}

/** Working state of one changeset: copies of the draft lists and the new module bytes. */
type IWorking = {
  readonly blueprints: Map<string, IBlueprint>
  readonly modules: Map<string, IDraftModule>
  readonly bytes: Map<string, Uint8Array>
  readonly targets: IAuditTarget[]
}

/** One artifact's outcome. */
type IOutcome = { readonly status: ChangesetStatus; readonly issues: readonly IIssue[] }

/** Context of one changeset: the draft, base descriptors and the project directory for builds. */
type IChangesetContext = {
  readonly draft: IDraft
  readonly descriptors: readonly IDescriptor[]
  readonly projectDir: string | undefined
  readonly working: IWorking
}

/** Current catalog hash of an artifact's target, or null when it does not exist. */
async function currentHash(
  context: IChangesetContext,
  artifact: IChangesetArtifact
): Promise<string | null> {
  /** Target kind and key. */
  const isBlueprint =
    artifact.kind === 'blueprint' || (artifact.kind === 'remove' && artifact.target === 'blueprint')
  /** Key of the target. */
  const key = artifactKey(artifact)
  if (isBlueprint) {
    /** Current document. */
    const document = context.working.blueprints.get(key)
    return document === undefined ? null : blueprintHash(document)
  }
  /** Current module. */
  const module = context.working.modules.get(key)
  return module === undefined ? null : moduleHash(module)
}

/** Descriptors the rules see: base snapshot descriptors plus stubs for draft module exports. */
function ruleDescriptors(context: IChangesetContext): IDescriptor[] {
  /** Known ids. */
  const ids = new Set(context.descriptors.map((descriptor) => descriptor.id))
  /** Result list. */
  const list = [...context.descriptors]
  for (const module of context.working.modules.values())
    for (const entry of module.built.exports)
      if (!ids.has(entry.id)) {
        ids.add(entry.id)
        list.push({ kind: entry.kind, id: entry.id })
      }
  return list
}

/**
 * Document after a patch. A single `add` or `replace` at the root pointer `''` sets the whole
 * document (how a new blueprint is created); everything else goes through `applyPatch`.
 */
function patched(
  before: IBlueprint | undefined,
  patch: Extract<IChangesetArtifact, { kind: 'blueprint' }>['patch']
): unknown {
  /** Only operation, when there is one. */
  const only = patch.length === 1 ? patch[0] : undefined
  if (only !== undefined && only.path === '' && (only.op === 'add' || only.op === 'replace'))
    return only.value
  return applyPatch(before ?? null, patch)
}

/** Applies a blueprint artifact to the working copy. */
function applyBlueprint(
  context: IChangesetContext,
  artifact: Extract<IChangesetArtifact, { kind: 'blueprint' }>
): IOutcome {
  /** Current document. */
  const before = context.working.blueprints.get(artifact.id)
  /** Patched document. */
  let after: IBlueprint
  try {
    after = parseBlueprint(patched(before, artifact.patch)) as IBlueprint
  } catch (error) {
    /** Code of the failure. */
    const code = (error as { code?: unknown }).code
    return {
      status: ChangesetStatus.rejected,
      issues: [
        artifactIssue(
          artifact.id,
          code === 'PATCH_OP_UNSUPPORTED' ? CatalogRule.patchOp : String(code),
          String((error as Error).message)
        )
      ]
    }
  }
  /** Rule errors against the base descriptors and draft modules. */
  const issues = blueprintIssues(after, descriptorView(ruleDescriptors(context))).filter(
    (issue) => issue.severity === 'error'
  )
  if (issues.length > 0) return { status: ChangesetStatus.rejected, issues }
  context.working.blueprints.set(artifact.id, after)
  for (const target of auditTargets(before, after))
    context.working.targets.push({ ...target, blueprint: artifact.id })
  return { status: ChangesetStatus.accepted, issues: [] }
}

/** Builds a module artifact and applies it to the working copy. */
async function applyModule(
  context: IChangesetContext,
  artifact: Extract<IChangesetArtifact, { kind: 'module' }>
): Promise<IOutcome> {
  if (!isModuleName(artifact.name))
    return {
      status: ChangesetStatus.rejected,
      issues: [artifactIssue(artifact.name, CatalogRule.moduleName, artifact.name)]
    }
  if (context.projectDir === undefined)
    return {
      status: ChangesetStatus.rejected,
      issues: [artifactIssue(artifact.name, CatalogRule.remoteBuild, 'no --project-dir')]
    }
  /** Build result. */
  const built = await buildDraftModule(context.projectDir, artifact.name, artifact.source)
  if (built.module === undefined) return { status: ChangesetStatus.rejected, issues: built.issues }
  /** Draft reference served from the draft module route. */
  const ref = { ...built.module, url: `drafts/${built.module.url}` }
  context.working.modules.set(artifact.name, {
    name: artifact.name,
    source: artifact.source,
    built: ref
  })
  context.working.bytes.set(built.module.url.slice('m/'.length), built.bytes as Uint8Array)
  context.working.targets.push({ module: artifact.name })
  return { status: ChangesetStatus.accepted, issues: [] }
}

/** Applies one artifact after its base check. */
async function applyArtifact(
  context: IChangesetContext,
  artifact: IChangesetArtifact
): Promise<IOutcome> {
  if (checkBase(await currentHash(context, artifact), artifact) === ChangesetStatus.conflict)
    return { status: ChangesetStatus.conflict, issues: [] }
  if (artifact.kind === 'blueprint') return applyBlueprint(context, artifact)
  if (artifact.kind === 'module') return applyModule(context, artifact)
  if (artifact.target === 'blueprint') context.working.blueprints.delete(artifact.key)
  else context.working.modules.delete(artifact.key)
  context.working.targets.push(
    artifact.target === 'blueprint' ? { blueprint: artifact.key } : { module: artifact.key }
  )
  return { status: ChangesetStatus.accepted, issues: [] }
}

/** Result of a processed changeset and, when accepted, the draft to write. */
export type IChangesetOutcome = {
  readonly result: IChangesetResult
  readonly draft?: IDraft
  readonly bytes: ReadonlyMap<string, Uint8Array>
  readonly targets: readonly IAuditTarget[]
}

/**
 * Processes a changeset against the draft in artifact order. Any rejected or conflicting artifact
 * makes the whole changeset not apply; accepted ones are then reported as `skipped`.
 */
export async function processChangeset(
  store: CatalogStore,
  project: string,
  draft: IDraft,
  changeset: IChangeset,
  projectDir: string | undefined
): Promise<IChangesetOutcome> {
  /** Working copy. */
  const working: IWorking = {
    blueprints: new Map(draft.blueprints.map((entry) => [entry.id, entry.document])),
    modules: new Map(draft.modules.map((module) => [module.name, module])),
    bytes: new Map(),
    targets: []
  }
  /** Context of this changeset. */
  const context: IChangesetContext = {
    draft,
    descriptors: (await snapshotOf(store, project, draft.base.snapshot)).descriptors,
    projectDir,
    working
  }
  /** Outcomes in artifact order. */
  const outcomes: IOutcome[] = []
  for (const artifact of changeset.artifacts) outcomes.push(await applyArtifact(context, artifact))
  /** Whether every artifact was accepted. */
  const ok = outcomes.every((outcome) => outcome.status === ChangesetStatus.accepted)
  /** Next draft when accepted. */
  const next: IDraft = {
    base: draft.base,
    conflicts: draft.conflicts,
    blueprints: [...working.blueprints].map(([id, document]) => ({ id, document })),
    modules: [...working.modules.values()]
  }
  /** Result per artifact. */
  const artifacts = await Promise.all(
    changeset.artifacts.map(async (artifact, index) => {
      /** Outcome of the artifact. */
      const outcome = outcomes[index] as IOutcome
      /** Status after the all-or-nothing rule. */
      const status =
        !ok && outcome.status === ChangesetStatus.accepted
          ? ChangesetStatus.skipped
          : outcome.status
      /** New hash of an applied artifact. */
      const hash = ok ? await currentHash(context, artifact) : null
      return {
        key: artifactKey(artifact),
        status,
        issues: outcome.issues,
        ...(hash === null ? {} : { hash })
      }
    })
  )
  return ok
    ? { result: { ok, artifacts }, draft: next, bytes: working.bytes, targets: working.targets }
    : { result: { ok, artifacts }, bytes: new Map(), targets: working.targets }
}

/** Writes an accepted draft and its module bytes in one transaction. */
export async function writeDraft(
  store: CatalogStore,
  project: string,
  draft: IDraft,
  bytes: ReadonlyMap<string, Uint8Array>
): Promise<void> {
  await store.transaction(async (tx: ICatalogKv) => {
    for (const [file, value] of bytes)
      await store.putBytes(StoreKey.draftModule(project, file), value, tx)
    await store.putJson(StoreKey.draft(project), draft, tx)
  })
}

/** JSON text of a value for equality, `undefined` for absent items. */
function same(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

/** Rebase decision of one item: the value to keep (undefined = absent) or a conflict. */
type IRebaseItem<T> = { readonly value?: T; readonly conflict?: true }

/**
 * Per-item rebase rule shared by blueprints and modules: untouched draft items take the new
 * version; draft-only changes stay; both-changed items merge (blueprints) or must be identical.
 */
function rebaseItem<T>(
  base: T | undefined,
  draft: T | undefined,
  next: T | undefined,
  merge: (b: T, d: T, n: T) => IRebaseItem<T>
): IRebaseItem<T> {
  if (same(draft, base)) return next === undefined ? {} : { value: next }
  if (same(next, base) || same(next, draft)) return draft === undefined ? {} : { value: draft }
  if (base !== undefined && draft !== undefined && next !== undefined)
    return merge(base, draft, next)
  return { conflict: true }
}

/** Blueprint merge for rebase: a clean merge takes the merged document. */
function mergeDocuments(
  base: IBlueprint,
  draft: IBlueprint,
  next: IBlueprint,
  conflicts: IDraftConflict[]
): IRebaseItem<IBlueprint> {
  /** Merge result. */
  const merged = mergeBlueprint(base, draft, next)
  if (merged.conflicts.length === 0) return { value: merged.merged }
  for (const conflict of merged.conflicts)
    conflicts.push({ blueprint: base.id, address: conflict.address, facet: conflict.facet })
  return { conflict: true }
}

/** Comparable content of a module: its source, or its built id without source. */
function moduleContent(module: IDraftModule | undefined): string | undefined {
  return module === undefined ? undefined : (module.source ?? module.built.id)
}

/**
 * Rebases the draft when the dev pointer moves from S to S′. Clean results move the draft to S′ and
 * clear conflicts; any conflict keeps the draft on S, unchanged, with the conflicts listed.
 */
export async function rebaseDraft(
  store: CatalogStore,
  project: string,
  nextHash: string
): Promise<void> {
  /** Stored draft; nothing to do without one. */
  const draft = await store.json<IDraft | null>(StoreKey.draft(project), null)
  if (draft === null || draft.base.snapshot === nextHash) return
  /** Base and next versions as drafts. */
  const base = await draftFrom(store, project, draft.base.snapshot)
  const next = await draftFrom(store, project, nextHash)
  /** Conflicts found. */
  const conflicts: IDraftConflict[] = []
  /** Blueprints by id for each side. */
  const maps = [base, draft, next].map(
    (side) => new Map(side.blueprints.map((entry) => [entry.id, entry.document]))
  )
  /** Ids in next order, then draft-only. */
  const ids = new Set([
    ...(maps[2] as Map<string, IBlueprint>).keys(),
    ...(maps[1] as Map<string, IBlueprint>).keys()
  ])
  /** Rebased blueprints. */
  const blueprints: { id: string; document: IBlueprint }[] = []
  for (const id of ids) {
    /** Decision for the blueprint. */
    const item = rebaseItem(maps[0]?.get(id), maps[1]?.get(id), maps[2]?.get(id), (b, d, n) =>
      mergeDocuments(b, d, n, conflicts)
    )
    // Each id is visited once and a merge appends its node conflicts last, so checking the last
    // entry tells whether this blueprint already has one.
    if (item.conflict === true && conflicts.at(-1)?.blueprint !== id)
      conflicts.push({ blueprint: id })
    if (item.value !== undefined) blueprints.push({ id, document: item.value })
  }
  /** Modules by name for each side. */
  const modules = [base, draft, next].map(
    (side) => new Map(side.modules.map((module) => [module.name, module]))
  )
  /** Names in next order, then draft-only. */
  const names = new Set([
    ...(modules[2] as Map<string, IDraftModule>).keys(),
    ...(modules[1] as Map<string, IDraftModule>).keys()
  ])
  /** Rebased modules. */
  const rebased: IDraftModule[] = []
  for (const name of names) {
    /** Contents of the three sides. */
    const [b, d, n] = modules.map((side) => side.get(name))
    /** Decision by content. */
    const item = rebaseItem(moduleContent(b), moduleContent(d), moduleContent(n), () => ({
      conflict: true
    }))
    if (item.conflict === true) conflicts.push({ module: name })
    else if (item.value !== undefined)
      rebased.push((item.value === moduleContent(d) ? d : n) as IDraftModule)
  }
  if (conflicts.length > 0) {
    await store.putJson(StoreKey.draft(project), { ...draft, conflicts })
    return
  }
  await store.putJson(StoreKey.draft(project), {
    base: next.base,
    conflicts: [],
    blueprints,
    modules: rebased
  } satisfies IDraft)
}
