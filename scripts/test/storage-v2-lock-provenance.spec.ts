import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  authorizeStorageV2LockProvenance,
  parseStorageV2PnpmLockfile,
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

/** Complete pnpm v9 fixture accepted by the strict C2-R4 profile. */
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

/** Replaces one unique fixture fragment and fails the test setup on accidental drift. */
function replaceUnique(source: string, expected: string, replacement: string): string {
  expect(source.split(expected), `unique fixture fragment: ${expected}`).toHaveLength(2)
  return source.replace(expected, replacement)
}

describe('SWV2-T58 root-owned strict lock provenance tool', () => {
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
