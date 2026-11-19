import { ERROR_SOURCE, type IPartCliErrorCode } from './error-code.ts'

/** Stable messages of `part.cli` errors and usage text. */
export const PartCliText = {
  /** Usage printed for invalid arguments. */
  usage:
    'usage: partom doctor [--rendered] [--only <address>] [--browser <path>] [--json [--blueprints] [--types]] [--config <path>]\n' +
    '       partom preview [<id|file>] [--port <n>] [--config <path>]\n' +
    '       partom extract <files...> --out <dir> [--probe] [--verify] [--browser <path>]\n' +
    '       partom import <openapi.json|yaml> --out <dir>\n' +
    '       partom types [--out <file>] [--check] [--config <path>]\n' +
    '       partom browser install\n' +
    '       partom --version',
  /** Missing config. */
  configNotFound: (dir: string): string => `no partom.config.ts in ${dir}; pass --config <path>`,
  /** Invalid config. */
  configInvalid: 'partom.config.ts must export default { plugins: [...], blueprints: [...] }',
  /** Missing project dependency. */
  projectDependencyMissing: (name: string): string =>
    `the project cannot resolve ${name}; install it in the project`,
  /** No browser. */
  browserNotFound: 'no browser found; pass --browser <path> or run: partom browser install',
  /** Harness failure. */
  harnessFailed: 'the check page failed to build or run',
  /** Parse failure. */
  parseFailed: (file: string): string => `failed to parse ${file}`,
  /** No free preview port. */
  portInUse: (ports: string): string =>
    `no free port for partom preview (tried ${ports}); pass --port <n>`,
  /** Preview target not in the config. */
  blueprintNotFound: (target: string): string => `no blueprint of the config matches "${target}"`,
  /** Import input is not an OpenAPI 3.x document. */
  importInvalid: (path: string): string => `${path} is not an OpenAPI 3.x document with paths`,
  /** A blueprint left out of `partom types` because it has static errors. */
  typesSkipped: (id: string): string => `partom types: blueprint ${id} has errors and was left out`,
  /** `partom types --check` found the file missing or out of date. */
  typesStale: (path: string): string => `${path} is missing or out of date; run partom types`,
  /** The declaration file was edited by hand. */
  typesTakenOver: (path: string): string => `${path} was edited by hand; delete it to regenerate`,
  /** Doctor child process ended without a result. */
  doctorChildFailed: 'partom doctor ended without a result',
  /** Unknown command. */
  usageInvalid: 'invalid arguments'
} as const

/** Error carrying `(source, code)` without replacing the native error. */
export type IPartCliError = Error & { readonly source: string; readonly code: IPartCliErrorCode }

/** Creates a tagged error; the original failure, when any, stays on `cause`. */
export function createPartCliError(
  code: IPartCliErrorCode,
  message: string,
  cause?: unknown
): IPartCliError {
  /** One construction keeps stack and cause intact. */
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error as IPartCliError
}

/** Serializes an error for output with only name, message, source and code; never the stack. */
export function serializeCause(cause: unknown): Record<string, unknown> | undefined {
  if (cause === undefined) return undefined
  if (typeof cause !== 'object' || cause === null) return { name: 'Error', message: String(cause) }
  /** Error-like view of the cause. */
  const value = cause as { name?: unknown; message?: unknown; source?: unknown; code?: unknown }
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    message: typeof value.message === 'string' ? value.message : '',
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {})
  }
}
