import { describe, expect, it } from 'vitest'
import {
  createRuleEngine,
  parseBlueprint,
  validateDescriptor,
  type IDescriptor
} from '../src/index.ts'
import { securityRules } from '../src/doctor/index.ts'
import { createTestCatalog } from './fixtures/catalog.ts'

/** Secret-looking API key value. */
const apiKey = 'sk-abcdefghijklmnopqrstuv'

/** Private key header used as a resource parameter. */
const privateKey = '-----BEGIN RSA PRIVATE KEY-----'

/** Engine over the security rules only. */
const engine = createRuleEngine({
  rules: securityRules,
  catalog: createTestCatalog([
    { kind: 'part', id: 'box@1' },
    { kind: 'resource', id: 'orders@1' }
  ] as IDescriptor[])
})

describe('security.secret', () => {
  it('reports secrets in props and resource parameters, never echoing them', () => {
    /** Issues of a blueprint with two secrets and one plain label. */
    const issues = engine.run(
      'authored',
      parseBlueprint({
        id: 'bp',
        version: 1,
        root: {
          tag: 'box@1',
          id: 'root',
          facets: {
            props: {
              apiKey,
              label: 'Create order',
              rows: { $resource: 'orders@1', params: { key: privateKey } }
            }
          }
        }
      })
    )
    expect(issues.map((issue) => [issue.rule, issue.facet, issue.path])).toEqual([
      ['security.secret', 'props', 'apiKey'],
      ['security.secret', 'props', 'rows.params.key']
    ])
    expect(JSON.stringify(issues)).not.toContain(apiKey)
    expect(JSON.stringify(issues)).not.toContain('PRIVATE KEY')
  })
})

describe('budget and virtual fields', () => {
  it('rejects a negative size budget', () => {
    expect(() => validateDescriptor({ kind: 'part', id: 'x@1', budget: { size: -1 } })).toThrow(
      expect.objectContaining({ code: 'DESCRIPTOR_INVALID' })
    )
    expect(
      validateDescriptor({ kind: 'part', id: 'x@1', budget: { size: 1000, render: 5 } }).budget
    ).toEqual({ size: 1000, render: 5 })
  })

  it('rejects a zero row height', () => {
    /** Blueprint with a virtual template. */
    const blueprint = (rowHeight: number) => ({
      id: 'bp',
      version: 1,
      root: {
        tag: 'box@1',
        template: { rowKey: 'id', virtual: { rowHeight }, node: { tag: 'box@1' } }
      }
    })
    expect(() => parseBlueprint(blueprint(0))).toThrow(
      expect.objectContaining({ code: 'BLUEPRINT_INVALID' })
    )
    expect(parseBlueprint(blueprint(20)).root.template?.virtual).toEqual({ rowHeight: 20 })
  })
})
