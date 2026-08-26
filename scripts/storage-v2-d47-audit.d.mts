export type ID47Summary = {
  readonly failed: number
  readonly passed: number
  readonly total: number
}

export type ID47StructuredAssertion = {
  readonly testFile: string
  readonly ancestorTitles: readonly string[]
  readonly title: string
  readonly failureMessageSha256: string
}

export type ID47ParsedJson = {
  readonly assertions: readonly ID47StructuredAssertion[]
  readonly summary: ID47Summary
}

export function deriveD47CausalClosure(
  repositoryRoot: string,
  packageDirectory: string,
  causalRoots: readonly string[]
): readonly string[]

export function parseD47VitestJson(output: string, repositoryRoot: string): ID47ParsedJson

export function verifyD47CausalClosure(
  declaredRows: readonly unknown[],
  derivedRows: readonly unknown[],
  migrationChangedPaths: ReadonlySet<string>
): readonly string[]

export function validateD47Ledger(value: unknown, repositoryRoot: string): void

export function verifyD47GateOutput(
  gateValue: unknown,
  output: string,
  repositoryRoot: string
): void

export function verifyD47InverseDifferential(
  current: ID47ParsedJson,
  reverted: ID47ParsedJson,
  packageName: string
): void
