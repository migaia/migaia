/** `partom manifest [--out <file>] [--build <name>] [--inline <id,...>] [--budgets]`. */
import { readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { IDescriptor, IIssue } from '@migaia/part-contract'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { writeGenerated, WriteOutcome } from '../import/ownership.ts'
import { PartCliText } from '../errors.ts'
import { budgetIssues } from './budgets.ts'
import { releaseData, releaseProject } from './child.ts'
import type { IReleaseData } from './collect.ts'
import { clientModuleText, type IClientChunk } from './client-module.ts'
import {
  DEFAULT_BUILD_NAME,
  DEFAULT_CLIENT_MODULE,
  INLINE_TAG,
  ReleaseMode,
  ReleaseText
} from './text.ts'

/** Import specifier of a part module relative to the generated file, `./`-prefixed, `/`-separated. */
function specifierOf(fromDir: string, file: string): string {
  /** Relative path. */
  const path = relative(fromDir, file).split(sep).join('/')
  return path.startsWith('.') ? path : `./${path}`
}

/** Snapshot text of the inlined blueprints, with their definitions and descriptors. */
function inlinedText(
  dir: string,
  project: string,
  data: IReleaseData,
  ids: readonly string[]
): string {
  /** Requested ids. */
  const wanted = new Set(ids)
  /** Inlined blueprint entries, in config order. */
  const entries = data.blueprints.filter((entry) => wanted.has(entry.id))
  /** Referenced definitions, first occurrence once. */
  const definitions = [...new Set(entries.flatMap((entry) => entry.definitions ?? []))]
  /** Catalog descriptors by id. */
  const byId = new Map((data.descriptors ?? []).map((descriptor) => [descriptor.id, descriptor]))
  return JSON.stringify({
    lock: {
      format: 1,
      project,
      tag: INLINE_TAG,
      blueprints: entries.map((entry) => ({ id: entry.id, version: 1, hash: '' })),
      definitions,
      modules: []
    },
    blueprints: entries.map((entry) => JSON.parse(readFileSync(join(dir, entry.file), 'utf8'))),
    descriptors: definitions.flatMap((id) => {
      /** Descriptor of the id. */
      const descriptor = byId.get(id)
      return descriptor === undefined ? [] : [descriptor as IDescriptor]
    })
  })
}

/**
 * Manifest of the config plus the lazy parts: `lazyPartsPlugin` registers them in the client host,
 * so the client build provides them locally too.
 */
function withLazyParts(data: IReleaseData): unknown {
  /** Manifest of the config. */
  const manifest = data.manifest as { readonly definitions: readonly string[] }
  /** Definitions, config first, each once. */
  const definitions = new Set(manifest.definitions)
  for (const module of data.parts ?? []) for (const part of module.parts) definitions.add(part.id)
  return { ...manifest, definitions: [...definitions] }
}

/**
 * Runs `partom manifest`. Writes the generated client module unless the config also provides a
 * remote definition (`release.remote-in-config`, exit 1). With `--budgets`, size issues are printed
 * and exit 1, but the module is still written.
 */
export async function manifestCommand(args: IArgs): Promise<number> {
  /** Project directory. */
  const dir = resolve(flag(args, '--project') ?? process.cwd())
  /** Child data without remote modules. */
  const data = await releaseData(dir, flag(args, '--config'), [
    ReleaseMode.manifest,
    '--build',
    flag(args, '--build') ?? DEFAULT_BUILD_NAME
  ])
  /** Catalog project. */
  const project = releaseProject(data, ReleaseText.configMissing)
  if (data.issues.length > 0) {
    console.log(JSON.stringify({ issues: data.issues }))
    return ExitCode.problems
  }
  /** Generated file. */
  const out = resolve(dir, flag(args, '--out') ?? DEFAULT_CLIENT_MODULE)
  /** Inlined blueprint ids. */
  const inline = (flag(args, '--inline') ?? '').split(',').filter((id) => id !== '')
  /** Chunks of the part modules. */
  const chunks: IClientChunk[] = (data.parts ?? []).map((module) => ({
    specifier: specifierOf(dirname(out), join(dir, module.file)),
    parts: module.parts
  }))
  /** Write outcome. */
  const written = writeGenerated(
    dirname(out),
    basename(out),
    clientModuleText({
      manifest: withLazyParts(data),
      chunks,
      inlined: inline.length === 0 ? undefined : inlinedText(dir, project, data, inline)
    })
  )
  if (written === WriteOutcome.takenOver) {
    console.error(PartCliText.typesTakenOver(out))
    return ExitCode.problems
  }
  /** Size issues. */
  const issues: IIssue[] = args.flags.has('--budgets')
    ? await budgetIssues(dir, data.parts ?? [])
    : []
  console.log(JSON.stringify({ out: relative(dir, out), issues }))
  return issues.length > 0 ? ExitCode.problems : ExitCode.ok
}
