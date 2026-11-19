/**
 * `partom build [--tag <tag>] [--out partom-build]`: lock file, snapshot, remote modules and
 * sources.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  hashBytes,
  type IIssue,
  type IPartSnapshot,
  type IRemoteModuleRef
} from '@migaia/part-contract'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { remoteBuild } from '../remote/command.ts'
import { releaseData, releaseProject } from './child.ts'
import type { IReleaseData } from './collect.ts'
import { remoteEntries } from './collect.ts'
import { releaseTag } from './git.ts'
import { BuildFile, DEFAULT_BUILD_DIR, ReleaseMode, ReleaseText } from './text.ts'

/** UTF-8 bytes of a text. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Error issues of the child data: remote conflicts and every blueprint's static errors. */
function errorIssues(data: IReleaseData): IIssue[] {
  return [...data.issues, ...data.blueprints.flatMap((entry) => entry.issues)].filter(
    (issue) => issue.severity === 'error'
  )
}

/** Removes the previous build output files (only the documented ones) and recreates `out`. */
function resetOut(out: string): void {
  for (const name of Object.values(BuildFile))
    rmSync(join(out, name), { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
}

/** Builds the remote modules into `<out>/m/`; returns their references and source records. */
async function buildModules(
  dir: string,
  data: IReleaseData,
  out: string
): Promise<{
  readonly modules: readonly IRemoteModuleRef[]
  readonly sources: { name: string; source: string }[]
  readonly issues: readonly IIssue[]
}> {
  /** Remote entries. */
  const entries = remoteEntries(dir, data.release)
  if (entries.length === 0 || data.release.remote === undefined)
    return { modules: [], sources: [], issues: [] }
  /** Remote module root. */
  const root = resolve(dir, data.release.remote.root)
  /** Pipeline result. */
  const result = await remoteBuild({ entries, out, root, project: dir })
  rmSync(join(out, BuildFile.remoteList), { force: true })
  return {
    modules: result.modules,
    sources: result.modules.map((module) => ({
      name: module.name,
      source: readFileSync(join(root, module.name), 'utf8')
    })),
    issues: result.issues
  }
}

/** Snapshot of the release: lock, authored blueprints and descriptors. */
async function snapshotOf(
  dir: string,
  project: string,
  tag: string,
  data: IReleaseData,
  modules: readonly IRemoteModuleRef[]
): Promise<IPartSnapshot> {
  /** Lock entries and documents of the blueprints, in config order. */
  const blueprints: { id: string; version: number; hash: string }[] = []
  /** Authored documents. */
  const documents: IPartSnapshot['blueprints'][number][] = []
  for (const entry of data.blueprints) {
    /** File bytes. */
    const bytes = readFileSync(join(dir, entry.file))
    /** Authored document. */
    const document = JSON.parse(bytes.toString('utf8')) as IPartSnapshot['blueprints'][number]
    blueprints.push({ id: document.id, version: document.version, hash: await hashBytes(bytes) })
    documents.push(document)
  }
  return {
    lock: {
      format: 1,
      project,
      tag,
      blueprints,
      definitions: data.definitions ?? [],
      modules
    },
    blueprints: documents,
    descriptors: data.descriptors ?? []
  }
}

/**
 * Runs `partom build`. Only a clean tagged HEAD builds (RELEASE_DIRTY, exit 2). Static errors of
 * any blueprint, `release.remote-in-config` and failed remote modules print `{ issues }` and exit 1
 * without output. Equal tags produce byte-identical output.
 */
export async function buildCommand(args: IArgs): Promise<number> {
  /** Project directory. */
  const dir = resolve(flag(args, '--project') ?? process.cwd())
  /** Release tag. */
  const tag = releaseTag(dir, flag(args, '--tag'))
  /** Child data with remote modules installed. */
  const data = await releaseData(dir, flag(args, '--config'), [ReleaseMode.snapshot])
  /** Catalog project. */
  const project = releaseProject(data, ReleaseText.configMissing)
  /** Errors found so far. */
  const issues = errorIssues(data)
  if (issues.length > 0) {
    console.log(JSON.stringify({ issues }))
    return ExitCode.problems
  }
  /** Output directory. */
  const out = resolve(dir, flag(args, '--out') ?? DEFAULT_BUILD_DIR)
  resetOut(out)
  /** Built modules. */
  const built = await buildModules(dir, data, out)
  if (built.issues.length > 0) {
    console.log(JSON.stringify({ issues: built.issues }))
    return ExitCode.problems
  }
  /** Snapshot bytes. */
  const bytes = utf8(JSON.stringify(await snapshotOf(dir, project, tag, data, built.modules)))
  writeFileSync(join(out, BuildFile.snapshot), bytes)
  writeFileSync(join(out, BuildFile.sources), JSON.stringify({ modules: built.sources }))
  console.log(
    JSON.stringify({
      tag,
      snapshot: await hashBytes(bytes),
      blueprints: data.blueprints.map((entry) => entry.id),
      modules: built.modules.map((module) => module.name),
      out: relative(dir, out)
    })
  )
  return ExitCode.ok
}
