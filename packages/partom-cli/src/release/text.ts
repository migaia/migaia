/** Rule ids reported by the release commands; stable because tools and tests branch on them. */
export const ReleaseRule = {
  /** The config also provides a definition that a remote module exports. */
  remoteInConfig: 'release.remote-in-config',
  /** A part module's minified bundle exceeds its `budget.size`. */
  budgetSize: 'budget.size',
  /** A blueprint failed to load in the release child (parse or expansion error). */
  load: 'release.load',
  /** A draft blueprint has no workspace file, or a draft module name is unsafe. */
  pullFailed: 'release.pull-failed'
} as const

/** Internal doctor-child switches of the release commands. */
export const ReleaseMode = {
  /** Data for `partom build`: blueprints, definitions, descriptors with remote modules installed. */
  snapshot: '--snapshot',
  /** Data for `partom manifest`: the local manifest, part modules and inline candidates. */
  manifest: '--manifest-data',
  /** Only the release settings and the blueprint files of the config. */
  release: '--release-data'
} as const

/** Plugin name of the remote definitions installed by the snapshot child (same as the client's). */
export const REMOTE_MODULES_PLUGIN = 'remote:modules'

/** Default build output directory. */
export const DEFAULT_BUILD_DIR = 'partom-build'

/** Default generated client module. */
export const DEFAULT_CLIENT_MODULE = 'src/partom-client.gen.ts'

/** Default client build name in the manifest. */
export const DEFAULT_BUILD_NAME = 'client'

/** Default environment of `partom publish`. */
export const DEFAULT_ENV = 'dev'

/** Environment variable holding the catalog token; never accepted on the command line. */
export const TOKEN_VARIABLE = 'PARTOM_TOKEN'

/** Output files of `partom build`. */
export const BuildFile = {
  snapshot: 'snapshot.json',
  sources: 'sources.json',
  modules: 'm',
  /** Written by the remote pipeline; removed so the build output is exactly the documented set. */
  remoteList: 'modules.json'
} as const

/** Tag of the snapshot inlined into the client module. */
export const INLINE_TAG = 'inline'

/** Packages kept external when measuring part module size; the page provides them. */
export const BUDGET_EXTERNAL = ['@migaia/*', 'react', 'react/*', 'react-dom', 'react-dom/*']

/** Messages of the release commands. */
export const ReleaseText = {
  dirty: 'partom build needs a tagged HEAD with a clean working tree',
  configMissing: 'partom.config.ts needs release.project for release commands',
  serviceUnreachable: (url: string): string => `catalog request to ${url} failed`,
  remoteInConfig: (id: string): string =>
    `the config already provides ${id}, which a remote module exports`,
  budgetSize: (file: string): string => `${file} exceeds its size budget`,
  budgetBasis: (size: number, budget: number): string => `${size} bytes > budget ${budget} bytes`,
  load: (id: string): string => `blueprint ${id} failed to load`,
  noWorkspaceFile: (id: string): string => `draft blueprint ${id} has no file in the workspace`,
  unsafeModule: (name: string): string => `draft module ${name} is not a safe module name`,
  draftConflicts: 'the draft has unresolved rebase conflicts; resolve them in the editor first'
} as const
