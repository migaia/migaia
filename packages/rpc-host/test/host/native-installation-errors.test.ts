/** Original native entropy and installation callback failures retain their public RPC identities. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'

// RPC-TEST-49A21590A74A-C004-A001: original native entropy cause remains a real public producer.
it('retains the original native entropy failure before cold transport acquisition', async () => {
  /** The same native exception must remain the configuration diagnostic's exact original cause. */
  const original = new Error('native entropy unavailable')
  /** Only a real native installation could invoke this original cold acquisition method. */
  const open = vi.fn(() => ({ dispose: () => undefined }))
  /** A genuine SDK transport is declared without eagerly constructing a carrier or source. */
  const transport = defineTransportPlugin({
    name: 'native-entropy-source',
    namespace: 'entropy',
    open
  })
  /** The original supported native operation alone fails; no UUID callback facade is restored. */
  const entropy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
    throw original
  })
  /** A regression that incorrectly constructs a public Host must still release its own resources. */
  let host: { close(): Promise<void> } | undefined
  /** Both synchronous construction and asynchronous native installation use the actual entry. */
  let failure: unknown
  try {
    try {
      host = await createRpcHost({
        self: { name: 'local', instanceId: 'local' },
        plugins: [transport],
        report: () => undefined
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG',
      cause: original
    })
    expect((failure as Error).cause).toBe(original)
    /** Current mandatory entropy precedes acquisition; zero open is not old close-one PASS. */
    expect(open).not.toHaveBeenCalled()
  } finally {
    entropy.mockRestore()
    await host?.close()
  }
})

// RPC-TEST-00776736DCA7-C004: a real public setup callback still preserves original identity and code.
it('classifies the original native flow setup failure without replacing its Error', async () => {
  /** This is the unchanged original user callback error and its native stack. */
  const original = new Error('audit installation failed')
  /** Primary installation rejection must not also become a late background diagnostic. */
  const reports: unknown[] = []
  /** Current SDK setup is the surviving public producer; no old middleware install role is faked. */
  const flow = defineFlowPlugin({
    name: 'audit-install',
    setup() {
      throw original
    }
  })
  /** Actual cold source installation must follow the failed native flow-prefix transaction. */
  const open = vi.fn(() => ({ dispose: () => undefined }))
  /** Real transport metadata keeps the public construction premise valid without native IO. */
  const transport = defineTransportPlugin({
    name: 'native-installation-source',
    namespace: 'installation',
    open
  })
  /** Only the genuine public root owns its native installation and failed-construction rollback. */
  let host: { close(): Promise<void> } | undefined
  /** Inspect the public rejection itself rather than translating a NativeHost.install error. */
  let failure: unknown
  try {
    try {
      host = await createRpcHost({
        self: { name: 'audit-install', instanceId: 'audit-install' },
        plugins: [flow, transport],
        report: (error) => reports.push(error)
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBe(original)
    expect(original).toMatchObject({ source: 'rpc.endpoint', code: 'CALLBACK_FAILED' })
    expect(open).not.toHaveBeenCalled()
    expect(reports).toHaveLength(0)
  } finally {
    await host?.close()
  }
})

it('retains the default nodeId native randomUUID failure before cold acquisition', async () => {
  /** The current mandatory nodeId producer must preserve this exact native entropy failure. */
  const original = new Error('native nodeId entropy unavailable')
  /** Actual source acquisition must remain cold when default identity construction fails. */
  const open = vi.fn(() => ({ dispose: () => undefined }))
  /** Valid SDK metadata reaches the real public constructor without a resource facade. */
  const transport = defineTransportPlugin({
    name: 'native-nodeid-source',
    namespace: 'identity',
    open
  })
  /** Fail only the native method actually selected by defaultRpcId; no fallback is injected. */
  const entropy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    throw original
  })
  /** Unexpected successful construction still retains its real public cleanup owner. */
  let host: { close(): Promise<void> } | undefined
  /** Capture the public native failure without tagging or translating it in the fixture. */
  let failure: unknown
  try {
    try {
      host = await createRpcHost({
        self: { name: 'local', instanceId: 'local' },
        plugins: [transport],
        report: () => undefined
      })
    } catch (error) {
      failure = error
    }
    expect.soft(failure).toMatchObject({
      source: 'rpc.endpoint',
      code: 'INVALID_CONFIG',
      cause: original
    })
    expect.soft((failure as Error | undefined)?.cause).toBe(original)
    /** Zero real acquisition is a current fact, never credit for the deleted close-one oracle. */
    expect(open).not.toHaveBeenCalled()
  } finally {
    entropy.mockRestore()
    await host?.close()
  }
})
