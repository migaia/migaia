// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  STORAGE_HOST_ERROR_SOURCE,
  STORAGE_BROWSER_ERROR_SOURCE
} from '@migaia/storage-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { createCookieTestStore } from '../helpers/installed-backends.ts'

describe('cookiesHost backend（node 环境，无 globalThis.document）', () => {
  it('未注入 document 且 globalThis.document 不存在时抛 BACKEND_UNAVAILABLE', async () => {
    /** The public host owns installation while the original cookie error remains inspectable. */
    const failure: unknown = await createCookieTestStore().catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      source: STORAGE_HOST_ERROR_SOURCE,
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({
        source: STORAGE_BROWSER_ERROR_SOURCE,
        code: 'BACKEND_UNAVAILABLE',
        backend: 'cookies'
      })
    )
  })
})
