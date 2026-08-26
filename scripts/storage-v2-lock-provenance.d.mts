export const storageV2PinnedPnpmVersion: '11.20.0'
export const storageV2VirtualStoreDirMaxLength: 120

export type IStorageV2ArtifactProvenance = {
  readonly name: string
  readonly version: string
  readonly tarballPath: string
  readonly integrity: string
  readonly dependencies: Readonly<Record<string, string>>
}

export type IStorageV2LockAuthorization = {
  readonly lockIdentity: string
  readonly root: string
  readonly tarballLocator: string
  readonly version: string
}

export type IStorageV2ParsedLockfile = {
  readonly importers: ReadonlyMap<
    string,
    ReadonlyMap<string, { readonly specifier: string; readonly version: string }>
  >
  readonly overrides: ReadonlyMap<string, string>
  readonly packages: ReadonlyMap<
    string,
    {
      readonly name?: string
      readonly resolution: ReadonlyMap<string, string>
      readonly version: string
    }
  >
  readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>
}

export function parseStorageV2PnpmLockfile(lockfile: string): IStorageV2ParsedLockfile

export function pnpmDependencyPathToFilename(dependencyPath: string): string

export function storageV2TarballIntegrity(tarballBytes: Uint8Array): string

export function authorizeStorageV2LockProvenance(
  lockfile: string,
  canonicalConsumerDirectory: string,
  artifacts: readonly IStorageV2ArtifactProvenance[]
): ReadonlyMap<string, IStorageV2LockAuthorization>

export function createStorageV2LockHostiles(
  lockfile: string,
  options: {
    readonly rootPackageName: string
    readonly rootSpecifierReplacement: string
    readonly rootVersionReplacement: string
    readonly transitiveIdentity: string
    readonly transitiveDependencyName: string
    readonly transitiveReplacement: string
    readonly integrity: string
    readonly swappedIntegrity: string
  }
): readonly string[]
