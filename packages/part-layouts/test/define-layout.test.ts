import { PartContractErrorCode } from '@migaia/part-contract'
import { describe, expect, it } from 'vitest'
import { defineLayout } from '../src/index.ts'

describe('defineLayout', () => {
  it('builds a part descriptor with one slot per region', () => {
    const layout = defineLayout({
      id: 'shell@1',
      direction: 'row',
      regions: [
        {
          name: 'side',
          landmark: 'complementary',
          resizable: true,
          size: { default: 200, min: 100, max: 300 }
        },
        { name: 'body', landmark: 'main' }
      ]
    })
    expect(layout.descriptor.kind).toBe('part')
    expect(Object.keys(layout.descriptor.slots ?? {})).toEqual(['side', 'body'])
    expect(layout.descriptor.behavior?.layout?.regions[0]?.size?.default).toBe(200)
    expect(layout.descriptor.behavior?.semantics).toBeUndefined()
    expect('title' in layout.descriptor).toBe(false)
    expect(Object.isFrozen(layout.descriptor.behavior?.layout?.regions[0])).toBe(true)
  })

  it('throws DESCRIPTOR_INVALID synchronously without a main region', () => {
    expect(() =>
      defineLayout({
        id: 'shell@1',
        direction: 'row',
        regions: [{ name: 'side', landmark: 'complementary' }]
      })
    ).toThrow(expect.objectContaining({ code: PartContractErrorCode.descriptorInvalid }))
  })
})
