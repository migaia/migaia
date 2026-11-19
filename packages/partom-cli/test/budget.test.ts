import { describe, expect, it } from 'vitest'
import { json, partom } from './run.ts'

/** Shape of `doctor --json` output used here. */
type IOutput = {
  readonly issues: readonly {
    readonly rule: string
    readonly address: string
    readonly basis?: string
  }[]
}

describe('render budgets', () => {
  it('reports only the slow part, measured at its first node', () => {
    /** Doctor run with rendered checks. */
    const run = partom('budget', ['doctor', '--rendered', '--json'])
    /** Budget issues. */
    const budget = json<IOutput>(run).issues.filter((issue) => issue.rule === 'budget.render')
    expect(budget).toHaveLength(1)
    expect(budget[0]?.address).toBe('p/heavy')
    /** Measured median from the basis text. */
    const median = Number(/median ([\d.]+)ms > budget 5ms/.exec(budget[0]?.basis ?? '')?.[1])
    expect(median).toBeGreaterThan(5)
    expect(run.code).toBe(1)
  })
})
