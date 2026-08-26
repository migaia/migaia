// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cookies } from '../../src/backends/cookie'

describe('cookies backend（node 环境，无 globalThis.document）', () => {
  it('未注入 document 且 globalThis.document 不存在时抛 BACKEND_UNAVAILABLE', () => {
    expect(() => cookies()).toThrow(expect.objectContaining({ code: 'BACKEND_UNAVAILABLE' }))
  })
})
