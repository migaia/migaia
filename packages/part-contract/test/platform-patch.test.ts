import { describe, expect, it } from 'vitest'
import {
  affectedAddresses,
  applyPatch,
  createAddressIndex,
  parseBlueprint,
  type IJsonPatchOperation
} from '../src/index.ts'

/** Document with three children under the root. */
const document = {
  id: 'bp',
  version: 1,
  root: {
    tag: 'box@1',
    id: 'root',
    children: [
      { tag: 'item@1', id: 'a' },
      { tag: 'item@1', id: 'b' },
      { tag: 'box@1', id: 'c', children: [{ tag: 'item@1', id: 'd' }] }
    ]
  }
}

/** Address index of the document. */
const index = createAddressIndex(parseBlueprint(document))

describe('applyPatch', () => {
  it.each<[string, IJsonPatchOperation, unknown]>([
    [
      'add',
      { op: 'add', path: '/root/children/0', value: { tag: 'item@1', id: 'z' } },
      ['z', 'a', 'b', 'c']
    ],
    ['remove', { op: 'remove', path: '/root/children/1' }, ['a', 'c']],
    [
      'replace',
      { op: 'replace', path: '/root/children/1', value: { tag: 'item@1', id: 'y' } },
      ['a', 'y', 'c']
    ],
    ['move', { op: 'move', from: '/root/children/2', path: '/root/children/0' }, ['c', 'a', 'b']]
  ])('%s keeps the input unchanged and yields the expected order', (_op, operation, ids) => {
    /** Patched document. */
    const patched = applyPatch(document, [operation]) as typeof document
    expect(patched.root.children.map((child) => child.id)).toEqual(ids)
    expect(document.root.children.map((child) => child.id)).toEqual(['a', 'b', 'c'])
  })

  it.each(['copy', 'test'])('rejects %s without writing anything', (op) => {
    /** Unsupported operation. */
    const operations = [
      { op: 'replace', path: '/root/children/0/id', value: 'changed' },
      { op, from: '/root/children/0', path: '/root/children/1', value: 1 }
    ] as unknown as IJsonPatchOperation[]
    expect(() => applyPatch(document, operations)).toThrow(
      expect.objectContaining({ code: 'PATCH_OP_UNSUPPORTED', cause: { index: 1, op } })
    )
    expect(JSON.stringify(document)).not.toContain('changed')
  })
})

describe('affectedAddresses', () => {
  it('counts a move as a change of the parent, not of the node at the target position', () => {
    expect([
      ...affectedAddresses(index.entries(), [
        { op: 'move', from: '/root/children/2', path: '/root/children/0' }
      ])
    ]).toEqual(['root'])
  })

  it('counts a move between parents as a change of both parents', () => {
    expect([
      ...affectedAddresses(index.entries(), [
        { op: 'move', from: '/root/children/2/children/0', path: '/root/children/0' }
      ])
    ]).toEqual(['root/c', 'root'])
  })

  it('keeps add, remove and replace attribution', () => {
    expect([
      ...affectedAddresses(index.entries(), [
        { op: 'replace', path: '/root/children/0/facets/props/label', value: 'x' },
        { op: 'remove', path: '/root/children/1' }
      ])
    ]).toEqual(['root/a', 'root'])
  })
})
