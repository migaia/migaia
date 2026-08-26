export type ICompleteStorageInverseEdit = {
  readonly unitId: string
  readonly file: string
  readonly search: string
  readonly replacement: string
}

export type ICompleteStorageInversePlan = {
  readonly baseCommit: string
  readonly paths: readonly string[]
  readonly pathSetSha256: string
  readonly edits: readonly ICompleteStorageInverseEdit[]
}

export function hashCompleteStorageInversePaths(paths: readonly string[]): string

export function verifyCompleteStorageInversePaths(
  expectedPaths: readonly string[],
  actualPaths: readonly string[]
): void

export function deriveCompleteStorageInversePlan(
  repositoryRoot: string,
  migrationUnitsArtifact: string,
  observationSnapshot: string
): ICompleteStorageInversePlan

export function materializeCompleteStorageInverse(
  repositoryRoot: string,
  plan: ICompleteStorageInversePlan
): string

export function buildCompleteStorageInversePackage(
  tree: string,
  packageDirectory: string,
  binaryRoot: string
): void

export function buildCompleteStorageInverseDependencies(tree: string, binaryRoot: string): void
