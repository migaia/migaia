import { describe, expect, it } from 'vitest'
import {
  createRuleEngine,
  defineRule,
  parseBlueprint,
  PartContractErrorCode
} from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog } from './fixtures/catalog.ts'

/** Two-node blueprint used by the incremental run checks. */
const twoNodes = parseBlueprint({
  id: 'bp',
  version: 1,
  root: {
    tag: 'page@1',
    id: 'p',
    children: [
      { tag: 'x@1', id: 'a' },
      { tag: 'x@1', id: 'b' }
    ]
  }
})

describe('rule engine', () => {
  it('runs part rules only for changed addresses, blueprint rules once, and isolates a throwing rule', () => {
    const seen: string[] = []
    let blueprintCalls = 0
    const failure = new Error('rule bug')
    const engine = createRuleEngine({
      catalog: createTestCatalog([]),
      rules: [
        defineRule({
          id: 'test.part',
          scope: 'part',
          phase: 'authored',
          severity: 'error',
          check: (context) => void seen.push(context.address as string)
        }),
        defineRule({
          id: 'test.throws',
          scope: 'part',
          phase: 'authored',
          severity: 'error',
          check: () => {
            throw failure
          }
        }),
        defineRule({
          id: 'test.whole',
          scope: 'blueprint',
          phase: 'authored',
          severity: 'error',
          check: () => void (blueprintCalls += 1)
        })
      ]
    })
    const issues = engine.run('authored', twoNodes, { changed: ['p/a'] })
    expect(seen).toEqual(['p/a'])
    expect(blueprintCalls).toBe(1)
    expect(issues).toEqual([
      expect.objectContaining({
        code: PartContractErrorCode.ruleFailed,
        rule: 'test.throws',
        address: 'p/a',
        cause: failure
      })
    ])
  })

  it('treats enhancer writes as provided in the authored phase only', () => {
    const catalog = createTestCatalog(
      [{ kind: 'part', id: 'combo@1', behavior: { semantics: { pattern: 'combobox' } } }],
      { 'combo@1': ['props.label'] }
    )
    const engine = createRuleEngine({ rules: builtinRules, catalog })
    const bp = parseBlueprint({ id: 'bp', version: 1, root: { tag: 'combo@1', id: 'c' } })
    expect(engine.run('authored', bp)).toEqual([])
    expect(engine.run('resolved', bp)).toEqual([
      expect.objectContaining({ rule: 'aria.required-props', address: 'c' })
    ])
  })
})
