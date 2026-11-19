/** Environments of every project; fixed list of three. */
export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const

/** One environment name. */
export type IEnvironment = (typeof ENVIRONMENTS)[number]

/** Write requests allowed per token per minute. */
export const WRITE_LIMIT_PER_MINUTE = 60

/** Seconds a `partom remote build` child may run before its process group is killed. */
export const REMOTE_BUILD_TIMEOUT_MS = 60000

/** Storage key builders; one place owns the key layout of the catalog database. */
export const StoreKey = {
  token: (hash: string): string => `token:${hash}`,
  project: (project: string): string => `project:${project}`,
  snapshot: (project: string, hash: string): string => `snapshot:${project}:${hash}`,
  sources: (project: string, hash: string): string => `sources:${project}:${hash}`,
  module: (project: string, file: string): string => `module:${project}:${file}`,
  history: (project: string, env: string): string => `history:${project}:${env}`,
  draft: (project: string): string => `draft:${project}`,
  draftModule: (project: string, file: string): string => `draft-module:${project}:${file}`,
  audit: (project: string): string => `audit:${project}`
} as const

/** Issue rule ids the catalog reports inside changeset results. */
export const CatalogRule = {
  patchOp: 'changeset.patch-op',
  moduleName: 'changeset.module-name',
  buildTimeout: 'remote.build-timeout',
  remoteBuild: 'remote.build'
} as const

/** Fixed messages of the catalog service. */
export const CatalogText = {
  usage:
    'usage: part-catalog serve --data <dir> [--port 0] [--project-dir <dir>] [--allow-origin <origin>]...\n' +
    '       part-catalog token create --data <dir> --project <p> --envs dev,staging,prod --scope read|write --actor <name>\n' +
    '       part-catalog env set --data <dir> --project <p> --env <env> --public-read true|false',
  authRequired: 'a valid bearer token is required',
  authForbidden: 'the token does not allow this request',
  rateLimited: 'too many write requests; retry later',
  snapshotRejected: 'the snapshot failed upload validation',
  snapshotMismatch: (what: string): string => `uploaded content does not match: ${what}`,
  snapshotUnknown: (hash: string): string => `snapshot ${hash} was never uploaded`,
  envUnpublished: (env: string): string => `environment ${env} has no published snapshot`,
  requestInvalid: 'invalid request'
} as const
