import { afterEach, expect, it, vi } from 'vitest'
import { createWindowCarrier } from '../../dist/browser/adapters/window.js'
import { GlobalScopeKind } from '@migaia/utils'

/** Scope selection is observed at the existing utils boundary, without a second detector. */
const scope = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock('@migaia/utils', async (original) => ({
  ...(await original<typeof import('@migaia/utils')>()),
  detectGlobalScope: () => scope.current
}))

afterEach(() => vi.unstubAllGlobals())

it('selects native default receivers by the canonical browser scope while retaining explicit receivers', async () => {
  /** The actual native constructor acquires callbacks; its SDK close releases each acquisition. */
  const receiver = { addEventListener() {}, removeEventListener() {} }
  /** The outgoing target does not also own the receiving realm. */
  const target = { postMessage() {} }
  vi.stubGlobal('addEventListener', receiver.addEventListener)
  vi.stubGlobal('removeEventListener', receiver.removeEventListener)
  for (const kind of Object.values(GlobalScopeKind)) {
    scope.current = kind
    if (kind === GlobalScopeKind.window) {
      /** Only the Window realm may lend its global EventTarget as the default native receiver. */
      let carrier: ReturnType<typeof createWindowCarrier> | undefined
      expect(
        () =>
          (carrier = createWindowCarrier(
            { target, targetOrigin: 'https://scope.test' },
            { report: () => undefined }
          ))
      ).not.toThrow()
      await carrier?.close()
    } else
      expect(() =>
        createWindowCarrier(
          { target, targetOrigin: 'https://scope.test' },
          { report: () => undefined }
        )
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    /** Injected native carrier shapes remain valid independently of the test runner's global kind. */
    let carrier: ReturnType<typeof createWindowCarrier> | undefined
    expect(
      () =>
        (carrier = createWindowCarrier(
          { target, receiver, targetOrigin: 'https://scope.test' },
          { report: () => undefined }
        ))
    ).not.toThrow()
    await carrier?.close()
  }
})
