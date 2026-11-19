import { describe, expect, it } from 'vitest'
import {
  auditTargets,
  checkBase,
  mergeBlueprint,
  type IBlueprint,
  type IChangesetArtifact,
  type IPartNode
} from '../src/index.ts'

/** Base page: a form with a button and a field, and a list with a template. */
const base: IBlueprint = {
  id: 'orders',
  version: 1,
  root: {
    tag: 'page@1',
    id: 'page',
    children: [
      {
        tag: 'form@1',
        id: 'form',
        facets: { props: { title: 'Form' } },
        children: [
          { tag: 'button@1', id: 'create', facets: { props: { label: 'Create' } } },
          { tag: 'field@1', id: 'name', facets: { props: { label: 'Name' } } },
          { tag: 'field@1', id: 'note', facets: { props: { label: 'Note' } } }
        ]
      },
      {
        tag: 'list@1',
        id: 'list',
        template: { rowKey: 'id', rows: [], node: { tag: 'row@1', id: 'row' } }
      }
    ]
  }
}

/** Deep copy of the base for one side's edits. */
function copyOf(blueprint: IBlueprint): { root: IPartNode & Record<string, unknown> } & IBlueprint {
  return structuredClone(blueprint) as never
}

/** Mutable view of a node, for editing test copies. */
type IEditableNode = {
  id?: string
  facets: Record<string, Record<string, unknown>>
  children: IEditableNode[]
  template: Record<string, unknown>
}

/** Mutable root of a copy. */
function rootOf(blueprint: IBlueprint): IEditableNode {
  return blueprint.root as unknown as IEditableNode
}

/** The form node of a copy. */
function form(blueprint: IBlueprint): IEditableNode {
  return rootOf(blueprint).children[0] as IEditableNode
}

/** Merge of two edit functions applied to copies of the base. */
function mergeWith(editOurs: (b: IBlueprint) => void, editTheirs: (b: IBlueprint) => void) {
  /** Our copy. */
  const ours = copyOf(base)
  /** Their copy. */
  const theirs = copyOf(base)
  editOurs(ours)
  editTheirs(theirs)
  return mergeBlueprint(base, ours, theirs)
}

describe('mergeBlueprint', () => {
  it('(1) keeps both sides when they change different groups of one node', () => {
    /** Merge result. */
    const result = mergeWith(
      (b) => void (form(b).children[0]!.facets.props!.label = 'New order'),
      (b) => void (form(b).children[0]!.facets.attrs = { title: 'Create' })
    )
    expect(result.conflicts).toEqual([])
    expect(form(result.merged).children[0]!.facets).toEqual({
      props: { label: 'New order' },
      attrs: { title: 'Create' }
    })
  })

  it('(2) reports deleting a node the other side changed', () => {
    /** Merge result. */
    const result = mergeWith(
      (b) => void form(b).children.splice(1, 1),
      (b) => void (form(b).children[1]!.facets.props!.label = 'Full name')
    )
    expect(result.conflicts).toEqual([
      { address: 'page/form/name', facet: 'node', path: '/root/children/0/children/1' }
    ])
  })

  it('(3) reports one prop group changed to different values', () => {
    /** Merge result. */
    const result = mergeWith(
      (b) => void (form(b).children[0]!.facets.props!.label = 'New order'),
      (b) => void (form(b).children[0]!.facets.props!.label = 'Add order')
    )
    expect(result.conflicts).toEqual([
      { address: 'page/form/create', facet: 'props', path: '/root/children/0/children/0' }
    ])
    expect(form(result.merged).children[0]!.facets.props!.label).toBe('New order')
  })

  it('(4) takes an identical change from both sides', () => {
    /** Merge result. */
    const result = mergeWith(
      (b) => void (form(b).children[0]!.facets.props!.label = 'New order'),
      (b) => void (form(b).children[0]!.facets.props!.label = 'New order')
    )
    expect(result.conflicts).toEqual([])
  })

  it('(5) keeps a node added on one side while the other changes the parent', () => {
    /** Merge result. */
    const result = mergeWith(
      (b) =>
        void form(b).children.push({
          tag: 'field@1',
          id: 'phone',
          facets: { props: { label: 'Phone' } }
        } as unknown as IEditableNode),
      (b) => void (form(b).facets.props!.title = 'Order form')
    )
    expect(result.conflicts).toEqual([])
    expect(form(result.merged).children.map((child) => child.id)).toEqual([
      'create',
      'name',
      'note',
      'phone'
    ])
    expect(form(result.merged).facets.props!.title).toBe('Order form')
  })

  it('(6) reports different child orders under the parent address', () => {
    /** Merge result. */
    const result = mergeWith(
      (b) => void form(b).children.reverse(),
      (b) => void form(b).children.push(form(b).children.shift()!)
    )
    expect(result.conflicts).toEqual([
      { address: 'page/form', facet: 'children', path: '/root/children/0' }
    ])
  })

  it('(7) takes a template configuration change from one side', () => {
    /** Merge result. */
    const result = mergeWith(
      () => undefined,
      (b) => void (rootOf(b).children[1]!.template.rowKey = 'key')
    )
    expect(result.conflicts).toEqual([])
    expect(rootOf(result.merged).children[1]!.template).toEqual({
      rowKey: 'key',
      rows: [],
      node: { tag: 'row@1', id: 'row' }
    })
  })
})

describe('auditTargets and checkBase', () => {
  it('names the address and props group of a label change', () => {
    /** Edited copy. */
    const after = copyOf(base)
    form(after).children[0]!.facets.props!.label = 'New order'
    expect(auditTargets(base, after)).toEqual([{ address: 'page/form/create', facet: 'props' }])
  })

  it('returns conflict when the base hash differs', () => {
    /** Blueprint artifact based on hash `a`. */
    const artifact: IChangesetArtifact = {
      kind: 'blueprint',
      id: 'orders',
      base: 'sha256-a',
      patch: []
    }
    expect(checkBase('sha256-b', artifact)).toBe('conflict')
    expect(checkBase('sha256-a', artifact)).toBe('accepted')
  })
})
