import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  authorizeStorageV2LockProvenance,
  parseStorageV2PnpmLockfile,
  pnpmDependencyPathToFilename,
  storageV2TarballIntegrity,
  type IStorageV2ArtifactProvenance
} from '../storage-v2-lock-provenance.mjs'

/** Canonical synthetic consumer root keeps file locators deterministic. */
const consumerDirectory = '/tmp/storage-v2-lock-consumer'

/** Synthetic tarball digests are exact independent artifact facts for the two-package graph. */
const utilsIntegrity = storageV2TarballIntegrity(Buffer.from('utils tarball bytes'))
const storageWebIntegrity = storageV2TarballIntegrity(Buffer.from('storage-web tarball bytes'))

/** Finite two-package graph exercises root and transitive provenance without filesystem access. */
const artifacts: readonly IStorageV2ArtifactProvenance[] = [
  {
    name: '@migaia/utils',
    version: '0.0.2',
    tarballPath: '/tmp/storage-v2-lock-pack/migaia-utils-0.0.2.tgz',
    integrity: utilsIntegrity,
    dependencies: {}
  },
  {
    name: '@migaia/storage-web',
    version: '0.0.3',
    tarballPath: '/tmp/storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz',
    integrity: storageWebIntegrity,
    dependencies: { '@migaia/utils': '^0.0.2' }
  }
]

/** Complete pnpm v9 fixture accepted by the strict lockfile profile. */
const validLockfile = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  '@migaia/utils': file:/tmp/storage-v2-lock-pack/migaia-utils-0.0.2.tgz

importers:

  .:
    dependencies:
      '@migaia/storage-web':
        specifier: file:/tmp/storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz
        version: file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz

packages:

  '@migaia/storage-web@file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz':
    resolution: {integrity: ${storageWebIntegrity}, tarball: file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz}
    version: 0.0.3
    engines: {node: '>=24.16.0'}

  '@migaia/utils@file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz':
    resolution: {integrity: ${utilsIntegrity}, tarball: file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz}
    version: 0.0.2

snapshots:

  '@migaia/storage-web@file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz':
    dependencies:
      '@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz

  '@migaia/utils@file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz': {}
`

/** Direct roots and the peer suffix match an offline pnpm 12.11.2 tarball calibration. */
const peerRoots = ['@migaia/storage-host', '@migaia/storage-web'] as const
/** Distinct bytes bind every package row, including the exact-version third-party leaf. */
const peerArtifacts: readonly IStorageV2ArtifactProvenance[] = [
  {
    name: '@migaia/storage-web',
    version: '0.0.0',
    tarballPath: '/tmp/storage-v2-lock-pack/storage-web.tgz',
    integrity: storageV2TarballIntegrity(Buffer.from('web with host peer')),
    dependencies: {},
    peerDependencies: { '@migaia/storage-host': '^0.0.0' }
  },
  {
    name: '@migaia/storage-host',
    version: '0.0.0',
    tarballPath: '/tmp/storage-v2-lock-pack/storage-host.tgz',
    integrity: storageV2TarballIntegrity(Buffer.from('host with real dependencies')),
    dependencies: { '@migaia/serialize': '^0.0.0', ansis: '4.3.1' }
  },
  {
    name: '@migaia/serialize',
    version: '0.0.0',
    tarballPath: '/tmp/storage-v2-lock-pack/serialize.tgz',
    integrity: storageV2TarballIntegrity(Buffer.from('serialize with optional codec peer')),
    dependencies: {},
    peerDependencies: { 'cbor-x': '^1.6.6' },
    peerDependenciesMeta: { 'cbor-x': { optional: true } }
  },
  {
    name: 'ansis',
    version: '4.3.1',
    tarballPath: '/tmp/storage-v2-lock-pack/ansis.tgz',
    integrity: storageV2TarballIntegrity(Buffer.from('independently packed ansis')),
    dependencies: {}
  }
]
/** Base tarball and resolved instance remain separate independent fixture expectations. */
const webPeerLocator =
  'file:../storage-v2-lock-pack/storage-web.tgz(@migaia/storage-host@file:../storage-v2-lock-pack/storage-host.tgz)'
/** Complete dual-root graph keeps the host pin and optional codec metadata from packed manifests. */
const peerLockfile = `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
overrides:
  '@migaia/storage-host': file:/tmp/storage-v2-lock-pack/storage-host.tgz
  '@migaia/serialize': file:/tmp/storage-v2-lock-pack/serialize.tgz
  ansis: file:/tmp/storage-v2-lock-pack/ansis.tgz
importers:
  .:
    dependencies:
      '@migaia/storage-host':
        specifier: file:/tmp/storage-v2-lock-pack/storage-host.tgz
        version: file:../storage-v2-lock-pack/storage-host.tgz
      '@migaia/storage-web':
        specifier: file:/tmp/storage-v2-lock-pack/storage-web.tgz
        version: ${webPeerLocator}
packages:
  '@migaia/storage-host@file:../storage-v2-lock-pack/storage-host.tgz':
    resolution: {integrity: ${peerArtifacts[1].integrity}, tarball: file:../storage-v2-lock-pack/storage-host.tgz}
    version: 0.0.0
  '@migaia/storage-web@file:../storage-v2-lock-pack/storage-web.tgz':
    resolution: {integrity: ${peerArtifacts[0].integrity}, tarball: file:../storage-v2-lock-pack/storage-web.tgz}
    version: 0.0.0
    peerDependencies:
      '@migaia/storage-host': ^0.0.0
  '@migaia/serialize@file:../storage-v2-lock-pack/serialize.tgz':
    resolution: {integrity: ${peerArtifacts[2].integrity}, tarball: file:../storage-v2-lock-pack/serialize.tgz}
    version: 0.0.0
    peerDependencies:
      cbor-x: ^1.6.6
    peerDependenciesMeta:
      cbor-x:
        optional: true
  'ansis@file:../storage-v2-lock-pack/ansis.tgz':
    resolution: {integrity: ${peerArtifacts[3].integrity}, tarball: file:../storage-v2-lock-pack/ansis.tgz}
    version: 4.3.1
snapshots:
  '@migaia/storage-host@file:../storage-v2-lock-pack/storage-host.tgz':
    dependencies:
      '@migaia/serialize': file:../storage-v2-lock-pack/serialize.tgz
      ansis: file:../storage-v2-lock-pack/ansis.tgz
  '@migaia/storage-web@${webPeerLocator}':
    dependencies:
      '@migaia/storage-host': file:../storage-v2-lock-pack/storage-host.tgz
  '@migaia/serialize@file:../storage-v2-lock-pack/serialize.tgz': {}
  'ansis@file:../storage-v2-lock-pack/ansis.tgz': {}
`

/** Replaces one unique fixture fragment and fails the test setup on accidental drift. */
function replaceUnique(source: string, expected: string, replacement: string): string {
  expect(source.split(expected), `unique fixture fragment: ${expected}`).toHaveLength(2)
  return source.replace(expected, replacement)
}

describe('root-owned strict lock provenance tool', () => {
  it('owns directly declared and independently locked parser dependencies', () => {
    const ownerManifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
    ) as { readonly dependencies?: Readonly<Record<string, string>> }
    const ownerLockfile = readFileSync(resolve(import.meta.dirname, '../pnpm-lock.yaml'), 'utf8')
    const installedYamlManifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../node_modules/yaml/package.json'), 'utf8')
    ) as { readonly version?: string }
    const installedTypeScriptManifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../node_modules/typescript/package.json'), 'utf8')
    ) as { readonly version?: string }
    expect(ownerManifest.dependencies).toEqual({ typescript: '6.0.2', yaml: '2.9.0' })
    expect(ownerLockfile).toContain('specifier: 6.0.2\n        version: 6.0.2')
    expect(ownerLockfile).toContain('specifier: 2.9.0\n        version: 2.9.0')
    expect(installedTypeScriptManifest.version).toBe('6.0.2')
    expect(installedYamlManifest.version).toBe('2.9.0')
  })

  it('authorizes one exact importer-rooted package/snapshot graph', () => {
    const authorized = authorizeStorageV2LockProvenance(validLockfile, consumerDirectory, artifacts)
    expect([...authorized.keys()].sort()).toEqual(['@migaia/storage-web', '@migaia/utils'])
    expect(authorized.get('@migaia/storage-web')).toMatchObject({
      lockIdentity: '@migaia/storage-web@file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz',
      tarballLocator: 'file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz',
      version: '0.0.3'
    })
  })

  it('authorizes both direct roots, the exact peer instance, and absent optional peers', () => {
    const authorized = authorizeStorageV2LockProvenance(
      peerLockfile,
      consumerDirectory,
      peerArtifacts,
      peerRoots
    )
    expect([...authorized.keys()].sort()).toEqual([
      '@migaia/serialize',
      '@migaia/storage-host',
      '@migaia/storage-web',
      'ansis'
    ])
    expect(authorized.get('@migaia/storage-web')).toEqual({
      lockIdentity: `@migaia/storage-web@${webPeerLocator}`,
      tarballLocator: 'file:../storage-v2-lock-pack/storage-web.tgz',
      version: '0.0.0',
      root: resolve(
        consumerDirectory,
        'node_modules/.pnpm',
        pnpmDependencyPathToFilename(`@migaia/storage-web@${webPeerLocator}`),
        'node_modules/@migaia/storage-web'
      )
    })
    expect(authorized.get('ansis')?.version).toBe('4.3.1')
  })

  it('authorizes optional snapshot edges without accepting missing or substituted origins', () => {
    /** The same packed graph is resolved by pnpm with its edge in the optional group. */
    const optionalLockfile = replaceUnique(
      validLockfile,
      "    dependencies:\n      '@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz",
      "    optionalDependencies:\n      '@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz"
    )
    expect(
      [
        ...authorizeStorageV2LockProvenance(optionalLockfile, consumerDirectory, artifacts).keys()
      ].sort()
    ).toEqual(['@migaia/storage-web', '@migaia/utils'])
    expect(() =>
      authorizeStorageV2LockProvenance(
        replaceUnique(
          optionalLockfile,
          "    optionalDependencies:\n      '@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz",
          '    optionalDependencies: {}'
        ),
        consumerDirectory,
        artifacts
      )
    ).toThrow('@migaia/storage-web resolved dependency edges mismatch')
    expect(() =>
      authorizeStorageV2LockProvenance(
        replaceUnique(
          optionalLockfile,
          "'@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz",
          "'@migaia/utils': file:../forged/utils.tgz"
        ),
        consumerDirectory,
        artifacts
      )
    ).toThrow('@migaia/storage-web resolved dependency edges mismatch')
    expect(() =>
      authorizeStorageV2LockProvenance(
        replaceUnique(
          optionalLockfile,
          '    optionalDependencies:',
          "    dependencies:\n      '@migaia/utils': file:../forged/utils.tgz\n    optionalDependencies:"
        ),
        consumerDirectory,
        artifacts
      )
    ).toThrow('contains conflicting dependency edge')
  })

  it('keeps the default importer profile exact and rejects duplicated explicit roots', () => {
    expect(() =>
      authorizeStorageV2LockProvenance(peerLockfile, consumerDirectory, peerArtifacts)
    ).toThrow('root importer dependency set')
    expect(() =>
      authorizeStorageV2LockProvenance(peerLockfile, consumerDirectory, peerArtifacts, [
        ...peerRoots,
        '@migaia/storage-host'
      ])
    ).toThrow('root importer dependency set')
  })

  it.each([
    [
      'direct host specifier substitution',
      replaceUnique(
        peerLockfile,
        'specifier: file:/tmp/storage-v2-lock-pack/storage-host.tgz',
        'specifier: file:/forged/host.tgz'
      )
    ],
    [
      'importer peer binding substitution',
      replaceUnique(
        peerLockfile,
        `version: ${webPeerLocator}`,
        'version: file:../storage-v2-lock-pack/storage-web.tgz(@migaia/storage-host@file:../forged/host.tgz)'
      )
    ],
    [
      'snapshot peer identity substitution',
      replaceUnique(
        peerLockfile,
        `'@migaia/storage-web@${webPeerLocator}':`,
        "'@migaia/storage-web@file:../storage-v2-lock-pack/storage-web.tgz':"
      )
    ],
    [
      'snapshot peer edge substitution',
      replaceUnique(
        peerLockfile,
        "'@migaia/storage-host': file:../storage-v2-lock-pack/storage-host.tgz",
        "'@migaia/storage-host': file:../forged/host.tgz"
      )
    ],
    [
      'peer declaration substitution',
      replaceUnique(
        peerLockfile,
        "'@migaia/storage-host': ^0.0.0",
        "'@migaia/storage-host': ^9.0.0"
      )
    ],
    [
      'optional peer metadata substitution',
      replaceUnique(peerLockfile, 'optional: true', 'optional: false')
    ],
    [
      'packed leaf digest substitution',
      replaceUnique(peerLockfile, peerArtifacts[3].integrity, peerArtifacts[0].integrity)
    ],
    [
      'extra peer instance snapshot',
      `${peerLockfile}\n  '@migaia/storage-web@file:../storage-v2-lock-pack/storage-web.tgz': {}\n`
    ]
  ])('rejects dual-root %s without weakening graph or integrity checks', (_label, lockfile) => {
    expect(() =>
      authorizeStorageV2LockProvenance(lockfile, consumerDirectory, peerArtifacts, peerRoots)
    ).toThrow()
  })

  it.each([
    ['valid-prefix wrong digest', `sha512-${Buffer.alloc(64, 0).toString('base64')}`],
    ['wrong algorithm', `sha256-${Buffer.alloc(32, 0).toString('base64')}`],
    ['malformed base64', 'sha512-%%%not-base64%%%'],
    ['swapped package digest', utilsIntegrity]
  ])('rejects %s against independently derived tarball bytes', (_label, hostileIntegrity) => {
    expect(() =>
      authorizeStorageV2LockProvenance(
        replaceUnique(validLockfile, storageWebIntegrity, hostileIntegrity),
        consumerDirectory,
        artifacts
      )
    ).toThrow('@migaia/storage-web package integrity mismatch')
  })

  it.each([
    ['duplicate top-level section', `${validLockfile}\npackages: {}\n`],
    ['inline top-level replacement', replaceUnique(validLockfile, 'packages:\n', 'packages: {}\n')],
    [
      'duplicate nested dependency group',
      replaceUnique(
        validLockfile,
        "    dependencies:\n      '@migaia/storage-web':",
        "    dependencies: {}\n    dependencies:\n      '@migaia/storage-web':"
      )
    ],
    [
      'duplicate importer field',
      replaceUnique(
        validLockfile,
        '        specifier: file:/tmp/storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz',
        '        specifier: file:/tmp/storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz\n        specifier: file:/forged.tgz'
      )
    ],
    [
      'anchor and alias',
      replaceUnique(
        validLockfile,
        'settings:\n  autoInstallPeers: true',
        'settings: &settings\n  autoInstallPeers: true\nshadow: *settings'
      )
    ],
    ['non-map packages', replaceUnique(validLockfile, 'packages:\n', 'packages: []\n')],
    [
      'unknown top-level key',
      replaceUnique(validLockfile, 'settings:\n', 'unknown: true\nsettings:\n')
    ],
    [
      'unknown package field',
      replaceUnique(validLockfile, '    version: 0.0.3', '    version: 0.0.3\n    mystery: true')
    ],
    [
      'unknown snapshot group',
      replaceUnique(
        validLockfile,
        "    dependencies:\n      '@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz",
        "    dependencies:\n      '@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz\n    mystery: {}"
      )
    ]
  ])('rejects %s before graph authorization', (_label, hostileLockfile) => {
    expect(() => parseStorageV2PnpmLockfile(hostileLockfile)).toThrow()
  })

  it.each([
    [
      'root specifier substitution',
      replaceUnique(
        validLockfile,
        'specifier: file:/tmp/storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz',
        'specifier: file:/forged/storage-web.tgz'
      )
    ],
    [
      'root resolved version substitution',
      replaceUnique(
        validLockfile,
        'version: file:../storage-v2-lock-pack/migaia-storage-web-0.0.3.tgz',
        'version: file:../forged/storage-web.tgz'
      )
    ],
    [
      'transitive override substitution',
      replaceUnique(
        validLockfile,
        "'@migaia/utils': file:/tmp/storage-v2-lock-pack/migaia-utils-0.0.2.tgz",
        "'@migaia/utils': file:/tmp/forged-utils.tgz"
      )
    ],
    [
      'package resolution substitution',
      replaceUnique(
        validLockfile,
        'tarball: file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz',
        'tarball: file:../forged-utils.tgz'
      )
    ],
    [
      'transitive edge substitution',
      replaceUnique(
        validLockfile,
        "'@migaia/utils': file:../storage-v2-lock-pack/migaia-utils-0.0.2.tgz",
        "'@migaia/utils': file:../forged/utils.tgz"
      )
    ],
    [
      'orphan package row',
      replaceUnique(
        validLockfile,
        'snapshots:\n',
        "  '@migaia/orphan@file:../orphan.tgz':\n    resolution: {tarball: file:../orphan.tgz}\n    version: 0.0.0\n\nsnapshots:\n"
      )
    ]
  ])('rejects %s as an unreachable or mismatched provenance fact', (_label, hostileLockfile) => {
    expect(() =>
      authorizeStorageV2LockProvenance(hostileLockfile, consumerDirectory, artifacts)
    ).toThrow()
  })
})
