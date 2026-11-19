/** Rule ids reported by `partom remote build`; stable because tools and tests branch on them. */
export const RemoteRule = {
  /** An import outside the shared runtime, a relative or dynamic import, or `require`. */
  import: 'remote.import',
  /** Top-level mutable state or a top-level statement other than a definition call. */
  moduleState: 'remote.module-state',
  /** A reference to a host global (window, process, fetch, …). */
  global: 'remote.global',
  /** A type error reported by the project's `tsc`. */
  types: 'remote.types',
  /** The source does not parse. */
  parse: 'remote.parse',
  /** An enhancer or derive returned different output for the same input, or mutated its input. */
  impure: 'remote.impure',
  /** An effect did not settle within the contract-test timeout. */
  contractTimeout: 'remote.contract-timeout',
  /** An effect threw in the contract test, or the module failed to load. */
  contractFailed: 'remote.contract-failed',
  /** The default export holds no enhancer, effect or derive definition. */
  noDefinitions: 'remote.no-definitions'
} as const

/** Fixed messages of the remote pipeline. */
export const RemoteText = {
  /** An entry or the root lies outside the allowed directory. */
  entryOutside: (path: string, root: string): string => `${path} is outside ${root}`,
  /** Bundling an entry failed; the bundler logs are on `cause`. */
  buildFailed: (entry: string): string => `bundling ${entry} failed`,
  /** An entry's path relative to the root is not a valid module name. */
  nameInvalid: (name: string): string =>
    `module name ${name} must be a relative .ts or .tsx path without . or .. segments`
} as const
