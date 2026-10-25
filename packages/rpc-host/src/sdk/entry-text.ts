/** Entry rejection remains stable across process and thread short-source factories. */
export const RpcEntryErrorText = {
  /** Self spawning requires a real program entry, rather than an interpreter or test harness. */
  selfUnavailable: 'Self spawn requires a usable main entry; pass an explicit entry or command',
  /**
   * Relative paths require an explicit base or the main entry; callers may always pass an exact
   * URL.
   */
  relativeUnavailable: 'Relative spawn entry requires a main entry or explicit base URL',
  /** Native URL parsing failures remain reachable as the cause of configuration rejection. */
  invalid: 'Spawn entry or base URL is invalid'
} as const

/** Eval and test harness flags cannot identify a program that is safe to execute as itself. */
export const RPC_NON_ENTRY_FLAGS = [
  '-e',
  '--eval',
  '-p',
  '--print',
  '--test',
  '--input-type'
] as const

/** Test-controller options do not belong to an explicitly selected child program. */
export const RPC_TEST_FLAG_PREFIX = '--test'

/** Known test harness entries run their own controller rather than the caller's module. */
export const RPC_TEST_ENTRY =
  /(?:^|\/)node_modules\/(?:@vitest\/|(?:vitest|jest|mocha|jasmine)\/)|(?:^|\/)(?:vitest|jest|mocha|jasmine)\.(?:mjs|cjs|js)$/

/** Bundled Bun binaries expose virtual entries that cannot be re-executed as ordinary files. */
export const RPC_BUNDLED_ENTRY = /(?:^|\/)\$bunfs\//

/** Only an explicit URI scheme denotes an exact string URL; other strings need a base. */
export const RPC_ENTRY_SCHEME = /^[a-z][a-z0-9+.-]*:/i
