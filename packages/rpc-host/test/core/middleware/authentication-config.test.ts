import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { authentication } from '../../../dist/core/middleware/authentication.js'
import { installPlugin } from './helpers.js'

describe('authentication configuration for encrypted carriers', () => {
  it('rejects encrypt-only configuration with INVALID_CONFIG', () => {
    assert.throws(
      () => installPlugin(authentication({ encrypt: (value) => value, decrypt: (value) => value })),
      { code: 'INVALID_CONFIG' },
      'encrypted E2E carriers require sign/verify replay binding'
    )
  })
})
