export type ISemanticModuleRecord = Readonly<{
  semanticId: string
  packageName: string
  emittedRole: string
  sourcePaths: readonly string[]
  originalBytes: number
  renderedBytes: number
  copies: number
}>

export function sourceMapSources(sourceMap: unknown): readonly string[]
export function resolveSourceMapSources(sourceMap: unknown, emittedFile: string): readonly string[]
export function semanticModuleId(record: unknown): string
export function normalizeSemanticModules(
  records: Iterable<Readonly<Record<string, unknown>>>
): readonly ISemanticModuleRecord[]
export function normalizeOwnedSemanticModules(
  records: Iterable<Readonly<Record<string, unknown>>>,
  knownOwners: ReadonlyMap<string, string> | Readonly<Record<string, string>>
): readonly ISemanticModuleRecord[]
export function assertSemanticModuleEvidence(
  expected: Iterable<ISemanticModuleRecord>,
  observed: Iterable<ISemanticModuleRecord>
): void
export function hasPackageRoot(packageRoot: string): boolean
