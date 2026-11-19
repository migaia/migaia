import { join } from 'node:path'
import type { IIssue } from '@migaia/part-contract'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError } from '../errors.ts'
import type { IPartModule } from './collect.ts'
import { BUDGET_EXTERNAL, ReleaseRule, ReleaseText } from './text.ts'

/** Minified browser bundle size of one module, shared runtime external. */
async function bundledSize(file: string): Promise<number> {
  /** Bundler result. */
  const result = await Bun.build({
    entrypoints: [file],
    target: 'browser',
    format: 'esm',
    minify: true,
    external: BUDGET_EXTERNAL
  })
  if (!result.success)
    throw createPartCliError(
      PartCliErrorCode.harnessFailed,
      ReleaseText.budgetSize(file),
      new AggregateError(result.logs)
    )
  return (result.outputs[0] as Blob).size
}

/**
 * `budget.size` issues: one per part module whose bundle exceeds the smallest `budget.size` of the
 * parts it exports. Modules without a size budget are not built.
 */
export async function budgetIssues(
  dir: string,
  modules: readonly IPartModule[]
): Promise<IIssue[]> {
  /** Issues found. */
  const issues: IIssue[] = []
  for (const module of modules) {
    /** Size budgets declared by the module's parts. */
    const budgets = module.parts.flatMap((part) =>
      part.budget?.size === undefined ? [] : [part.budget.size]
    )
    if (budgets.length === 0) continue
    /** Tightest budget. */
    const budget = Math.min(...budgets)
    /** Measured size. */
    const size = await bundledSize(join(dir, module.file))
    if (size > budget)
      issues.push({
        address: '',
        facet: 'module',
        path: module.file,
        code: ReleaseRule.budgetSize,
        rule: ReleaseRule.budgetSize,
        messageKey: ReleaseText.budgetSize(module.file),
        severity: 'error',
        basis: ReleaseText.budgetBasis(size, budget)
      })
  }
  return issues
}
