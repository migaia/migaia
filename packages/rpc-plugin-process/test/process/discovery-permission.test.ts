import { walkErrorCauses } from '@migaia/utils/error'
import { afterEach, expect, it, vi } from 'vitest'

/** Restore only the native namespace supplied by this public discovery fixture. */
afterEach(() => vi.unstubAllGlobals())

it('does not read denied Deno environment keys and rejects a granted invalid bootstrap marker before I/O', async () => {
  /** Module reset isolates this process's public discovery cache from other process fixtures. */
  vi.resetModules()
  /** Permission is owned by the native host and changes before a later public discovery call. */
  let granted = false
  /** Environment access is observable independently of source acquisition. */
  const get = vi.fn(() => 'unsupported-bootstrap-version')
  /** Discovery consumes a present marker so grandchildren do not inherit it. */
  const remove = vi.fn()
  /** No invalid discovery record may open physical stdin or stdout. */
  const stdin = vi.fn(() => {
    throw new Error('stdin must remain unopened')
  })
  vi.stubGlobal('Deno', {
    version: { deno: '2.0.0' },
    env: { get, delete: remove },
    permissions: { querySync: () => ({ state: granted ? 'granted' : 'denied' }) },
    get stdin() {
      return stdin()
    }
  })
  /** Both operations use the package's actual native loader and original discovery owner. */
  const { createProcessPeer } = await import('../protocol.js')
  const { isProcessChild } = await import('@migaia/rpc-plugin-process')
  /** A caller-owned connect failure proves denied discovery follows the ordinary supplied source. */
  const failure = new Error('caller connect failed')
  /** The custom source remains lazy until discovery confirms no automatic bootstrap is available. */
  const connect = vi.fn(async () => {
    throw failure
  })
  expect(isProcessChild()).toBe(false)
  await expect(createProcessPeer({ connect, report: () => undefined })).rejects.toSatisfy(
    (error: unknown) => walkErrorCauses(error).includes(failure)
  )
  expect(get).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  expect(connect).toHaveBeenCalledOnce()
  granted = true
  expect(isProcessChild()).toBe(false)
  await expect(createProcessPeer({ connect, report: () => undefined })).rejects.toMatchObject({
    source: 'rpc.endpoint',
    code: 'INVALID_CONFIG',
    message: 'process runtime API bootstrap is invalid'
  })
  expect(get).toHaveBeenCalled()
  expect(remove).toHaveBeenCalledOnce()
  expect(connect).toHaveBeenCalledOnce()
  expect(stdin).not.toHaveBeenCalled()
})
