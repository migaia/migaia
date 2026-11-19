import { describe, expect, it } from 'vitest'
import {
  collectDefinitions,
  hashBytes,
  isModuleName,
  parseSnapshot,
  type IBlueprint,
  type IDescriptor
} from '../src/index.ts'
import { createTestCatalog } from './fixtures/catalog.ts'

/** Catalog with a fragment, an enhancer targeting `button`, and a model with a relation. */
const catalog = createTestCatalog([
  { kind: 'part', id: 'page@1' },
  { kind: 'part', id: 'button@1' },
  { kind: 'part', id: 'table@1' },
  { kind: 'part', id: 'cell@1' },
  { kind: 'effect', id: 'save@1' },
  { kind: 'modifier', id: 'stop@1', eventKinds: ['pointer'], placement: false },
  { kind: 'derive', id: 'total@1' },
  { kind: 'resource', id: 'orders@1' },
  { kind: 'enhancer', id: 'label@1', targets: ['button'] },
  { kind: 'enhancer', id: 'unused@1', targets: ['slider'] },
  {
    kind: 'fragment',
    id: 'toolbar@1',
    fragment: { node: { tag: 'button@1', facets: { events: { click: { handler: 'save@1' } } } } }
  },
  {
    kind: 'model',
    id: 'order@1',
    model: {
      schema: { type: 'object', properties: { id: {} } },
      key: ['id'],
      relations: { lines: { target: 'line@1', cardinality: 'many', via: ['id'] } }
    }
  }
] as IDescriptor[])

/** First blueprint: fragment usage, template row event with modifier, derive and resource bindings. */
const first: IBlueprint = {
  id: 'orders',
  version: 1,
  root: {
    tag: 'page@1',
    facets: { props: { title: { $derive: 'total@1' } } },
    children: [
      { tag: 'toolbar@1' },
      {
        tag: 'table@1',
        facets: { props: { rows: { $resource: 'orders@1' }, model: 'x' } },
        template: {
          rowKey: 'id',
          node: {
            tag: 'cell@1',
            facets: { events: { click: { handler: 'save@1', modifiers: ['stop@1'] } } }
          }
        }
      }
    ]
  }
}

/** Second blueprint reusing ids and adding a model reference through a resource-like prop. */
const second: IBlueprint = {
  id: 'other',
  version: 1,
  root: { tag: 'page@1', children: [{ tag: 'toolbar@1' }, { tag: 'order@1' }] }
}

/** Encodes a snapshot object as UTF-8 JSON bytes. */
function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

describe('lock and snapshot', () => {
  it('collects every referenced definition once, in first-occurrence order', () => {
    expect(collectDefinitions([first, second], catalog)).toEqual([
      'page@1',
      'total@1',
      'toolbar@1',
      'table@1',
      'orders@1',
      'button@1',
      'save@1',
      'cell@1',
      'stop@1',
      'order@1',
      'line@1',
      'label@1'
    ])
  })

  it('hashes exact bytes: stable for equal bytes, different after a whitespace change', async () => {
    /** Snapshot bytes. */
    const bytes = bytesOf({ lock: { format: 1 } })
    /** Same text with one added space. */
    const spaced = new TextEncoder().encode(`${JSON.stringify({ lock: { format: 1 } })} `)
    expect(await hashBytes(bytes)).toBe(await hashBytes(bytes.slice()))
    expect(await hashBytes(bytes)).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/)
    expect(await hashBytes(spaced)).not.toBe(await hashBytes(bytes))
  })

  it('rejects a snapshot without lock.format and points at it', () => {
    /** Thrown error. */
    const error = (() => {
      try {
        parseSnapshot(bytesOf({ lock: { project: 'p' }, blueprints: [], descriptors: [] }))
      } catch (caught) {
        return caught as { code: string; cause: { pointer: string } }
      }
      return undefined
    })()
    expect(error?.code).toBe('SNAPSHOT_INVALID')
    expect(error?.cause.pointer).toBe('/lock/format')
  })

  it.each(['../src/x.ts', '/abs.ts', 'a/./b.ts', 'a.js'])('rejects module name %s', (name) => {
    /** Snapshot with one module named `name`. */
    const snapshot = {
      lock: {
        format: 1,
        project: 'p',
        tag: 'v1',
        blueprints: [],
        definitions: [],
        modules: [{ name, id: 'sha256-x', url: 'm/x.js', integrity: 'sha384-x', exports: [] }]
      },
      blueprints: [],
      descriptors: []
    }
    expect(isModuleName(name)).toBe(false)
    expect(() => parseSnapshot(bytesOf(snapshot))).toThrow(
      expect.objectContaining({
        code: 'SNAPSHOT_INVALID',
        cause: expect.objectContaining({ pointer: '/lock/modules/0/name' })
      })
    )
  })

  it('accepts a nested module name', () => {
    expect(isModuleName('effects/notify.ts')).toBe(true)
  })
})
