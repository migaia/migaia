import { describe, expect, it } from 'vitest'
import { isResourceBinding, PartContractErrorCode, validateDescriptor } from '../src/index.ts'
import { fieldPart, tablePart } from './fixtures/data.ts'

/** Matcher for a DESCRIPTOR_INVALID throw. */
const descriptorInvalid = expect.objectContaining({
  code: PartContractErrorCode.descriptorInvalid
})

describe('resource and field behaviour groups', () => {
  it('accepts declared status slots and a declared or DOM change event', () => {
    expect(validateDescriptor(tablePart)).toBe(tablePart)
    expect(validateDescriptor(fieldPart)).toBe(fieldPart)
    expect(() =>
      validateDescriptor({
        ...fieldPart,
        events: {},
        behavior: { field: { value: 'value', change: 'input', read: 'target-value' } }
      })
    ).not.toThrow()
  })

  it('rejects an undeclared status slot and an undeclared component change event', () => {
    expect(() =>
      validateDescriptor({
        ...tablePart,
        behavior: { resource: { prop: 'source', slots: { empty: 'nothing' } } }
      })
    ).toThrow(descriptorInvalid)
    expect(() =>
      validateDescriptor({
        ...fieldPart,
        behavior: { field: { value: 'value', change: 'pick' } }
      })
    ).toThrow(descriptorInvalid)
    expect(() =>
      validateDescriptor({
        ...fieldPart,
        behavior: { field: { value: 'value', change: 'valueChange', read: 'other' } }
      })
    ).toThrow(descriptorInvalid)
  })

  it('recognises resource bindings', () => {
    expect(isResourceBinding({ $resource: 'orders@1' })).toBe(true)
    expect(isResourceBinding({ $resource: 'orders@1', params: { status: 'open' } })).toBe(true)
    expect(isResourceBinding({ $resource: 3 })).toBe(false)
    expect(isResourceBinding({ $resource: 'orders@1', params: [] })).toBe(false)
  })
})
