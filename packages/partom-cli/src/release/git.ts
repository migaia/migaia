import { spawnSync } from 'node:child_process'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError } from '../errors.ts'
import { isToolPath } from '../project.ts'
import { ReleaseText } from './text.ts'

/** Runs git in `dir`; returns trimmed stdout, or undefined when git exits non-zero. */
function git(dir: string, args: readonly string[]): string | undefined {
  /** Child result. */
  const result = spawnSync('git', [...args], { cwd: dir, encoding: 'utf8' })
  return result.status === 0 ? result.stdout : undefined
}

/** Throws RELEASE_DIRTY. */
function dirty(): never {
  throw createPartCliError(PartCliErrorCode.releaseDirty, ReleaseText.dirty)
}

/**
 * Tag the release is built from: `explicit` when it names HEAD, else the exact tag on HEAD. Throws
 * RELEASE_DIRTY when there is no such tag or the working tree has changes outside the tool's own
 * working directories.
 */
export function releaseTag(dir: string, explicit: string | undefined): string {
  /** HEAD commit. */
  const head = git(dir, ['rev-parse', 'HEAD'])?.trim()
  /** Tag candidate. */
  const tag =
    explicit ?? git(dir, ['describe', '--exact-match', '--tags', 'HEAD'])?.trim() ?? dirty()
  if (head === undefined || git(dir, ['rev-parse', `${tag}^{commit}`])?.trim() !== head) dirty()
  if (changedPaths(dir).some((path) => !isToolPath(path))) dirty()
  return tag
}

/**
 * Paths `git status --porcelain` lists as changed or untracked, relative to `dir`'s repository
 * root. A git failure yields one placeholder path so the tree counts as dirty.
 */
function changedPaths(dir: string): string[] {
  /** Porcelain output. */
  const output = git(dir, ['status', '--porcelain'])
  if (output === undefined) return ['?']
  // Each line is `XY <path>` (renames `XY <old> -> <new>`); the path starts at column 3.
  return output
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3))
}

/** Text of `path` (relative to `dir`) at `revision`, or undefined when it did not exist there. */
export function fileAt(dir: string, revision: string, path: string): string | undefined {
  return git(dir, ['show', `${revision}:./${path}`])
}
