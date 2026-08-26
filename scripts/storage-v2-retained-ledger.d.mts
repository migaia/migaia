export type IStorageV2InstalledRoot = {
  readonly root: string
}

export function normalizeRetainedModule(
  moduleId: string,
  consumerDirectory: string,
  installedPackages: ReadonlyMap<string, IStorageV2InstalledRoot>
): string

export function normalizeRetainedModules(
  moduleIds: Iterable<string>,
  consumerDirectory: string,
  installedPackages: ReadonlyMap<string, IStorageV2InstalledRoot>
): readonly string[]

export function assertExactRetainedModules(
  modules: Iterable<string>,
  expectedModules: Iterable<string>
): void
