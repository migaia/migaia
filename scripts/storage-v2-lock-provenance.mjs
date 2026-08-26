import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { isAlias, isNode, parseAllDocuments, visit } from 'yaml'

/** Exact pnpm release whose dependency-path filename algorithm this tool mirrors. */
export const storageV2PinnedPnpmVersion = '11.20.0'

/** Pnpm 11.20.0 virtual-store filename limit required from the fresh consumer. */
export const storageV2VirtualStoreDirMaxLength = 120

/** Allowed top-level keys for the fresh pnpm lockfile profile owned by C2-R4. */
const topLevelKeys = new Set([
  'lockfileVersion',
  'settings',
  'overrides',
  'importers',
  'packages',
  'snapshots'
])

/** Allowed settings emitted for the isolated, non-workspace packed consumer. */
const settingKeys = new Set(['autoInstallPeers', 'excludeLinksFromLockfile'])

/** Allowed importer dependency groups in the pnpm v9 lock schema. */
const importerGroupKeys = new Set(['dependencies'])

/** Exact fields owned by one importer dependency edge. */
const importerDependencyKeys = new Set(['specifier', 'version'])

/** Closed package-row fields accepted from pnpm 11.20.0 packed tarball resolution. */
const packageRowKeys = new Set([
  'resolution',
  'name',
  'version',
  'engines',
  'cpu',
  'os',
  'libc',
  'hasBin',
  'requiresBuild',
  'deprecated',
  'peerDependencies',
  'peerDependenciesMeta'
])

/** Closed resolution fields accepted for file tarballs. */
const resolutionKeys = new Set(['integrity', 'tarball'])

/** Closed dependency groups owned by one resolved snapshot. */
const snapshotRowKeys = new Set([
  'dependencies',
  'optionalDependencies',
  'transitivePeerDependencies'
])

/**
 * Requires a Map while keeping YAML mapping semantics distinct from arrays and scalars.
 *
 * @param {unknown} value Parsed YAML value
 * @param {string} label Contract location used in diagnostics
 * @returns {Map<unknown, unknown>} Validated mapping
 */
function requireMap(value, label) {
  if (!(value instanceof Map)) throw new Error(`${label} must be a mapping`)
  return value
}

/**
 * Requires a string scalar without coercing numbers, booleans, null, aliases, or objects.
 *
 * @param {unknown} value Parsed YAML value
 * @param {string} label Contract location used in diagnostics
 * @returns {string} Validated string
 */
function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

/**
 * Rejects unknown keys and non-string mapping keys under a closed schema node.
 *
 * @param {Map<unknown, unknown>} value Validated mapping
 * @param {ReadonlySet<string>} allowed Reviewed key set
 * @param {string} label Contract location used in diagnostics
 * @returns {void}
 */
function requireClosedKeys(value, allowed, label) {
  for (const key of value.keys()) {
    if (typeof key !== 'string') throw new Error(`${label} contains a non-string key`)
    if (!allowed.has(key)) throw new Error(`${label} contains unknown key: ${key}`)
  }
}

/**
 * Validates a map whose keys and values must both be strings.
 *
 * @param {unknown} value Parsed YAML value
 * @param {string} label Contract location used in diagnostics
 * @returns {Map<string, string>} Copied typed string map
 */
function requireStringMap(value, label) {
  /** Parsed mapping remains isolated from the returned authorization fact. */
  const input = requireMap(value, label)
  /** Copied map prevents later mutation of the YAML result from altering validation state. */
  const output = new Map()
  for (const [key, field] of input) {
    output.set(requireString(key, `${label} key`), requireString(field, `${label}.${String(key)}`))
  }
  return output
}

/**
 * Parses one complete YAML document with duplicate-key, alias, anchor, and schema rejection.
 *
 * @param {string} lockfile Complete pnpm lockfile text
 * @returns {Map<unknown, unknown>} Strict root mapping
 */
function parseStrictLockDocument(lockfile) {
  /** Multiple documents are parsed explicitly so a trailing replacement document cannot hide. */
  const documents = parseAllDocuments(lockfile, {
    merge: false,
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    version: '1.2'
  })
  if (documents.length !== 1) throw new Error('pnpm lockfile must contain exactly one document')
  /** Sole document retains parser diagnostics and AST identity checks before conversion. */
  const document = documents[0]
  if (document.errors.length > 0)
    throw new Error(
      `invalid pnpm lockfile YAML: ${document.errors.map(({ message }) => message).join('; ')}`
    )
  visit(document, (_key, node) => {
    if (isAlias(node)) throw new Error('pnpm lockfile aliases are forbidden')
    if (isNode(node) && 'anchor' in node && node.anchor !== undefined)
      throw new Error('pnpm lockfile anchors are forbidden')
  })
  /** Map output avoids prototype-key coercion and preserves exact mapping types. */
  const root = requireMap(document.toJS({ mapAsMap: true, maxAliasCount: 0 }), 'pnpm lockfile')
  requireClosedKeys(root, topLevelKeys, 'pnpm lockfile')
  return root
}

/**
 * Validates the closed fresh-consumer schema and returns only provenance-owning facts.
 *
 * @param {string} lockfile Complete pnpm lockfile text
 * @returns {{
 *   readonly importers: ReadonlyMap<
 *     string,
 *     ReadonlyMap<string, { readonly specifier: string; readonly version: string }>
 *   >
 *   readonly overrides: ReadonlyMap<string, string>
 *   readonly packages: ReadonlyMap<
 *     string,
 *     {
 *       readonly name?: string
 *       readonly resolution: ReadonlyMap<string, string>
 *       readonly version: string
 *     }
 *   >
 *   readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>
 * }}
 *   Typed provenance rows
 */
export function parseStorageV2PnpmLockfile(lockfile) {
  /** Root mapping is accepted only after strict whole-document parsing. */
  const root = parseStrictLockDocument(lockfile)
  if (root.get('lockfileVersion') !== '9.0') throw new Error('pnpm lockfileVersion must be 9.0')

  /** Fresh consumer settings are closed to the two reviewed pnpm controls. */
  const settings = requireMap(root.get('settings'), 'settings')
  requireClosedKeys(settings, settingKeys, 'settings')
  if (settings.get('autoInstallPeers') !== true)
    throw new Error('settings.autoInstallPeers must be true')
  if (settings.get('excludeLinksFromLockfile') !== false)
    throw new Error('settings.excludeLinksFromLockfile must be false')

  /** Workspace overrides pin every transitive packed artifact before package-manager resolution. */
  const overrides = requireStringMap(root.get('overrides'), 'overrides')

  /** Importer output contains only exact dependency-edge scalars. */
  const importers = new Map()
  for (const [importerNameValue, importerValue] of requireMap(root.get('importers'), 'importers')) {
    /** Importer name is an exact YAML string key. */
    const importerName = requireString(importerNameValue, 'importer name')
    /** Importer row is closed to runtime dependencies for this isolated consumer. */
    const importer = requireMap(importerValue, `importers.${importerName}`)
    requireClosedKeys(importer, importerGroupKeys, `importers.${importerName}`)
    /** Dependency output copies only complete specifier/version facts. */
    const dependencies = new Map()
    for (const [dependencyNameValue, dependencyValue] of requireMap(
      importer.get('dependencies'),
      `importers.${importerName}.dependencies`
    )) {
      /** Dependency package key must remain a string. */
      const dependencyName = requireString(dependencyNameValue, 'importer dependency name')
      /** Dependency edge rejects missing, extra, or nested fields. */
      const dependency = requireMap(
        dependencyValue,
        `importers.${importerName}.dependencies.${dependencyName}`
      )
      requireClosedKeys(
        dependency,
        importerDependencyKeys,
        `importers.${importerName}.dependencies.${dependencyName}`
      )
      dependencies.set(dependencyName, {
        specifier: requireString(dependency.get('specifier'), `${dependencyName}.specifier`),
        version: requireString(dependency.get('version'), `${dependencyName}.version`)
      })
    }
    importers.set(importerName, dependencies)
  }

  /** Package output captures exact identity and version while validating every accepted field. */
  const packages = new Map()
  for (const [identityValue, packageValue] of requireMap(root.get('packages'), 'packages')) {
    /** Lock identity is the exact graph node key used for root derivation. */
    const identity = requireString(identityValue, 'package identity')
    /** Package row accepts only reviewed pnpm tarball metadata. */
    const packageRow = requireMap(packageValue, `packages.${identity}`)
    requireClosedKeys(packageRow, packageRowKeys, `packages.${identity}`)
    /** Resolution is required and closed even though graph authority comes from the identity. */
    const resolution = requireMap(packageRow.get('resolution'), `packages.${identity}.resolution`)
    requireClosedKeys(resolution, resolutionKeys, `packages.${identity}.resolution`)
    /** Copied resolution fields become part of the immutable package authorization fact. */
    const resolutionFields = new Map()
    for (const [resolutionKey, resolutionValue] of resolution)
      resolutionFields.set(
        requireString(resolutionKey, `packages.${identity}.resolution key`),
        requireString(resolutionValue, `packages.${identity}.resolution.${String(resolutionKey)}`)
      )
    for (const field of ['engines', 'peerDependencies']) {
      if (packageRow.has(field))
        requireStringMap(packageRow.get(field), `packages.${identity}.${field}`)
    }
    for (const field of ['cpu', 'os', 'libc']) {
      if (!packageRow.has(field)) continue
      /** Platform selector arrays remain strings and are not interpreted by provenance admission. */
      const selectors = packageRow.get(field)
      if (!Array.isArray(selectors) || selectors.some((value) => typeof value !== 'string'))
        throw new Error(`packages.${identity}.${field} must be a string array`)
    }
    if (packageRow.has('peerDependenciesMeta')) {
      /** Peer metadata is allowed only as nested maps with an optional boolean flag. */
      const peerMeta = requireMap(
        packageRow.get('peerDependenciesMeta'),
        `packages.${identity}.peerDependenciesMeta`
      )
      for (const [peerName, metaValue] of peerMeta) {
        requireString(peerName, 'peer dependency metadata name')
        const meta = requireMap(
          metaValue,
          `packages.${identity}.peerDependenciesMeta.${String(peerName)}`
        )
        requireClosedKeys(
          meta,
          new Set(['optional']),
          `packages.${identity}.peerDependenciesMeta.${String(peerName)}`
        )
        if (meta.has('optional') && typeof meta.get('optional') !== 'boolean')
          throw new Error(
            `packages.${identity}.peerDependenciesMeta.${String(peerName)}.optional must be boolean`
          )
      }
    }
    for (const field of ['hasBin', 'requiresBuild']) {
      if (packageRow.has(field) && typeof packageRow.get(field) !== 'boolean')
        throw new Error(`packages.${identity}.${field} must be boolean`)
    }
    if (packageRow.has('deprecated'))
      requireString(packageRow.get('deprecated'), `packages.${identity}.deprecated`)
    packages.set(identity, {
      ...(packageRow.has('name')
        ? { name: requireString(packageRow.get('name'), `packages.${identity}.name`) }
        : {}),
      resolution: resolutionFields,
      version: requireString(packageRow.get('version'), `packages.${identity}.version`)
    })
  }

  /** Snapshot output contains only exact runtime dependency edges. */
  const snapshots = new Map()
  for (const [identityValue, snapshotValue] of requireMap(root.get('snapshots'), 'snapshots')) {
    /** Snapshot identity must equal its package identity when used by graph authorization. */
    const identity = requireString(identityValue, 'snapshot identity')
    /** Snapshot row rejects unknown groups and non-map dependencies. */
    const snapshot = requireMap(snapshotValue, `snapshots.${identity}`)
    requireClosedKeys(snapshot, snapshotRowKeys, `snapshots.${identity}`)
    if (snapshot.has('optionalDependencies'))
      requireStringMap(
        snapshot.get('optionalDependencies'),
        `snapshots.${identity}.optionalDependencies`
      )
    if (snapshot.has('transitivePeerDependencies')) {
      /** Transitive peer names are metadata and cannot become hidden graph edges. */
      const peers = snapshot.get('transitivePeerDependencies')
      if (!Array.isArray(peers) || peers.some((value) => typeof value !== 'string'))
        throw new Error(`snapshots.${identity}.transitivePeerDependencies must be a string array`)
    }
    snapshots.set(
      identity,
      snapshot.has('dependencies')
        ? requireStringMap(snapshot.get('dependencies'), `snapshots.${identity}.dependencies`)
        : new Map()
    )
  }
  return { importers, overrides, packages, snapshots }
}

/**
 * Reproduces pnpm 11.20.0's dependency-path filename without following installed links.
 *
 * @param {string} dependencyPath Exact lock identity
 * @returns {string} Virtual-store directory filename
 */
export function pnpmDependencyPathToFilename(dependencyPath) {
  /** Unescaped dependency path follows pnpm's file and registry normalization branches. */
  let unescapedDependencyPath = dependencyPath
  if (dependencyPath.startsWith('file:')) unescapedDependencyPath = dependencyPath.replace(':', '+')
  else {
    if (unescapedDependencyPath.startsWith('/'))
      unescapedDependencyPath = unescapedDependencyPath.slice(1)
    /** Version delimiter excludes a scoped package's leading at-sign. */
    const versionDelimiter = unescapedDependencyPath.indexOf('@', 1)
    if (versionDelimiter >= 0)
      unescapedDependencyPath = `${unescapedDependencyPath.slice(0, versionDelimiter)}@${unescapedDependencyPath.slice(versionDelimiter + 1)}`
  }
  /** Filesystem-safe name preserves pnpm's separator replacement. */
  let filename = unescapedDependencyPath.replace(/[\\/:*?"<>|#]/g, '+')
  if (filename.includes('(')) filename = filename.replace(/\)$/, '').replace(/\)\(|\(|\)/g, '_')
  if (
    filename.length > storageV2VirtualStoreDirMaxLength ||
    (filename !== filename.toLowerCase() && !filename.startsWith('file+'))
  ) {
    /** Pnpm short hash uses the first 32 lowercase hex characters of SHA-256. */
    const shortHash = createHash('sha256').update(filename).digest('hex').slice(0, 32)
    return `${filename.slice(0, storageV2VirtualStoreDirMaxLength - 33)}_${shortHash}`
  }
  return filename
}

/**
 * Computes pnpm's exact SRI value from immutable packed tarball bytes before lock inspection.
 *
 * @param {Uint8Array} tarballBytes Complete packed `.tgz` bytes
 * @returns {string} SHA-512 SRI value expected in the package resolution row
 */
export function storageV2TarballIntegrity(tarballBytes) {
  return `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`
}

/**
 * Authorizes all package roots by traversing one exact importer-rooted packed dependency graph.
 *
 * @param {string} lockfile Complete generated pnpm lockfile
 * @param {string} canonicalConsumerDirectory Canonical fresh-consumer directory
 * @param {readonly {
 *   readonly name: string
 *   readonly version: string
 *   readonly tarballPath: string
 *   readonly integrity: string
 *   readonly dependencies: Readonly<Record<string, string>>
 * }[]} artifacts
 *   independently packed release facts
 * @returns {ReadonlyMap<
 *   string,
 *   {
 *     readonly lockIdentity: string
 *     readonly root: string
 *     readonly tarballLocator: string
 *     readonly version: string
 *   }
 * >}
 *   Immutable authorization facts keyed by package name
 */
export function authorizeStorageV2LockProvenance(lockfile, canonicalConsumerDirectory, artifacts) {
  /** Strict parsed value is the sole lockfile authority. */
  const parsed = parseStorageV2PnpmLockfile(lockfile)
  if ([...parsed.importers.keys()].join('\0') !== '.')
    throw new Error('fresh consumer importer set must equal [.]')
  /** Root importer must contain only storage-web. */
  const rootImporter = parsed.importers.get('.')
  if (rootImporter === undefined) throw new Error('root importer is missing')
  if ([...rootImporter.keys()].join('\0') !== '@migaia/storage-web')
    throw new Error('root importer dependency set must equal [@migaia/storage-web]')
  /** Artifact map rejects duplicate package facts before graph traversal. */
  const artifactByName = new Map(artifacts.map((artifact) => [artifact.name, artifact]))
  if (artifactByName.size !== artifacts.length)
    throw new Error('packed artifact names must be unique')
  /** Root artifact provides exact absolute specifier and consumer-relative resolved locator. */
  const rootArtifact = artifactByName.get('@migaia/storage-web')
  if (rootArtifact === undefined) throw new Error('storage-web packed artifact is missing')
  /** Root locator is the only graph seed. */
  const rootLocator = `file:${relative(canonicalConsumerDirectory, rootArtifact.tarballPath)}`
  /** Root edge binds declaration and resolution before any package row is inspected. */
  const rootEdge = rootImporter.get('@migaia/storage-web')
  if (
    rootEdge?.specifier !== `file:${rootArtifact.tarballPath}` ||
    rootEdge.version !== rootLocator
  )
    throw new Error('root importer storage-web edge does not match the packed artifact')
  /** Every non-root packed artifact must be pinned by one exact absolute file override. */
  const expectedOverrides = artifacts
    .filter(({ name }) => name !== '@migaia/storage-web')
    .map(({ name, tarballPath }) => [name, `file:${tarballPath}`])
    .sort()
  if (JSON.stringify([...parsed.overrides.entries()].sort()) !== JSON.stringify(expectedOverrides))
    throw new Error('packed artifact override set mismatch')

  /** Authorization map records the first exact locator reaching each package. */
  const authorized = new Map()
  /** FIFO traversal covers every packed dependency edge reachable from the root importer. */
  const pending = [{ name: '@migaia/storage-web', locator: rootLocator }]
  while (pending.length > 0) {
    /** Current edge is an exact parent-to-child resolved locator. */
    const edge = pending.shift()
    /** Previously reached packages must resolve through the same locator on every path. */
    const prior = authorized.get(edge.name)
    if (prior !== undefined) {
      if (prior.tarballLocator !== edge.locator)
        throw new Error(`${edge.name} resolves through multiple locators`)
      continue
    }
    /** Every reachable dependency must have one independently packed artifact fact. */
    const artifact = artifactByName.get(edge.name)
    if (artifact === undefined) throw new Error(`${edge.name} has no packed artifact`)
    /** Edge locator must identify exactly that artifact relative to the consumer. */
    const expectedLocator = `file:${relative(canonicalConsumerDirectory, artifact.tarballPath)}`
    if (edge.locator !== expectedLocator) throw new Error(`${edge.name} resolved locator mismatch`)
    /** Package identity is formed only from the importer-reachable edge. */
    const lockIdentity = `${edge.name}@${edge.locator}`
    /** Same-name package rows cannot introduce alternate or orphan identities. */
    const packageIdentities = [...parsed.packages.keys()].filter((identity) =>
      identity.startsWith(`${edge.name}@`)
    )
    if (packageIdentities.length !== 1 || packageIdentities[0] !== lockIdentity)
      throw new Error(`${edge.name} package identity set mismatch`)
    /** Package metadata binds exact version and optional explicit name. */
    const packageRow = parsed.packages.get(lockIdentity)
    if (packageRow?.version !== artifact.version)
      throw new Error(`${edge.name} package version mismatch`)
    if (packageRow.name !== undefined && packageRow.name !== edge.name)
      throw new Error(`${edge.name} package name mismatch`)
    if (packageRow.resolution.get('tarball') !== edge.locator)
      throw new Error(`${edge.name} package tarball resolution mismatch`)
    if (packageRow.resolution.get('integrity') !== artifact.integrity)
      throw new Error(`${edge.name} package integrity mismatch`)

    /** Packed manifest dependencies define the exact expected graph edges. */
    const expectedDependencies = new Map()
    for (const [dependencyName, version] of Object.entries(artifact.dependencies).sort()) {
      /** Every packed dependency must belong to this finite release graph. */
      const dependencyArtifact = artifactByName.get(dependencyName)
      if (dependencyArtifact === undefined)
        throw new Error(`${edge.name} has unknown packed dependency ${dependencyName}`)
      if (version !== `^${dependencyArtifact.version}`)
        throw new Error(`${edge.name} dependency version mismatch for ${dependencyName}`)
      expectedDependencies.set(
        dependencyName,
        `file:${relative(canonicalConsumerDirectory, dependencyArtifact.tarballPath)}`
      )
    }
    /** Snapshot identity must be absent for a leaf or exact for a dependency-bearing package. */
    const snapshotIdentities = [...parsed.snapshots.keys()].filter((identity) =>
      identity.startsWith(`${edge.name}@`)
    )
    const snapshotDependencies = parsed.snapshots.get(lockIdentity)
    if (expectedDependencies.size === 0) {
      if (
        snapshotIdentities.length > 1 ||
        (snapshotIdentities.length === 1 && snapshotIdentities[0] !== lockIdentity) ||
        (snapshotDependencies !== undefined && snapshotDependencies.size !== 0)
      )
        throw new Error(`${edge.name} leaf snapshot mismatch`)
    } else {
      if (snapshotIdentities.length !== 1 || snapshotIdentities[0] !== lockIdentity)
        throw new Error(`${edge.name} snapshot identity mismatch`)
      if (
        snapshotDependencies === undefined ||
        JSON.stringify([...snapshotDependencies.entries()].sort()) !==
          JSON.stringify([...expectedDependencies.entries()].sort())
      )
        throw new Error(`${edge.name} resolved dependency edges mismatch`)
    }
    for (const [name, locator] of expectedDependencies) pending.push({ name, locator })
    /** Virtual-store root is derived before following any installed package link. */
    authorized.set(edge.name, {
      lockIdentity,
      root: join(
        canonicalConsumerDirectory,
        'node_modules',
        '.pnpm',
        pnpmDependencyPathToFilename(lockIdentity),
        'node_modules',
        ...edge.name.split('/')
      ),
      tarballLocator: edge.locator,
      version: artifact.version
    })
  }
  /** Entire independently packed release graph must be importer reachable. */
  if (
    JSON.stringify([...authorized.keys()].sort()) !==
    JSON.stringify([...artifactByName.keys()].sort())
  )
    throw new Error('importer-reachable package set mismatch')
  /** Every package row must belong to the exact reachable identity set. */
  const reachableIdentities = [...authorized.values()]
    .map(({ lockIdentity }) => lockIdentity)
    .sort()
  if (JSON.stringify([...parsed.packages.keys()].sort()) !== JSON.stringify(reachableIdentities))
    throw new Error('orphan package rows are forbidden')
  /** Every snapshot row must also belong to the reachable identity set. */
  if ([...parsed.snapshots.keys()].some((identity) => !reachableIdentities.includes(identity)))
    throw new Error('orphan snapshot rows are forbidden')
  return authorized
}

/**
 * Builds the permanent end-to-end hostile lock matrix without placing YAML mutation logic in the
 * feature fixture.
 *
 * @param {string} lockfile Valid generated pnpm lockfile
 * @param {{
 *   readonly rootPackageName: string
 *   readonly rootSpecifierReplacement: string
 *   readonly rootVersionReplacement: string
 *   readonly transitiveIdentity: string
 *   readonly transitiveDependencyName: string
 *   readonly transitiveReplacement: string
 *   readonly integrity: string
 *   readonly swappedIntegrity: string
 * }} options
 *   exact graph mutation targets
 * @returns {readonly string[]} Malformed and semantically substituted lockfiles
 */
export function createStorageV2LockHostiles(lockfile, options) {
  /** Replaces one exact integrity scalar and fails when generated lock shape has drifted. */
  const replaceIntegrity = (replacement) => {
    if (lockfile.split(options.integrity).length !== 2)
      throw new Error('expected one package integrity scalar')
    return lockfile.replace(options.integrity, replacement)
  }
  /**
   * Line-oriented mutation is test-data construction only; authorization always uses strict YAML
   * parsing.
   */
  const replaceRootField = (field, replacement) => {
    /** Mutable lines preserve unrelated generated lockfile bytes. */
    const lines = lockfile.split('\n')
    /** Importer section state limits replacement to the root dependency edge. */
    let inImporters = false
    /** Root importer state rejects package importers with the same dependency. */
    let inRootImporter = false
    /** Dependencies group state excludes dev and optional dependency groups. */
    let inDependencies = false
    /** Package state limits the field to the exact root package. */
    let inPackage = false
    /** Replacement count detects fixture drift and duplicate matches. */
    let replacements = 0
    for (let index = 0; index < lines.length; index += 1) {
      /** Current generated YAML line is inspected without parsing authority. */
      const line = lines[index]
      if (/^\S/.test(line)) {
        inImporters = line === 'importers:'
        inRootImporter = false
        inDependencies = false
        inPackage = false
        continue
      }
      if (!inImporters) continue
      if (/^  \S.*:$/.test(line)) {
        inRootImporter = line === '  .:'
        inDependencies = false
        inPackage = false
        continue
      }
      if (!inRootImporter) continue
      if (/^    \S.*:$/.test(line)) {
        inDependencies = line === '    dependencies:'
        inPackage = false
        continue
      }
      if (!inDependencies) continue
      /** Dependency key identifies the root package block. */
      const dependencyMatch = /^      (.+):$/.exec(line)
      if (dependencyMatch !== null) {
        inPackage = unquoteYamlScalar(dependencyMatch[1]) === options.rootPackageName
        continue
      }
      if (!inPackage) continue
      /** Field match changes exactly one scalar under the root dependency. */
      const fieldMatch = new RegExp(`^        ${field}: (.+)$`).exec(line)
      if (fieldMatch === null) continue
      lines[index] = `        ${field}: ${replacement}`
      replacements += 1
    }
    if (replacements !== 1)
      throw new Error(`expected one root importer ${field}, got ${replacements}`)
    return lines.join('\n')
  }

  /** Root importer dependency block boundaries support missing and duplicate-key attacks. */
  const rootDependencyRange = () => {
    /** Mutable line list supplies stable slice offsets. */
    const lines = lockfile.split('\n')
    /** Importer state tracks the exact root dependency group. */
    let inImporters = false
    /** Root importer state excludes package importers. */
    let inRootImporter = false
    /** Dependency state excludes other importer groups. */
    let inDependencies = false
    /** Candidate starts detect duplicates in the source fixture itself. */
    const starts = []
    for (let index = 0; index < lines.length; index += 1) {
      /** Current line is test-data syntax, not authorization evidence. */
      const line = lines[index]
      if (/^\S/.test(line)) {
        inImporters = line === 'importers:'
        inRootImporter = false
        inDependencies = false
        continue
      }
      if (!inImporters) continue
      if (/^  \S.*:$/.test(line)) {
        inRootImporter = line === '  .:'
        inDependencies = false
        continue
      }
      if (!inRootImporter) continue
      if (/^    \S.*:$/.test(line)) {
        inDependencies = line === '    dependencies:'
        continue
      }
      if (!inDependencies) continue
      /** Dependency match locates the exact package block. */
      const dependencyMatch = /^      (.+):$/.exec(line)
      if (
        dependencyMatch !== null &&
        unquoteYamlScalar(dependencyMatch[1]) === options.rootPackageName
      )
        starts.push(index)
    }
    if (starts.length !== 1)
      throw new Error(`expected one root dependency block, got ${starts.length}`)
    /** Start index points at the dependency mapping key. */
    const start = starts[0]
    /** End index includes all indented fields but not the next mapping key. */
    let end = start + 1
    while (end < lines.length && (lines[end].startsWith('        ') || lines[end].trim() === ''))
      end += 1
    return { lines, start, end }
  }

  /** Rewrites the exact transitive snapshot edge while preserving all package rows. */
  const replaceTransitiveEdge = () => {
    /** Mutable lines preserve the generated document outside one edge. */
    const lines = lockfile.split('\n')
    /** Snapshot state excludes package rows with the same identity. */
    let inSnapshots = false
    /** Parent state limits the mutation to one exact snapshot identity. */
    let inParent = false
    /** Dependency state excludes optional and peer metadata groups. */
    let inDependencies = false
    /** Replacement count detects fixture shape drift. */
    let replacements = 0
    for (let index = 0; index < lines.length; index += 1) {
      /** Current line is inspected only to construct hostile input. */
      const line = lines[index]
      if (/^\S/.test(line)) {
        inSnapshots = line === 'snapshots:'
        inParent = false
        inDependencies = false
        continue
      }
      if (!inSnapshots) continue
      /** Snapshot identity uses exact two-space indentation. */
      const identityMatch = /^  (\S.*):$/.exec(line)
      if (identityMatch !== null) {
        inParent = unquoteYamlScalar(identityMatch[1]) === options.transitiveIdentity
        inDependencies = false
        continue
      }
      if (!inParent) continue
      /** Snapshot group selects runtime dependencies only. */
      const groupMatch = /^    ([A-Za-z][A-Za-z0-9-]*):$/.exec(line)
      if (groupMatch !== null) {
        inDependencies = groupMatch[1] === 'dependencies'
        continue
      }
      if (!inDependencies) continue
      /** Dependency scalar is replaced only for the named child. */
      const dependencyMatch = /^      ([^:]+): (.+)$/.exec(line)
      if (
        dependencyMatch === null ||
        unquoteYamlScalar(dependencyMatch[1]) !== options.transitiveDependencyName
      )
        continue
      lines[index] = `      ${dependencyMatch[1]}: ${options.transitiveReplacement}`
      replacements += 1
    }
    if (replacements !== 1) throw new Error(`expected one transitive edge, got ${replacements}`)
    return lines.join('\n')
  }

  /** Missing root edge preserves valid YAML while removing the sole graph seed. */
  const removed = rootDependencyRange()
  removed.lines.splice(removed.start, removed.end - removed.start)
  /** Duplicate root edge produces invalid YAML that strict unique-key parsing must reject. */
  const duplicated = rootDependencyRange()
  /** Original dependency block is copied byte-for-byte to create an exact duplicate key. */
  const duplicatedBlock = duplicated.lines.slice(duplicated.start, duplicated.end)
  duplicated.lines.splice(
    duplicated.start,
    duplicated.end - duplicated.start,
    ...duplicatedBlock,
    ...duplicatedBlock
  )
  /** Snapshot marker must occur once before adding an unreachable package row. */
  const snapshotMarker = '\nsnapshots:\n'
  if (lockfile.split(snapshotMarker).length !== 2)
    throw new Error('expected one snapshots section marker')
  /** Orphan row is syntactically valid but unreachable from the importer graph. */
  const orphan = lockfile.replace(
    snapshotMarker,
    `\n  '@migaia/orphan@file:../pack/orphan.tgz':\n    resolution: {tarball: file:../pack/orphan.tgz}\n    version: 0.0.0\n${snapshotMarker}`
  )
  return [
    replaceRootField('specifier', options.rootSpecifierReplacement),
    replaceRootField('version', options.rootVersionReplacement),
    removed.lines.join('\n'),
    duplicated.lines.join('\n'),
    orphan,
    replaceTransitiveEdge(),
    `${lockfile}\npackages: {}\n`,
    lockfile.replace('packages:\n', 'packages: {}\n'),
    lockfile.replace('settings:\n', 'settings: &settings\n').concat('\nshadow: *settings\n'),
    lockfile.replace('snapshots:\n', 'snapshots: []\n'),
    lockfile.replace('settings:\n', 'unknownTopLevel: true\nsettings:\n'),
    replaceIntegrity(`sha512-${Buffer.alloc(64, 0).toString('base64')}`),
    replaceIntegrity(`sha256-${Buffer.alloc(32, 0).toString('base64')}`),
    replaceIntegrity('sha512-%%%not-base64%%%'),
    replaceIntegrity(options.swappedIntegrity)
  ]
}

/**
 * Decodes quoted YAML scalar keys only for hostile test-data targeting.
 *
 * @param {string} value Scalar source text
 * @returns {string} Decoded key
 */
function unquoteYamlScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value)
  return value
}
