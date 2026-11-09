import {
  missingBuildTool,
  exceededBudget,
  unexpectedExternal,
  hanOutput,
  forbiddenInput
} from './bundle-size-text.ts'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

/** Source root follows this script, never the caller's current directory or built dist. */
const repository = fileURLToPath(new URL('../', import.meta.url))
/**
 * Rolldown chunk fields this script reads; the tool is not a declared dependency, so no types
 * import.
 */
type IRolldownChunk = {
  code: string
  imports: string[]
  modules: Record<string, { renderedLength: number }>
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
}
/**
 * Load the installed rolldown through the lockfile store, without adding a runtime dependency.
 * Throws when no rolldown version is installed.
 */
async function loadRolldown(): Promise<{ rolldown: (options: object) => Promise<any> }> {
  /** Store directory name of the pinned bundler version. */
  const installed = readdirSync(join(repository, 'node_modules/.pnpm')).find((name) =>
    name.startsWith('rolldown@')
  )
  if (!installed) throw new Error(missingBuildTool)
  return import(
    pathToFileURL(
      join(repository, 'node_modules/.pnpm', installed, 'node_modules/rolldown/dist/index.mjs')
    ).href
  )
}
/**
 * Map every public workspace export to its owning TypeScript source. Exact specifier keys follow
 * each manifest's export conditions, so the bundle measures source rather than built dist. Static
 * resolver options replace a JS resolve hook, which keeps the bundler's output deterministic.
 */
function sourceAliases(): Record<string, string> {
  /** Public specifier to absolute source file, one entry per manifest export key. */
  const alias: Record<string, string> = {}
  for (const name of readdirSync(join(repository, 'packages'))) {
    /** Directories without a manifest are not packages. */
    const file = join(repository, 'packages', name, 'package.json')
    if (!existsSync(file)) continue
    /** Each manifest remains the authority for both root and subpath resolution. */
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries<unknown>(manifest.exports ?? {})) {
      /** Prefer declaration provenance so multi-entry builds still resolve their real source owner. */
      let target = value as any
      if (target && typeof target === 'object' && typeof target.types === 'string')
        target = target.types
      while (target && typeof target === 'object')
        target = target.browser ?? target.import ?? target.default
      if (typeof target !== 'string') continue
      alias[manifest.name + (key === '.' ? '' : key.slice(1))] = resolve(
        repository,
        'packages',
        name,
        target.replace(/^\.\/dist\//, './src/').replace(/\.d\.ts$|\.js$/, '.ts')
      )
    }
  }
  return alias
}
/** Measure an entry and all workspace dependencies using the installed pinned bundler. */
export async function measureBundle(entry: string): Promise<IBundleMeasurement> {
  const { rolldown } = await loadRolldown()
  /** One build graph; its loaded files and its single output chunk describe the same artifact. */
  const build = await rolldown({
    input: resolve(entry),
    cwd: repository,
    platform: 'browser',
    external: [/^node:/],
    resolve: { alias: sourceAliases() },
    // Package tsconfig paths point some workspace imports at built declarations; ignore them.
    tsconfig: false,
    transform: { target: 'es2022' },
    logLevel: 'silent'
  })
  /** Every file the build loaded, including tree-shaken ones, for graph assertions. */
  let loaded: string[]
  /** The single minified ESM chunk that is scanned and compressed below. */
  let chunk: IRolldownChunk
  try {
    chunk = (await build.generate({ format: 'esm', minify: true, codeSplitting: false })).output[0]
    loaded = await build.watchFiles
  } finally {
    await build.close()
  }
  /** Compression and Han scanning consume this one exact UTF-8 minified output. */
  const bytes = new TextEncoder().encode(chunk.code)
  /** Byte contribution belongs to each actual input package, not an additive gzip estimate. */
  const packages: Record<string, number> = {}
  for (const [path, value] of Object.entries(chunk.modules)) {
    /** Repository-relative ownership survives caller-specific absolute entry paths. */
    const owner = /(?:^|\/)packages\/([^/]+)\//.exec(path)?.[1] ?? 'entry'
    packages[owner] = (packages[owner] ?? 0) + value.renderedLength
  }
  /** Unexpected workspace externals are reported, never accepted as size savings. */
  const external = [...chunk.imports]
  /** Repository-relative source paths; virtual bundler modules carry a NUL prefix and are skipped. */
  const inputs = loaded
    .filter((path) => !path.startsWith('\0'))
    .map((path) => relative(repository, path))
  /** Original byte offsets are reported for the actual bundled output. */
  const code = chunk.code
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
    code
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
