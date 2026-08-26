import { describe, expect, it } from 'vitest'
import {
  isArrayBuffer as contractIsArrayBuffer,
  isUint8Array as contractIsUint8Array
} from '../src/index.js'
import {
  isArrayBuffer as utilsIsArrayBuffer,
  isUint8Array as utilsIsUint8Array
} from '@migaia/utils/bytes'

describe('SWV2-T56 byte-brand ownership', () => {
  it('keeps compatibility exports identical to the utils owner', () => {
    expect(contractIsUint8Array).toBe(utilsIsUint8Array)
    expect(contractIsArrayBuffer).toBe(utilsIsArrayBuffer)
  })
})
