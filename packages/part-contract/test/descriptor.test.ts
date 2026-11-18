import { describe, expect, it } from 'vitest'
import { PartContractErrorCode, validateDescriptor } from '../src/index.ts'

/** Matcher for a DESCRIPTOR_INVALID throw. */
const descriptorInvalid = expect.objectContaining({
  code: PartContractErrorCode.descriptorInvalid,
  source: 'part.contract'
})

describe('descriptor validation', () => {
  it('requires name@major ids and namespaced meta keys', () => {
    expect(() => validateDescriptor({ kind: 'part', id: 'combobox' })).toThrow(descriptorInvalid)
    expect(() =>
      validateDescriptor({ kind: 'part', id: 'combobox@1', meta: { owner: 'x' } })
    ).toThrow(descriptorInvalid)
    expect(
      validateDescriptor({ kind: 'part', id: 'combobox@1', meta: { 'acme.owner': 'x' } }).id
    ).toBe('combobox@1')
  })

  it('accepts extension kinds only from the caller table, with no state between calls', () => {
    const descriptor = { kind: 'validator', id: 'acme.range@1', input: {} }
    expect(() => validateDescriptor(descriptor)).toThrow(descriptorInvalid)
    const kinds = new Map([['validator', { required: ['input'] }]])
    expect(validateDescriptor(descriptor, { kinds }).kind).toBe('validator')
    expect(() => validateDescriptor(descriptor)).toThrow(descriptorInvalid)
    expect(() => validateDescriptor({ kind: 'validator', id: 'acme.range@1' }, { kinds })).toThrow(
      descriptorInvalid
    )
  })
})
