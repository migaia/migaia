import { describe, expect, it } from 'vitest'
import { createRuleEngine, parseBlueprint, type IPartFacets, type IPartNode } from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog, ruleDescriptors } from './fixtures/catalog.ts'

/** Engine over every built-in rule and the shared fixture catalog. */
const engine = createRuleEngine({
  rules: builtinRules,
  catalog: createTestCatalog(ruleDescriptors)
})

/** Wraps a node as the only child of a plain box root. */
function child(node: IPartNode): IPartNode {
  return { tag: 'box@1', id: 'root', children: [node] }
}

/** Root box carrying the given facets. */
function rootWith(facets: IPartFacets): IPartNode {
  return { tag: 'box@1', id: 'root', facets }
}

/** One violating root per built-in rule, with the address of the offending node. */
const cases: readonly (readonly [string, IPartNode, string])[] = [
  ['html.attr-allowed', child({ tag: 'chip@1', facets: { attrs: { href: 'x' } } }), 'root/chip'],
  [
    'aria.idref-exists',
    child({ tag: 'chip@1', facets: { aria: { controls: 'root/nothing' } } }),
    'root/chip'
  ],
  ['aria.required-props', child({ tag: 'combo@1' }), 'root/combo'],
  ['slot.accepts', rootWith({ slots: { items: [{ tag: 'btn@1' }] } }), 'root'],
  ['slot.max', rootWith({ slots: { items: [{ tag: 'chip@1' }, { tag: 'chip@1' }] } }), 'root'],
  ['slot.non-interactive', rootWith({ slots: { label: [{ tag: 'btn@1' }] } }), 'root'],
  ['catalog.id-exists', child({ tag: 'ghost@1' }), 'root/ghost'],
  ['catalog.major-exists', child({ tag: 'combo@3' }), 'root/combo'],
  ['style.hook-type', rootWith({ style: { '--radius': '8px;}body{color:red' } }), 'root'],
  [
    'event.component-no-capture',
    rootWith({ events: { valueChange: { handler: 'eff@1', capture: true } } }),
    'root'
  ],
  ['event.declared', rootWith({ events: { unknownEvent: { handler: 'eff@1' } } }), 'root'],
  [
    'event.filter-fields',
    rootWith({ events: { valueChange: { handler: 'eff@1', filter: { reason: 'remove' } } } }),
    'root'
  ],
  ['event.custom-namespace', rootWith({ events: { 'bad-custom': { handler: 'eff@1' } } }), 'root'],
  [
    'event.prevent-cancelable',
    rootWith({ events: { 'orders:expand': { handler: 'eff@1', modifiers: ['prevent'] } } }),
    'root'
  ],
  ['event.handler-exists', rootWith({ events: { click: { handler: 'nope@1' } } }), 'root'],
  ['event.sync-tier', rootWith({ events: { click: { handler: 'iso@1', sync: true } } }), 'root'],
  [
    'event.outside-dom',
    rootWith({ events: { 'orders:expand': { handler: 'eff@1', modifiers: ['outside'] } } }),
    'root'
  ],
  ['flow.derive-no-write', rootWith({ props: { v: { $derive: 'wdrv@1' } } }), 'root'],
  ['flow.bind-path', rootWith({ props: { v: { $state: 'global.x' } } }), 'root'],
  ['flow.call-target', rootWith({ events: { click: { handler: 'drv@1' } } }), 'root'],
  ['flow.derive-acyclic', rootWith({ props: { v: { $derive: 'cyc-a@1' } } }), 'root'],
  ['flow.scope', rootWith({ props: { v: { $state: 'section.zone.x' } } }), 'root'],
  ['behavior.tabindex', rootWith({ attrs: { tabindex: 3 } }), 'root'],
  ['behavior.no-aria-override', rootWith({ aria: { expanded: true } }), 'root'],
  ['behavior.no-zindex', rootWith({ style: { 'z-index': 5 } }), 'root'],
  ['behavior.open-state-binding', rootWith({ props: { open: { $derive: 'drv@1' } } }), 'root']
]

describe('built-in rules', () => {
  it('ships exactly the twenty-six documented rules', () => {
    expect(builtinRules.map((rule) => rule.id).sort()).toEqual(cases.map(([id]) => id).sort())
  })

  it.each(cases)('%s reports exactly one issue for its own violation', (rule, root, address) => {
    const issues = engine.run('resolved', parseBlueprint({ id: 'bp', version: 1, root }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ rule, address })
  })

  it('reports nothing for a compliant blueprint', () => {
    const root: IPartNode = {
      tag: 'box@1',
      id: 'root',
      facets: {
        style: { '--radius': '8px' },
        props: { open: { $state: 'page.dialog' } },
        events: {
          click: { handler: 'eff@1' },
          valueChange: { handler: 'eff@1', filter: { reason: 'select' } }
        }
      },
      children: [
        { tag: 'chip@1' },
        { tag: 'combo@1', facets: { aria: { label: 'Fruit', controls: 'root/chip' } } }
      ]
    }
    expect(engine.run('authored', parseBlueprint({ id: 'bp', version: 1, root }))).toEqual([])
  })
})
