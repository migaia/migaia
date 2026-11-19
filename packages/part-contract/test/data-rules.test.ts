import { describe, expect, it } from 'vitest'
import {
  checkModels,
  createRuleEngine,
  parseBlueprint,
  type IDescriptor,
  type IPartNode
} from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog } from './fixtures/catalog.ts'
import { fieldPart, tablePart } from './fixtures/data.ts'

/** Catalog descriptors of the data rule cases. */
const descriptors: readonly IDescriptor[] = [
  { kind: 'part', id: 'box@1', slots: {} },
  tablePart,
  fieldPart,
  {
    kind: 'resource',
    id: 'orders@1',
    args: { type: 'object', properties: { status: { enum: ['open', 'closed'] } } }
  },
  { kind: 'derive', id: 'count@1' },
  {
    kind: 'model',
    id: 'order@1',
    model: {
      schema: { type: 'object', properties: { id: {} } },
      key: ['id'],
      relations: { lines: { target: 'line@1', cardinality: 'many', via: ['id'] } }
    }
  }
]

/** Engine over every built-in rule. */
const engine = createRuleEngine({ rules: builtinRules, catalog: createTestCatalog(descriptors) })

/** Rule ids of the authored issues of a box root with one child. */
function rulesOf(child: IPartNode): string[] {
  return engine
    .run(
      'authored',
      parseBlueprint({ id: 'b', version: 1, root: { tag: 'box@1', id: 'root', children: [child] } })
    )
    .map((issue) => issue.rule)
}

/** Table node whose source prop carries the given binding. */
function table(source: unknown, extra: Record<string, unknown> = {}): IPartNode {
  return { tag: 'table@1', id: 't', facets: { props: { source, ...extra } } }
}

describe('data rules', () => {
  it('accepts a resource binding on the declared prop with valid literal params', () => {
    expect(rulesOf(table({ $resource: 'orders@1', params: { status: 'open' } }))).toEqual([])
  })

  it.each([
    ['a derive', 'count@1'],
    ['a missing id', 'missing@1']
  ])('reports resource.bind-target for %s', (_name, id) => {
    expect(rulesOf(table({ $resource: id }))).toEqual(['resource.bind-target'])
  })

  it('reports resource.bind-prop outside the declared prop', () => {
    expect(
      rulesOf(table(undefined, { title: { $resource: 'orders@1' } })).filter(
        (rule) => rule === 'resource.bind-prop'
      )
    ).toHaveLength(1)
    expect(
      rulesOf({
        tag: 'field@1',
        id: 'f',
        facets: { props: { value: { $state: 'page.v' }, options: { $resource: 'orders@1' } } }
      })
    ).toEqual(['resource.bind-prop'])
  })

  it.each([
    ['a literal outside the enum', { status: 'lost' }],
    ['an unknown key', { status: 'open', x: 1 }]
  ])('reports resource.params for %s', (_name, params) => {
    expect(rulesOf(table({ $resource: 'orders@1', params }))).toEqual(['resource.params'])
  })

  it('checks bindings nested in params with the existing binding rules', () => {
    expect(
      rulesOf(table({ $resource: 'orders@1', params: { status: { $state: 'page.filter' } } }))
    ).toEqual([])
    expect(
      rulesOf(table({ $resource: 'orders@1', params: { status: { $state: 'filter' } } }))
    ).toEqual(['flow.bind-path'])
    expect(
      rulesOf(table({ $resource: 'orders@1', params: { status: { $derive: 'missing@1' } } }))
    ).toEqual(['catalog.id-exists'])
  })

  it('warns when a field value prop is not bound to state', () => {
    expect(rulesOf({ tag: 'field@1', id: 'f', facets: { props: { value: 'x' } } })).toEqual([
      'field.value-bound'
    ])
    expect(
      rulesOf({ tag: 'field@1', id: 'f', facets: { props: { value: { $state: 'page.v' } } } })
    ).toEqual([])
  })

  it('reports missing model relation targets once per relation', () => {
    /** Issues of the catalog check. */
    const issues = checkModels(createTestCatalog(descriptors))
    expect(issues.map((issue) => [issue.rule, issue.path])).toEqual([
      ['model.relation-target', 'model.relations.lines']
    ])
    expect(builtinRules).toHaveLength(36)
  })
})
