import { describe, expect, it } from 'vitest'
import * as contract from '../src/index.js'
import {
  isArrayBuffer as utilsIsArrayBuffer,
  isUint8Array as utilsIsUint8Array
} from '@migaia/utils/bytes'

describe('SWV2-T56 byte-brand ownership', () => {
  it('uses the utils owner without exporting compatibility aliases', () => {
    expect(contract).not.toHaveProperty('isUint8Array')
    expect(contract).not.toHaveProperty('isArrayBuffer')
    expect(utilsIsUint8Array(new Uint8Array())).toBe(true)
    expect(utilsIsArrayBuffer(new ArrayBuffer(1))).toBe(true)
  })
})
