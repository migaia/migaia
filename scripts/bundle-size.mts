import {
  missingBuildTool,
  missingExport,
  exceededBudget,
  unexpectedExternal,
  hanOutput,
  forbiddenInput
} from './bundle-size-text.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'

/** Source root follows this script, never the caller's current directory or built dist. */
const repository = fileURLToPath(new URL('../', import.meta.url))
/** JSON export maps resolve workspace entries to the real owning TypeScript source. */
class SourceEntries {
  /** Register only workspace packages; Node built-ins remain explicit externals. */
  install(build: {
    onResolve(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { path: string }
    ): void
  }): void {
    build.onResolve({ filter: /^@migaia\// }, (args) => this.resolve(args.path))
  }
  /** Follow public export conditions rather than guessing a package's root source file. */
  resolve(specifier: string): { path: string } {
    /** Package segments separate its owner from an optional public subpath. */
    const parts = specifier.split('/')
    /** Each manifest remains the authority for both root and subpath resolution. */
    const directory = join(repository, 'packages', parts[1]!)
    /** Export conditions may supply a declaration filename different from the runtime filename. */
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    /** Public subpaths are exact keys, matching the repository's package manifests. */
    const key = parts.length === 2 ? '.' : './' + parts.slice(2).join('/')
    /** Prefer declaration provenance so multi-entry builds still resolve their real source owner. */
    let target = manifest.exports[key]
    if (target && typeof target === 'object' && typeof target.types === 'string')
      target = target.types
    while (target && typeof target === 'object')
      target = target.browser ?? target.import ?? target.default
    if (typeof target !== 'string') throw new TypeError(missingExport(specifier))
    return {
      path: resolve(
        directory,
        target.replace(/^\.\/dist\//, './src/').replace(/\.d\.ts$|\.js$/, '.ts')
      )
    }
  }
}
/** One measurement carries the exact minified artifact and its original source attribution. */
export type IBundleMeasurement = {
  entry: string
  min: number
  gzip: number
  packages: Readonly<Record<string, number>>
  inputs: readonly string[]
  external: readonly string[]
  han: readonly { index: number; text: string; sources: readonly string[] }[]
  code: string
  metafile: object
}
/** Measure an entry and all workspace dependencies using the installed pinned build tool. */
export async function measureBundle(entry: string): Promise<IBundleMeasurement> {
  /** Build-tool lookup uses the installed lockfile dependency, without adding a runtime dependency. */
  const installed = readdirSync(join(repository, 'node_modules/.pnpm')).find((name) =>
    name.startsWith('esbuild@')
  )
  if (!installed) throw new Error(missingBuildTool)
  /** The tool is loaded through its own package so native optional dependencies resolve normally. */
  const require = createRequire(
    join(repository, 'node_modules/.pnpm', installed, 'node_modules/esbuild/package.json')
  )
  /** One source resolver instance owns this bundle's public package interpretation. */
  const sources = new SourceEntries()
  /** Build metadata describes the same artifact scanned and compressed below. */
  const result = await require('esbuild').build({
    absWorkingDir: repository,
    entryPoints: [resolve(entry)],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    charset: 'utf8',
    write: false,
    metafile: true,
    external: ['node:*'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'workspace-source',
        setup: (build: Parameters<SourceEntries['install']>[0]) => sources.install(build)
      }
    ]
  })
  /** Compression and Han scanning consume this one exact UTF-8 minified output. */
  const bytes: Uint8Array = result.outputFiles[0].contents
  /** Byte contribution belongs to each actual input package, not an additive gzip estimate. */
  const packages: Record<string, number> = {}
  /** Unexpected workspace externals are reported, never accepted as size savings. */
  const external: string[] = []
  for (const output of Object.values(result.metafile.outputs) as {
    inputs: Record<string, { bytesInOutput: number }>
    imports: { external?: boolean; path: string }[]
  }[]) {
    for (const [path, value] of Object.entries(output.inputs)) {
      /** Repository-relative ownership survives caller-specific absolute entry paths. */
      const owner = /(?:^|\/)packages\/([^/]+)\//.exec(path)?.[1] ?? 'entry'
      packages[owner] = (packages[owner] ?? 0) + value.bytesInOutput
    }
    for (const dependency of output.imports) if (dependency.external) external.push(dependency.path)
  }
  /** Source paths permit graph assertions independently of compressed byte counts. */
  const inputs = Object.keys(result.metafile.inputs)
  /** Original byte offsets are reported for the actual bundled output. */
  const code = new TextDecoder().decode(bytes)
  /** Index original source sequences once; diagnostics never rescan every input for every hit. */
  const sourceSequences = new Map<string, string[]>()
  for (const input of inputs) {
    /** Repeated literals in one file need only one source attribution. */
    const sequences = new Set(
      readFileSync(resolve(repository, input), 'utf8').match(/\p{Script=Han}+/gu) ?? []
    )
    for (const sequence of sequences) {
      /** Source contribution lists grow only with actual occurrences in distinct input files. */
      let files = sourceSequences.get(sequence)
      if (!files) sourceSequences.set(sequence, (files = []))
      files.push(input)
    }
  }
  /** Source candidates describe provenance while scanning only the measured minified output. */
  const han: { index: number; text: string; sources: readonly string[] }[] = []
  for (const match of code.matchAll(/\p{Script=Han}+/gu))
    han.push({ index: match.index!, text: match[0], sources: sourceSequences.get(match[0]) ?? [] })
  return {
    entry: relative(repository, resolve(entry)),
    min: bytes.byteLength,
    gzip: gzipSync(bytes).byteLength,
    packages,
    inputs,
    external,
    han,
    code,
    metafile: result.metafile
  }
}
/** Check a declared budget row without rewriting its baseline or weakening graph assertions. */
export function bundleViolations(
  result: IBundleMeasurement,
  budget: { gzip: number; forbidden: readonly string[] }
): readonly string[] {
  /** Every independently violated contract remains visible to the caller. */
  const failures: string[] = []
  if (result.gzip > budget.gzip) failures.push(exceededBudget(result.gzip, budget.gzip))
  for (const name of result.external)
    if (!name.startsWith('node:')) failures.push(unexpectedExternal(name))
  for (const hit of result.han) failures.push(hanOutput(hit.index, hit.text, hit.sources))
  for (const pattern of budget.forbidden)
    for (const input of result.inputs)
      if (matchesInput(input, pattern)) failures.push(forbiddenInput(input))
  return failures
}
/** Match repository glob fragments while keeping package/file ownership visible in diagnostics. */
function matchesInput(input: string, pattern: string): boolean {
  /** Glob separators match full paths; double-star also spans nested directories. */
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replaceAll('\u0000', '.*')
  return new RegExp('(?:^|/)' + escaped + '$').test(input)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  /** CLI entry must be supplied explicitly; imports never trigger a build. */
  const result = await measureBundle(process.argv[2]!)
  console.log(JSON.stringify(result))
  if (result.han.length || result.external.some((name) => !name.startsWith('node:')))
    process.exitCode = 1
}
