import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Computes the canonical byte-and-symlink digest for one extracted or installed package tree.
 * Unsupported filesystem entries fail closed so the provenance comparison cannot omit content.
 *
 * @param {string} packageRoot Canonical or resolvable package directory
 * @returns {string} Lowercase SHA-256 digest
 * @throws {Error} When the tree contains an unsupported filesystem entry
 */
export function packageContentSha256(packageRoot) {
  /** Digest receives type, path, content, and symlink-target records in sorted traversal order. */
  const hash = createHash('sha256')

  /**
   * Visits one directory without following symbolic links.
   *
   * @param {string} directory Current absolute directory
   * @param {string} relativeDirectory Path relative to the package root
   * @returns {void}
   */
  const visitDirectory = (directory, relativeDirectory) => {
    /** Stable entry order prevents host filesystem ordering from changing the digest. */
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
    for (const entry of entries) {
      /** Relative path is included so moves and duplicate names remain observable. */
      const relativePath =
        relativeDirectory === '' ? entry.name : join(relativeDirectory, entry.name)
      /**
       * Absolute path is used only for reading the current entry without changing traversal
       * identity.
       */
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`)
        visitDirectory(absolutePath, relativePath)
        continue
      }
      if (entry.isFile()) {
        hash.update(`file\0${relativePath}\0`)
        hash.update(readFileSync(absolutePath))
        hash.update('\0')
        continue
      }
      if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relativePath}\0${readlinkSync(absolutePath)}\0`)
        continue
      }
      throw new Error(`unsupported packed artifact entry: ${relativePath}`)
    }
  }

  visitDirectory(packageRoot, '')
  return hash.digest('hex')
}

/**
 * Finds every canonical pnpm virtual-store root that claims a package name. The caller requires
 * exactly one result before admitting installed content.
 *
 * @param {string} consumerDirectory Fresh packed-consumer directory
 * @param {string} packageName Scoped package name
 * @returns {readonly string[]} Sorted unique canonical roots
 */
export function inspectVirtualStorePackageRoots(consumerDirectory, packageName) {
  /** Pnpm virtual store containing dependency-path directories. */
  const virtualStore = join(consumerDirectory, 'node_modules', '.pnpm')
  /** Scoped package path segments below each virtual-store node_modules directory. */
  const packageSegments = packageName.split('/')
  /** Canonical roots deduplicate aliases while preserving distinct installed trees. */
  const roots = new Set()
  for (const entry of readdirSync(virtualStore, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    /** Candidate root uses the package's exact scoped path. */
    const candidate = join(virtualStore, entry.name, 'node_modules', ...packageSegments)
    try {
      roots.add(realpathSync(candidate))
    } catch {
      // An unrelated virtual-store entry need not contain this package.
    }
  }
  return [...roots].sort()
}
