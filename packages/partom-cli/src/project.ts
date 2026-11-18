import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PartCliErrorCode } from './error-code.ts'
import { createPartCliError, PartCliText } from './errors.ts'

/** Packages loaded from the checked project instead of being bundled into the executable. */
export const PROJECT_PACKAGES = [
  '@migaia/part-contract',
  '@migaia/part-host',
  '@migaia/part-plugin-dom',
  '@migaia/part-plugin-react',
  'react',
  'react-dom',
  '@ui-sdk/core/testing'
] as const

/** Export map entry: a path, or conditions mapping to paths. */
type IExportTarget = string | { readonly import?: IExportTarget; readonly default?: IExportTarget }

/** Picks the ESM path of an export target. */
function exportPath(target: IExportTarget | undefined): string | undefined {
  if (target === undefined || typeof target === 'string') return target
  return exportPath(target.import ?? target.default)
}

/**
 * Resolves a package specifier by walking up `node_modules` directories and reading the package's
 * export map. Compiled executables cannot always resolve scoped, symlinked workspace packages with
 * `Bun.resolveSync`, so this runs first; it returns undefined when nothing is found.
 */
export function resolveFromNodeModules(specifier: string, from: string): string | undefined {
  /** Specifier segments. */
  const segments = specifier.split('/')
  /** Package name: two segments when scoped. */
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : (segments[0] as string)
  /** Subpath after the package name. */
  const subpath = segments.slice(specifier.startsWith('@') ? 2 : 1).join('/')
  /** Directory being searched. */
  let directory = from
  while (true) {
    /** Candidate package root. */
    const root = join(directory, 'node_modules', packageName)
    if (existsSync(join(root, 'package.json'))) {
      /** Package manifest. */
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        readonly exports?: Readonly<Record<string, IExportTarget>>
        readonly main?: string
      }
      /** File from the export map or main. */
      const file =
        exportPath(manifest.exports?.[subpath === '' ? '.' : `./${subpath}`]) ??
        (subpath === '' ? (manifest.main ?? 'index.js') : undefined)
      return file === undefined ? undefined : realpathSync(join(root, file))
    }
    /** Parent directory. */
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Scoped package specifiers handled by the resolver plugin. */
const SCOPED = /^@[^/]+\/[^/]+/

/** Resolve hook arguments the plugin reads. */
type IResolveArgs = { readonly path: string; readonly importer: string }

/** Resolves a scoped specifier relative to its importer, for runtime and bundler plugins. */
function onScopedResolve(args: IResolveArgs): { readonly path: string } | undefined {
  /** Resolved file, when found by walking node_modules. */
  const path = resolveFromNodeModules(args.path, dirname(args.importer))
  return path === undefined ? undefined : { path }
}

/**
 * Plugin resolving scoped packages by walking `node_modules`. Registered for runtime imports of the
 * project config and passed to the check-page bundler, so compiled executables load project
 * packages.
 */
export const scopedResolverPlugin: Bun.BunPlugin = {
  name: 'partom-scoped-resolver',
  setup(build) {
    build.onResolve({ filter: SCOPED }, (args) => onScopedResolve(args))
  }
}

/** Config shape exported by `partom.config.ts`. */
export type IPartomConfig = {
  readonly plugins: readonly unknown[]
  readonly blueprints: readonly string[]
}

/**
 * The checked project: its directory, its resolved runtime packages and its config. One copy of
 * plugin-host and React comes from the project so plugin definitions are trusted and React is
 * single.
 */
export class Project {
  /** Absolute project directory. */
  readonly dir: string
  /** Resolved absolute paths of the project packages. */
  readonly #resolved = new Map<string, string>()

  /** Resolves every project package; a missing one is PROJECT_DEPENDENCY_MISSING. */
  constructor(dir: string) {
    this.dir = resolve(dir)
    for (const name of PROJECT_PACKAGES) {
      try {
        this.#resolved.set(
          name,
          resolveFromNodeModules(name, this.dir) ?? Bun.resolveSync(name, this.dir)
        )
      } catch (cause) {
        throw createPartCliError(
          PartCliErrorCode.projectDependencyMissing,
          PartCliText.projectDependencyMissing(name),
          cause
        )
      }
    }
  }

  /** Path of the config file: explicit, or `partom.config.ts` in the project. */
  configPath(explicit: string | undefined): string {
    /** Candidate path. */
    const path = explicit === undefined ? join(this.dir, 'partom.config.ts') : resolve(explicit)
    if (!existsSync(path))
      throw createPartCliError(
        PartCliErrorCode.configNotFound,
        PartCliText.configNotFound(this.dir)
      )
    return path
  }

  /** Loads and validates the config. */
  async config(explicit: string | undefined): Promise<IPartomConfig> {
    return (await this.bundle(explicit)).config
  }

  /**
   * Bundles the config together with the project's host factory and imports the bundle. One bundle
   * holds one copy of plugin-host, so the config's plugin definitions are trusted by that factory,
   * and bundling resolves project packages even where the compiled runtime cannot.
   */
  async bundle(explicit: string | undefined): Promise<{
    readonly config: IPartomConfig
    readonly createPartHost: unknown
    readonly domPlugin: unknown
  }> {
    /** Config file path. */
    const path = this.configPath(explicit)
    /** Bundle directory inside the project. */
    const dir = join(this.dir, '.partom-config')
    /** Imported bundle. */
    let loaded: {
      readonly config?: unknown
      readonly createPartHost?: unknown
      readonly domPlugin?: unknown
    }
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'entry.ts'),
        `export { default as config } from ${JSON.stringify(path)}\nexport { createPartHost } from '@migaia/part-host'\nexport { domPlugin } from '@migaia/part-plugin-dom'\n`
      )
      /** Bundle result. */
      const result = await Bun.build({
        entrypoints: [join(dir, 'entry.ts')],
        outdir: dir,
        target: 'bun',
        plugins: [scopedResolverPlugin]
      })
      if (!result.success) throw new AggregateError(result.logs, PartCliText.configInvalid)
      loaded = (await import(join(dir, 'entry.js'))) as typeof loaded
    } catch (cause) {
      throw createPartCliError(PartCliErrorCode.configInvalid, PartCliText.configInvalid, cause)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    /** Default export of the config module. */
    const value = loaded.config
    /** Candidate config. */
    const config = value as Partial<IPartomConfig> | undefined
    if (!Array.isArray(config?.plugins) || !Array.isArray(config.blueprints))
      throw createPartCliError(
        PartCliErrorCode.configInvalid,
        PartCliText.configInvalid,
        new TypeError(PartCliText.configInvalid)
      )
    return {
      config: config as IPartomConfig,
      createPartHost: loaded.createPartHost,
      domPlugin: loaded.domPlugin
    }
  }

  /** Blueprint files matched by the config globs, relative to the project. */
  blueprintFiles(config: IPartomConfig): string[] {
    /** Matched files in glob order. */
    const files: string[] = []
    for (const pattern of config.blueprints)
      for (const file of new Bun.Glob(pattern).scanSync({ cwd: this.dir }))
        files.push(join(this.dir, file))
    return files
  }
}
