import { hashBytes } from '@migaia/part-contract'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError } from '../errors.ts'
import { resolveFromNodeModules } from '../project.ts'
import { RemoteText } from './text.ts'
import { SHARED_RUNTIME } from './rules.ts'

/** Global key under which the page (or the contract test) places the shared runtime namespaces. */
export const SHARED_GLOBAL_KEY = 'migaia.part.shared'

/** Namespace prefix of shim modules inside the bundler. */
const SHIM_NAMESPACE = 'partom-shared'

/** Shared runtime specifiers as a set for lookups. */
const SHARED = new Set<string>(SHARED_RUNTIME)

/** Identifier pattern; export names that are not plain identifiers are left out of the shim. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Source of the shim module standing in for one shared package: it reads the namespace the page
 * placed on the shared global and re-exports its names. `names` come from the project's own copy of
 * the package, in the namespace's key order (fixed by the language).
 */
export function shimSource(specifier: string, names: readonly string[]): string {
  /** Named exports other than `default`. */
  const named = names.filter((key) => key !== 'default' && IDENTIFIER.test(key))
  /** Shim lines. */
  const lines = [
    `const m = globalThis[Symbol.for(${JSON.stringify(SHARED_GLOBAL_KEY)})][${JSON.stringify(specifier)}];`
  ]
  if (named.length > 0) lines.push(`export const { ${named.join(', ')} } = m;`)
  if (names.includes('default')) lines.push('export default m.default;')
  return `${lines.join('\n')}\n`
}

/**
 * Export names of a shared package as the project resolves it. The package is imported in a Bun
 * child (`BUN_BE_BUN` makes the compiled executable act as `bun`), because compiled-mode imports
 * cannot follow the project's scoped, symlinked packages.
 */
async function exportNames(specifier: string, project: string): Promise<readonly string[]> {
  /** Resolved file from the project's node_modules. */
  const file = resolveFromNodeModules(specifier, project) ?? Bun.resolveSync(specifier, project)
  /** Child listing the module's export names as JSON. */
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(file)}))))`
    ],
    {
      cwd: project,
      env: { PATH: process.env.PATH ?? '', BUN_BE_BUN: '1' },
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  /** Output and exit code. */
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  if (code !== 0)
    throw createPartCliError(
      PartCliErrorCode.harnessFailed,
      RemoteText.buildFailed(specifier),
      new Error(stderr)
    )
  return JSON.parse(stdout.trim().split('\n').pop() as string) as string[]
}

/** Bundler plugin replacing shared runtime imports with shim modules. */
function sharedShimPlugin(project: string): Bun.BunPlugin {
  return {
    name: 'partom-shared-shim',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) =>
        SHARED.has(args.path) ? { path: args.path, namespace: SHIM_NAMESPACE } : undefined
      )
      build.onLoad({ filter: /.*/, namespace: SHIM_NAMESPACE }, async (args) => ({
        contents: shimSource(args.path, await exportNames(args.path, project)),
        loader: 'js'
      }))
    }
  }
}

/** Built module bytes with their content hash and SRI value. */
export type IBuiltModule = {
  readonly bytes: Uint8Array
  readonly id: string
  readonly integrity: string
  readonly file: string
}

/** SRI value (`sha384-<base64>`) of bytes. */
async function sri384(bytes: Uint8Array): Promise<string> {
  /** Digest bytes. */
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', bytes.slice().buffer))
  return `sha384-${Buffer.from(digest).toString('base64')}`
}

/**
 * Builds one entry as browser ESM without minification or source maps, so equal inputs give equal
 * bytes; shared runtime imports become shims reading the shared global. The file name is the
 * base64url part of the content hash plus `.js`.
 */
export async function buildEntry(entry: string, project: string): Promise<IBuiltModule> {
  /** Bundler result. */
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    plugins: [sharedShimPlugin(project)]
  })
  if (!result.success)
    throw createPartCliError(
      PartCliErrorCode.harnessFailed,
      RemoteText.buildFailed(entry),
      new AggregateError(result.logs)
    )
  /** Built bytes. */
  const bytes = new Uint8Array(await (result.outputs[0] as Blob).arrayBuffer())
  /** Content hash. */
  const id = await hashBytes(bytes)
  return { bytes, id, integrity: await sri384(bytes), file: `${id.slice('sha256-'.length)}.js` }
}
