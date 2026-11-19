import { describe, expect, it } from 'vitest'
import {
  createRuleEngine,
  eventEntries,
  parseBlueprint,
  validateDescriptor,
  type IEventSubscription,
  type IPartNode
} from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog, ruleDescriptors } from './fixtures/catalog.ts'

/** Engine over every built-in rule and the shared fixture catalog. */
const engine = createRuleEngine({
  rules: builtinRules,
  catalog: createTestCatalog(ruleDescriptors)
})

/** Runs authored rules on a root box with one subscription and returns rule id and path pairs. */
function issuesOf(key: string, subscription: IEventSubscription, root?: IPartNode): string[] {
  /** Root node under check. */
  const node: IPartNode = root ?? {
    tag: 'box@1',
    id: 'root',
    facets: { events: { [key]: subscription } }
  }
  return engine
    .run('authored', parseBlueprint({ id: 'bp', version: 1, root: node }))
    .map((issue) => `${issue.rule} ${issue.path}`)
}

describe('modifier rules', () => {
  it('accepts available modifiers in string, object and shorthand form', () => {
    expect(issuesOf('click', { handler: 'eff@1', modifiers: ['outside@1'] })).toEqual([])
    expect(
      issuesOf('click', { handler: 'eff@1', modifiers: [{ id: 'stop@1', args: {} }] })
    ).toEqual([])
    expect(issuesOf('click.once.capture.outside', { handler: 'eff@1' })).toEqual([])
  })

  it('reports a missing modifier at its position', () => {
    expect(issuesOf('click', { handler: 'eff@1', modifiers: ['stop@1', 'missing@1'] })).toEqual([
      'event.modifier-exists click/modifiers/1'
    ])
  })

  it('reports a modifier used on an event kind it does not declare', () => {
    expect(issuesOf('orders:expand', { handler: 'eff@1', modifiers: ['outside@1'] })).toEqual([
      'event.modifier-kind orders:expand/modifiers/0'
    ])
    expect(issuesOf('valueChange', { handler: 'eff@1', modifiers: ['stop@1'] })).toEqual([
      'event.modifier-kind valueChange/modifiers/0'
    ])
  })

  it('separates the placement limit from duplicate ids', () => {
    expect(issuesOf('click', { handler: 'eff@1', modifiers: ['outside@1', 'edge@1'] })).toEqual([
      'event.modifier-placement click/modifiers/1'
    ])
    expect(
      issuesOf('click', { handler: 'eff@1', modifiers: ['stop@1', 'stop@1', 'stop@1'] })
    ).toEqual([
      'event.modifier-duplicate click/modifiers/1',
      'event.modifier-duplicate click/modifiers/2'
    ])
  })

  it('forbids placement modifiers on template nodes', () => {
    /** Template host whose row node subscribes with `outside@1`. */
    const root: IPartNode = {
      tag: 'box@1',
      id: 'root',
      template: {
        rowKey: 'id',
        node: {
          tag: 'chip@1',
          id: 'row',
          facets: { events: { 'click.outside': { handler: 'eff@1' } } }
        }
      }
    }
    expect(issuesOf('', { handler: 'eff@1' }, root)).toEqual([
      'event.modifier-placement click.outside/modifiers/0'
    ])
  })

  it('matches prevent by id in both forms', () => {
    expect(
      issuesOf('orders:expand', { handler: 'eff@1', modifiers: [{ id: 'prevent@1' }] })
    ).toEqual(['event.prevent-cancelable orders:expand'])
  })

  it('normalizes shorthand keys: options merged, key modifiers first', () => {
    expect(
      eventEntries({ 'click.once.native.stop': { handler: 'eff@1', modifiers: ['prevent@1'] } })
    ).toEqual([
      {
        key: 'click.once.native.stop',
        name: 'click',
        subscription: {
          handler: 'eff@1',
          once: true,
          native: true,
          modifiers: ['stop@1', 'prevent@1']
        }
      }
    ])
  })

  it('rejects old literal modifiers and malformed keys at parse time', () => {
    /** Blueprint with one subscription on the root. */
    const blueprint = (events: Record<string, unknown>) => ({
      id: 'bp',
      version: 1,
      root: { tag: 'box@1', facets: { events } }
    })
    expect(() =>
      parseBlueprint(blueprint({ click: { handler: 'eff@1', modifiers: ['stop'] } }))
    ).toThrow(expect.objectContaining({ code: 'BLUEPRINT_INVALID' }))
    expect(() => parseBlueprint(blueprint({ 'click.st op': { handler: 'eff@1' } }))).toThrow(
      expect.objectContaining({ code: 'BLUEPRINT_INVALID' })
    )
  })

  it('ships twenty-nine engine rules without event.outside-dom', () => {
    expect(builtinRules).toHaveLength(37)
    expect(builtinRules.map((rule) => rule.id)).not.toContain('event.outside-dom')
  })

  it('validates modifier descriptors', () => {
    expect(() =>
      validateDescriptor({
        kind: 'modifier',
        id: 'x@1',
        eventKinds: ['component'],
        placement: false
      })
    ).toThrow(expect.objectContaining({ code: 'DESCRIPTOR_INVALID' }))
    expect(
      validateDescriptor({ kind: 'modifier', id: 'x@1', eventKinds: ['dom'], placement: false }).id
    ).toBe('x@1')
  })
})

describe('component event options', () => {
  it('reports once on a component event, whose callback has no once', () => {
    expect(issuesOf('valueChange.once', { handler: 'eff@1' })).toEqual([
      'event.component-no-capture valueChange.once'
    ])
    expect(issuesOf('valueChange', { handler: 'eff@1', once: true })).toEqual([
      'event.component-no-capture valueChange'
    ])
  })
})
