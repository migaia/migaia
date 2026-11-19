/** Plugin name of the remote delivery plugin. */
export const REMOTE_PLUGIN = 'part-remote'

/** Plugin name holding every remote definition; replaced as a whole per version. */
export const REMOTE_MODULES_PLUGIN = 'remote:modules'

/** Global key under which the page places the shared runtime for remote modules. */
export const SHARED_GLOBAL_KEY = 'migaia.part.shared'

/** Default revalidation period in milliseconds. */
export const DEFAULT_REVALIDATE_MS = 300000

/** Cache key builders of the remote plugin. */
export const CacheKey = {
  snapshot: (project: string, env: string): string => `part-remote:${project}:${env}`,
  module: (id: string): string => `part-remote:module:${id}`
} as const

/** Reasons put on REMOTE_VERSION_REJECTED errors. */
export const RejectReason = {
  delivery: 'delivery check failed',
  chunks: 'chunk preload failed',
  modules: 'remote module load failed',
  install: 'install check failed',
  isolatedKind: 'isolated modules may export only effects'
} as const

/** Fixed messages of `part.remote` errors. */
export const PartRemoteText = {
  versionRejected: (tag: string, reason: string): string =>
    `version ${tag} was rejected: ${reason}`,
  moduleIntegrity: (name: string): string => `remote module ${name} does not match its integrity`,
  fetchFailed: (url: string): string => `request to ${url} failed`,
  /** Reason of a failed delivery check, naming every missing capability for the report. */
  missingReason: (missing: readonly string[]): string =>
    `${RejectReason.delivery}: missing ${missing.join(', ')}`,
  isolatedKind: (name: string): string => `isolated module ${name} exports a non-effect definition`,
  isolatedMissing: (id: string): string => `effect ${id} is not in the current isolated table`,
  blueprintFailed: (id: string): string => `blueprint ${id} failed its install check`,
  partError: 'part error'
} as const

/** Rpc method names between the page and the isolated Worker; both sides must agree. */
export const IsolatedMethod = {
  /** Page → Worker: replace the effect table with a version's isolated modules. */
  load: 'load',
  /** Page → Worker: run one effect. */
  run: 'run',
  /** Worker → page: one ctx operation of a running effect. */
  ctx: 'ctx'
} as const

/** Ctx operations an isolated effect forwards to the page. */
export const IsolatedOp = {
  resourcesRun: 'resources.run',
  stateRead: 'state.read',
  stateWrite: 'state.write',
  dispatch: 'dispatch'
} as const

/** One isolated ctx operation. */
export type IsolatedOp = (typeof IsolatedOp)[keyof typeof IsolatedOp]
