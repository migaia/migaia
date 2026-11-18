import { describe, expect, it } from 'vitest'
import {
  createRuleEngine,
  parseBlueprint,
  validateDescriptor,
  type IDescriptor
} from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog } from './fixtures/catalog.ts'

describe('behavior groups and event subscriptions', () => {
  it('accepts a full behavior declaration and flags capture on a component event', () => {
    const combobox: IDescriptor = validateDescriptor({
      kind: 'part',
      id: 'combobox@1',
      behavior: {
        semantics: { element: 'input', role: 'combobox', pattern: 'combobox' },
        focus: { restore: true, mode: 'activedescendant' },
        layer: 'top',
        managedBy: 'component',
        states: { names: ['open'], openState: 'open', openChange: 'openChange' }
      },
      events: { valueChange: { kind: 'component', reason: ['select'] } }
    })
    const engine = createRuleEngine({
      rules: builtinRules,
      catalog: createTestCatalog([combobox, { kind: 'effect', id: 'sync-filter@1' }])
    })
    const issues = engine.run(
      'authored',
      parseBlueprint({
        id: 'bp',
        version: 1,
        root: {
          tag: 'combobox@1',
          id: 'fruit',
          facets: {
            aria: { label: 'Fruit' },
            events: { valueChange: { handler: 'sync-filter@1', capture: true } }
          }
        }
      })
    )
    expect(issues).toEqual([
      expect.objectContaining({
        rule: 'event.component-no-capture',
        address: 'fruit',
        facet: 'events',
        path: 'valueChange'
      })
    ])
  })
})
