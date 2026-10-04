import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { authentication } from '../../../src/core/middleware/authentication.js'
import { installPlugin } from './helpers.js'

describe('authentication configuration for encrypted carriers', () => {
  it('[A26] rejects encrypt-only configuration with INVALID_CONFIG', () => {
    assert.throws(
      () => installPlugin(authentication({ encrypt: (value) => value, decrypt: (value) => value })),
      { code: 'INVALID_CONFIG' },
      '[A26] encrypted E2E carriers require sign/verify replay binding'
    )
  })
})
