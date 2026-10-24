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
  /** Exercise the native discovery owner still used by processPlugin.parent(true). */
  const { NativeProcessRuntimeLoader } = await import('../../dist/process/runtime-loader.js')
  const { openAutomaticProcessIO } = await import('../../dist/process/automatic-peer.js')
  const { isProcessChild } = await import('@migaia/rpc-plugin-process')
  /** Loading and reading the denied marker must not acquire native I/O. */
  const native = await new NativeProcessRuntimeLoader().load()
  expect(native).toBeDefined()
  expect(isProcessChild()).toBe(false)
  expect(native!.processRuntimeIO.discover()).toEqual({ marker: undefined, runtime: 'deno' })
  expect(get).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  granted = true
  expect(isProcessChild()).toBe(false)
  /** The same production bootstrap admission rejects the marker before calling native open. */
  const discovered = native!.processRuntimeIO.discover()
  expect(() =>
    openAutomaticProcessIO({
      ...discovered,
      open: () => native!.processRuntimeIO.open()
    })
  ).toThrowError(
    expect.objectContaining({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG',
      message: 'process runtime API bootstrap is invalid'
    })
  )
  expect(get).toHaveBeenCalled()
  expect(remove).toHaveBeenCalledOnce()
  expect(stdin).not.toHaveBeenCalled()
})
