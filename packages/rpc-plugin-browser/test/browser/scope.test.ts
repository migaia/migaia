import { afterEach, expect, it, vi } from 'vitest'
import { createWindowMessageTransport } from '@migaia/rpc-plugin-browser/adapters/window'
import { GlobalScopeKind } from '@migaia/utils'

/** Scope selection is observed at the existing utils boundary, without a second detector. */
const scope = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock('@migaia/utils', async (original) => ({
  ...(await original<typeof import('@migaia/utils')>()),
  detectGlobalScope: () => scope.current
}))

afterEach(() => vi.unstubAllGlobals())

it('selects native default receivers by the canonical browser scope while retaining explicit receivers', () => {
  /** Native registration is inert until subscribe and every returned remover remains observable. */
  const receiver = { addEventListener() {}, removeEventListener() {} }
  /** The outgoing target does not also own the receiving realm. */
  const target = { postMessage() {} }
  vi.stubGlobal('addEventListener', receiver.addEventListener)
  vi.stubGlobal('removeEventListener', receiver.removeEventListener)
  for (const kind of Object.values(GlobalScopeKind)) {
    scope.current = kind
    if (kind === GlobalScopeKind.window)
      expect(() =>
        createWindowMessageTransport({ target, targetOrigin: 'https://scope.test' })
      ).not.toThrow()
    else
      expect(() =>
        createWindowMessageTransport({ target, targetOrigin: 'https://scope.test' })
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    /** Injected native carrier shapes remain valid independently of the test runner's global kind. */
    expect(() =>
      createWindowMessageTransport({ target, receiver, targetOrigin: 'https://scope.test' })
    ).not.toThrow()
  }
})
