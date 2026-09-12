// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cookiesHost } from '../../src/backends/cookie'

describe('cookiesHost backend（node 环境，无 globalThis.document）', () => {
  it('未注入 document 且 globalThis.document 不存在时抛 BACKEND_UNAVAILABLE', () => {
    expect(() => cookiesHost()).toThrow(expect.objectContaining({ code: 'BACKEND_UNAVAILABLE' }))
  })
})
