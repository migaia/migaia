import { describe, expect, it } from 'vitest'
import {
  createAddressIndex,
  formatAddress,
  parseAddress,
  parseBlueprint,
  PartContractErrorCode,
  resolveAddress,
  type IPartNode
} from '../src/index.ts'

/** Blueprint from a root node. */
function blueprint(root: IPartNode) {
  return parseBlueprint({ id: 'bp', version: 1, root })
}

describe('blueprint and address grammar', () => {
  it('derives segments from ids, tags, ordinals, slots and templates', () => {
    const index = createAddressIndex(
      blueprint({
        tag: 'page@1',
        id: 'orders',
        children: [
          { tag: 'button@1' },
          { tag: 'button@1' },
          {
            tag: 'filter@1',
            id: 'filter',
            facets: { slots: { empty: [{ tag: 'text@1' }] } }
          },
          {
            tag: 'table@1',
            id: 'rows',
            template: { rowKey: 'id', node: { tag: 'cell@1', id: 'status' } }
          },
          { tag: 'acme.button@1' },
          { tag: 'slot.x@1' }
        ]
      })
    )
    const addresses = [...index.entries()].map((entry) => entry.address)
    expect(addresses).toEqual([
      'orders',
      'orders/button#0',
      'orders/button#1',
      'orders/filter',
      'orders/filter/slot.empty/text',
      'orders/rows',
      'orders/rows/status',
      'orders/acme-button',
      'orders/slot-x'
    ])
    for (const address of addresses) expect(formatAddress(parseAddress(address))).toBe(address)
    const resolved = resolveAddress(index, 'orders/rows/status@row:1')
    expect(resolved?.node.id).toBe('status')
    expect(resolved?.rowKey).toBe('1')
  })

  it('round-trips row keys that contain grammar characters', () => {
    const address = formatAddress({ segments: ['orders', 'rows', 'status'], rowKey: 'a/b#c@d.e%' })
    expect(parseAddress(address)).toEqual({
      segments: ['orders', 'rows', 'status'],
      rowKey: 'a/b#c@d.e%'
    })
  })

  it('rejects bracket ordinals and invalid names', () => {
    expect(() => parseAddress('orders/button[0]')).toThrow(
      expect.objectContaining({ code: PartContractErrorCode.addressInvalid })
    )
    expect(() => blueprint({ tag: 'page@1', id: 'a.b' })).toThrow(
      expect.objectContaining({
        code: PartContractErrorCode.blueprintInvalid,
        source: 'part.contract'
      })
    )
    expect(() => parseBlueprint({ id: 'bp', version: 1, root: { id: 'x' } })).toThrow(
      expect.objectContaining({ code: PartContractErrorCode.blueprintInvalid })
    )
  })

  it('rejects duplicate addresses from repeated ids and id-versus-generated collisions', () => {
    const repeated = blueprint({
      tag: 'page@1',
      id: 'p',
      children: [
        { tag: 'a@1', id: 'filter' },
        { tag: 'b@1', id: 'filter' }
      ]
    })
    expect(() => createAddressIndex(repeated)).toThrow(
      expect.objectContaining({ code: PartContractErrorCode.addressDuplicate })
    )
    const collision = blueprint({
      tag: 'page@1',
      id: 'p',
      children: [{ tag: 'x@1', id: 'button' }, { tag: 'button@1' }]
    })
    expect(() => createAddressIndex(collision)).toThrow(
      expect.objectContaining({ code: PartContractErrorCode.addressDuplicate })
    )
  })

  it('freezes the parsed document', () => {
    const parsed = blueprint({ tag: 'page@1', id: 'p', children: [{ tag: 'a@1' }] })
    expect(Object.isFrozen(parsed.root.children)).toBe(true)
  })
})
