/** Stable error domain owned by this code table; it names the part command-line tool. */
export const ERROR_SOURCE = 'part.cli'

/** The single declaration site for `part.cli` error codes. Code values are public API. */
export const PartCliErrorCode = {
  /** The project directory has no `partom.config.ts` and no `--config` was given. Exit code 2. */
  configNotFound: 'CONFIG_NOT_FOUND',
  /** The config does not export `{ plugins, blueprints }`; the original error is on `cause`. Exit 2. */
  configInvalid: 'CONFIG_INVALID',
  /**
   * A package the tool loads from the project (part packages, React, ui-sdk testing) cannot be
   * resolved from the project directory. Install it in the project. Exit code 2.
   */
  projectDependencyMissing: 'PROJECT_DEPENDENCY_MISSING',
  /**
   * No browser was found at the explicit path or by automatic lookup. Exit code 2; nothing is
   * downloaded.
   */
  browserNotFound: 'BROWSER_NOT_FOUND',
  /** Building or running the check page failed; the original error is on `cause`. Exit code 2. */
  harnessFailed: 'HARNESS_FAILED',
  /** A source file failed to parse; it is skipped and the run exits 1. */
  parseFailed: 'PARSE_FAILED',
  /**
   * `partom preview` could not listen: the `--port` port, or every port from 4400 to 4419 when no
   * port was given, is taken. Exit code 2; pass a free `--port`.
   */
  portInUse: 'PORT_IN_USE',
  /**
   * The `partom preview` target (a blueprint id or file) matches no blueprint of the config. Exit
   * code 2; check the id or the config's `blueprints` globs.
   */
  blueprintNotFound: 'BLUEPRINT_NOT_FOUND',
  /**
   * `partom import` could not read its input as an OpenAPI 3.x document: the file does not parse,
   * `openapi` does not start with `3.`, or `paths` is missing. The parse error is on `cause`. Exit
   * code 2; nothing is written.
   */
  importInvalid: 'IMPORT_INVALID',
  /**
   * `partom remote build` was given an entry outside `--root`, a `--root` outside the project, or
   * an entry whose path relative to the root is not a valid module name. That entry fails (exit 1);
   * other entries still build. Move the file under the remote-module root.
   */
  remoteEntryOutside: 'REMOTE_ENTRY_OUTSIDE',
  /**
   * `partom build` found no tag on HEAD (or `--tag` does not name HEAD), or the working tree
   * differs from the tag. Releases are built only from committed tags. Exit code 2; commit and tag
   * first.
   */
  releaseDirty: 'RELEASE_DIRTY',
  /** A release command needs `release.project` in `partom.config.ts` and it is missing. Exit code 2. */
  releaseConfigMissing: 'RELEASE_CONFIG_MISSING',
  /**
   * A catalog request failed on the network or the catalog answered 5xx; the original error or
   * status is on `cause`. Exit code 2; check `--service` and retry.
   */
  serviceUnreachable: 'SERVICE_UNREACHABLE',
  /** Command-line usage is invalid. Exit code 2. */
  usageInvalid: 'USAGE_INVALID'
} as const

/** Value union of every `part.cli` error code. */
export type IPartCliErrorCode = (typeof PartCliErrorCode)[keyof typeof PartCliErrorCode]
