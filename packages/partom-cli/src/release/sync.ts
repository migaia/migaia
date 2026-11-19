/** `partom pull` (merge the editor draft into the workspace) and `partom push` (send local edits). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  isModuleName,
  mergeBlueprint,
  type IBlueprint,
  type IChangesetArtifact,
  type IChangesetResult
} from '@migaia/part-contract'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { releaseData, releaseProject } from './child.ts'
import { globFiles, type IReleaseData } from './collect.ts'
import { fileAt } from './git.ts'
import { required, rejected } from './publish.ts'
import { CatalogClient } from './service.ts'
import { ReleaseMode, ReleaseRule, ReleaseText } from './text.ts'

/** Draft as the catalog returns it. */
type IDraftView = {
  readonly base: { readonly snapshot: string; readonly tag: string }
  readonly conflicts: readonly unknown[]
  readonly blueprints: readonly {
    readonly id: string
    readonly hash: string
    readonly document: IBlueprint
  }[]
  readonly modules: readonly {
    readonly name: string
    readonly hash: string
    readonly source?: string
  }[]
}

/** One file write planned by `pull`. */
type IWrite = { readonly path: string; readonly text: string }

/** Pull plan: writes, conflicts and failures, all decided before anything is written. */
type IPullPlan = {
  readonly writes: IWrite[]
  readonly conflicts: {
    readonly address?: string
    readonly facet?: string
    readonly module?: string
    readonly blueprint?: string
  }[]
  readonly failed: { readonly rule: string; readonly message: string }[]
}

/** Workspace context of a sync command. */
type ISyncContext = {
  readonly dir: string
  readonly data: IReleaseData
  readonly client: CatalogClient
  readonly draft: IDraftView
}

/** Pretty JSON text of a blueprint document, as the workspace stores it. */
function blueprintText(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** Loads the release settings and the draft; returns the context or the exit code of a 4xx. */
async function context(args: IArgs): Promise<ISyncContext | number> {
  /** Project directory. */
  const dir = resolve(flag(args, '--project') ?? process.cwd())
  /** Release settings and blueprint files. */
  const data = await releaseData(dir, flag(args, '--config'), [ReleaseMode.release])
  /** Catalog client. */
  const client = new CatalogClient(
    required(args, '--service'),
    releaseProject(data, ReleaseText.configMissing)
  )
  /** Draft response. */
  const outcome = await client.call('GET', 'drafts')
  if (!outcome.ok) return rejected(outcome) as number
  return { dir, data, client, draft: (await outcome.response.json()) as IDraftView }
}

/** Absolute remote root of the release config, or undefined. */
function remoteRoot(ctx: ISyncContext): string | undefined {
  return ctx.data.release.remote === undefined
    ? undefined
    : resolve(ctx.dir, ctx.data.release.remote.root)
}

/** Merges each draft blueprint into its workspace file (base: the file at the draft's base tag). */
function planBlueprints(ctx: ISyncContext, plan: IPullPlan): void {
  /** Workspace files by blueprint id. */
  const files = new Map(ctx.data.blueprints.map((entry) => [entry.id, entry.file]))
  for (const item of ctx.draft.blueprints) {
    /** Workspace file. */
    const file = files.get(item.id)
    if (file === undefined) {
      plan.failed.push({
        rule: ReleaseRule.pullFailed,
        message: ReleaseText.noWorkspaceFile(item.id)
      })
      continue
    }
    /** Workspace text. */
    const text = readFileSync(join(ctx.dir, file), 'utf8')
    /** Ours. */
    const ours = JSON.parse(text) as IBlueprint
    /** Base at the draft's tag; a file new since then merges against ours. */
    const baseText = fileAt(ctx.dir, ctx.draft.base.tag, file)
    /** Merge result. */
    const result = mergeBlueprint(
      baseText === undefined ? ours : (JSON.parse(baseText) as IBlueprint),
      ours,
      item.document
    )
    for (const conflict of result.conflicts)
      plan.conflicts.push({ blueprint: item.id, address: conflict.address, facet: conflict.facet })
    if (JSON.stringify(result.merged) !== JSON.stringify(ours))
      plan.writes.push({ path: join(ctx.dir, file), text: blueprintText(result.merged) })
  }
}

/**
 * Writes each draft module source whose workspace file is unchanged since the base tag; a changed
 * file is a conflict. Unsafe names, or paths that leave the remote root, fail without writing.
 */
function planModules(ctx: ISyncContext, plan: IPullPlan): void {
  /** Remote root. */
  const root = remoteRoot(ctx)
  for (const module of ctx.draft.modules) {
    if (module.source === undefined || root === undefined) continue
    /** Workspace path. */
    const path = resolve(root, module.name)
    if (!isModuleName(module.name) || !path.startsWith(`${root}${sep}`)) {
      plan.failed.push({
        rule: ReleaseRule.pullFailed,
        message: ReleaseText.unsafeModule(module.name)
      })
      continue
    }
    /** Workspace text, when the file exists. */
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
    if (current === module.source) continue
    /** Text at the base tag. */
    const base = fileAt(ctx.dir, ctx.draft.base.tag, relative(ctx.dir, path))
    if (current !== base) plan.conflicts.push({ module: module.name })
    else plan.writes.push({ path, text: module.source })
  }
}

/**
 * `partom pull`: refuses a draft with rebase conflicts; otherwise merges everything in memory,
 * writes the results, and lists conflicts and failures (exit 1 when any).
 */
async function pull(args: IArgs): Promise<number> {
  /** Sync context. */
  const ctx = await context(args)
  if (typeof ctx === 'number') return ctx
  if (ctx.draft.conflicts.length > 0) {
    console.log(
      JSON.stringify({ message: ReleaseText.draftConflicts, conflicts: ctx.draft.conflicts })
    )
    return ExitCode.problems
  }
  /** Plan. */
  const plan: IPullPlan = { writes: [], conflicts: [], failed: [] }
  planBlueprints(ctx, plan)
  planModules(ctx, plan)
  /** Written paths. */
  const written: string[] = []
  for (const write of plan.writes) {
    try {
      mkdirSync(dirname(write.path), { recursive: true })
      writeFileSync(write.path, write.text)
      written.push(relative(ctx.dir, write.path))
    } catch (cause) {
      console.log(
        JSON.stringify({
          written,
          failedWrite: relative(ctx.dir, write.path),
          cause: String(cause)
        })
      )
      return ExitCode.environment
    }
  }
  console.log(JSON.stringify({ written, conflicts: plan.conflicts, failed: plan.failed }))
  return plan.conflicts.length > 0 || plan.failed.length > 0 ? ExitCode.problems : ExitCode.ok
}

/** Blueprint artifacts: workspace blueprints that differ from the base tag. */
function blueprintArtifacts(ctx: ISyncContext): IChangesetArtifact[] {
  /** Draft hashes by id. */
  const hashes = new Map(ctx.draft.blueprints.map((item) => [item.id, item.hash]))
  /** Artifacts. */
  const artifacts: IChangesetArtifact[] = []
  for (const entry of ctx.data.blueprints) {
    /** Workspace document. */
    const document = JSON.parse(readFileSync(join(ctx.dir, entry.file), 'utf8')) as IBlueprint
    /** Base text. */
    const base = fileAt(ctx.dir, ctx.draft.base.tag, entry.file)
    if (base !== undefined && JSON.stringify(JSON.parse(base)) === JSON.stringify(document))
      continue
    artifacts.push({
      kind: 'blueprint',
      id: document.id,
      base: hashes.get(document.id) ?? null,
      patch: [{ op: 'replace', path: '/root', value: document.root }]
    })
  }
  return artifacts
}

/** Module artifacts: remote module files that differ from the base tag. */
function moduleArtifacts(ctx: ISyncContext): IChangesetArtifact[] {
  /** Remote root. */
  const root = remoteRoot(ctx)
  if (root === undefined || ctx.data.release.remote === undefined) return []
  /** Draft hashes by name. */
  const hashes = new Map(ctx.draft.modules.map((item) => [item.name, item.hash]))
  /** Artifacts. */
  const artifacts: IChangesetArtifact[] = []
  for (const path of globFiles(root, ctx.data.release.remote.modules)) {
    /** Source text. */
    const source = readFileSync(path, 'utf8')
    if (fileAt(ctx.dir, ctx.draft.base.tag, relative(ctx.dir, path)) === source) continue
    /** Module name. */
    const name = relative(root, path).split(sep).join('/')
    artifacts.push({ kind: 'module', name, base: hashes.get(name) ?? null, source })
  }
  return artifacts
}

/** `partom push`: sends workspace edits since the draft's base tag as one changeset. */
async function push(args: IArgs): Promise<number> {
  /** Sync context. */
  const ctx = await context(args)
  if (typeof ctx === 'number') return ctx
  /** Changeset outcome. */
  const outcome = await ctx.client.json('POST', 'drafts/changesets', {
    project: releaseProject(ctx.data, ReleaseText.configMissing),
    provenance: { authorKind: 'human' },
    artifacts: [...blueprintArtifacts(ctx), ...moduleArtifacts(ctx)]
  })
  if (!outcome.ok) return rejected(outcome) as number
  /** Result. */
  const result = (await outcome.response.json()) as IChangesetResult
  console.log(JSON.stringify(result))
  return result.artifacts.some((item) => item.status === 'rejected' || item.status === 'conflict')
    ? ExitCode.problems
    : ExitCode.ok
}

/** Draft sync commands by name. */
export const SyncCommand = { pull, push } as const
