import { describe, expect, it } from 'vitest'
import { readAbortReason } from '@migaia/storage-host/sdk'

describe('storage operation abort reason policy', () => {
  it('returns undefined or the original cancellation reason', () => {
    const reason = { cancelled: true }
    expect(readAbortReason(undefined)).toBeUndefined()
    expect(readAbortReason({ aborted: true, reason } as never)).toBe(reason)
  })
})
