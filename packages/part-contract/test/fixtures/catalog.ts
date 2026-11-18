import { splitDescriptorId, type ICatalogView, type IDescriptor } from '../../src/index.ts'

/** Builds an in-memory catalog view from descriptors and per-tag enhancer writes. */
export function createTestCatalog(
  descriptors: readonly IDescriptor[],
  writes: Readonly<Record<string, readonly string[]>> = {}
): ICatalogView {
  /** Descriptors by full id. */
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
  /** Available majors by name. */
  const majors = new Map<string, number[]>()
  for (const descriptor of descriptors) {
    /** Name and major of the descriptor. */
    const { name, major } = splitDescriptorId(descriptor.id)
    majors.set(name, [...(majors.get(name) ?? []), major])
  }
  return {
    get: (id) => byId.get(id),
    majors: (name) => majors.get(name) ?? [],
    writesFor: (tag) => writes[tag] ?? []
  }
}

/** Descriptors shared by the built-in rule tests. */
export const ruleDescriptors: readonly IDescriptor[] = [
  {
    kind: 'part',
    id: 'box@1',
    styleHooks: { '--radius': 'length' },
    slots: { items: { accepts: ['chip'], max: 1 }, label: { interactive: false } },
    events: {
      'orders:expand': { kind: 'custom' },
      'bad-custom': { kind: 'custom' },
      valueChange: {
        kind: 'component',
        reason: ['select'],
        detail: { type: 'object', properties: { value: {} } }
      }
    },
    behavior: {
      aria: { expanded: { fromState: 'open' } },
      states: { names: ['open'], openState: 'open' }
    }
  },
  { kind: 'part', id: 'chip@1', behavior: { semantics: { element: 'span' } } },
  { kind: 'part', id: 'btn@1', behavior: { semantics: { element: 'button', role: 'button' } } },
  {
    kind: 'part',
    id: 'combo@1',
    behavior: { semantics: { element: 'input', pattern: 'combobox' } }
  },
  { kind: 'modifier', id: 'stop@1', eventKinds: ['dom', 'custom'], placement: false },
  { kind: 'modifier', id: 'prevent@1', eventKinds: ['dom', 'custom'], placement: false },
  { kind: 'modifier', id: 'outside@1', eventKinds: ['dom'], placement: true },
  { kind: 'modifier', id: 'edge@1', eventKinds: ['dom'], placement: true },
  { kind: 'effect', id: 'eff@1' },
  { kind: 'effect', id: 'iso@1', tier: 'isolated' },
  { kind: 'derive', id: 'drv@1' },
  { kind: 'derive', id: 'wdrv@1', writes: ['page.x'] },
  { kind: 'derive', id: 'cyc-a@1', inputs: ['cyc-b@1'] },
  { kind: 'derive', id: 'cyc-b@1', inputs: ['cyc-a@1'] }
]
