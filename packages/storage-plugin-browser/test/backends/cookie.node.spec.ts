// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { STORAGE_HOST_SOURCE } from '@migaia/storage-host'
import { walkErrorCauses } from '@migaia/utils/error'
import { STORAGE_BROWSER_SOURCE } from '../../src/index.js'
import { createCookieTestStore } from '../helpers/installed-backends.js'

describe('cookiesHost backend（node 环境，无 globalThis.document）', () => {
  it('未注入 document 且 globalThis.document 不存在时抛 BACKEND_UNAVAILABLE', async () => {
    /** The public host owns installation while the original cookie error remains inspectable. */
    const failure: unknown = await createCookieTestStore().catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ source: STORAGE_HOST_SOURCE, code: 'BACKEND_INSTALL_FAILED' })
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({
        source: STORAGE_BROWSER_SOURCE,
        code: 'BACKEND_UNAVAILABLE',
        backend: 'cookies'
      })
    )
  })
})
