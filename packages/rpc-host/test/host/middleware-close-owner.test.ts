/** Original middleware disposal assertions now exercise the public Host and its real native IO. */
import { expect, it, vi } from 'vitest'
import { defineHost } from '@migaia/plugin-host'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { RpcLifecycleError } from '@migaia/rpc-host/contract'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { defineFlowPlugin, rpcHostPipelines, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from './core-fixture.ts'

/** Install the original identity authentication over the existing physical carrier and JSON codec. */
async function authenticatedConnection(plugins: IRpcHostOptions['plugins'] = []) {
  /** Both actual native endpoints borrow the canonical executing codec, without an adapter. */
  const listener = coreMemoryServer('close-owner-server', 'close-owner-server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The listener is a genuine public Host; its accepted Session owns the remote physical end. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      authFeature({
        encrypt: (value) => value,
        decrypt: (value) => value,
        sign: (value) => value,
        verify: (value) => value
      }),
      listener.transport
    ]
  })
  try {
    /** Completion joins the actual handshake before the disposal assertion can run. */
    const client = await listener.connect('close-owner-client', {
      plugins: [
        authFeature({
          encrypt: (value) => value,
          decrypt: (value) => value,
          sign: (value) => value,
          verify: (value) => value
        }),
        ...plugins
      ]
    })
    return { server, ...client }
  } catch (error) {
    await server.close()
    throw error
  }
}

it('preserves one transport close owner through the canonical factory', async () => {
  /** This is the same native endpoint whose close callback was counted by the original case. */
  const connection = await authenticatedConnection()
  /** Observe the actual original carrier method, never a replacement transport or Host facade. */
  const close = vi.spyOn(connection.pair[1], 'close')
  try {
    /** The first public close publishes its one completion before subsequent callers enter. */
    const firstDispose = connection.host.close()
    expect(connection.host.close()).toBe(firstDispose)
    await firstDispose
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([connection.host.close(), connection.server.close()])
  }
})

it('repeats endpoint disposal without a second transport release', async () => {
  /** Keep this independent original repeated-after-completion path distinct from the first case. */
  const connection = await authenticatedConnection()
  /** Physical release remains owned by the accepted client Session. */
  const close = vi.spyOn(connection.pair[1], 'close')
  try {
    /** Both the pending and already completed public close return the same owner's completion. */
    const firstDispose = connection.host.close()
    expect(connection.host.close()).toBe(firstDispose)
    await firstDispose
    await connection.host.close()
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([connection.host.close(), connection.server.close()])
  }
})

it('native flow result disposer runs once at terminal cleanup', async () => {
  /** The same observable release count belongs to this one real native installation. */
  let disposeCalls = 0
  /** A separate callback keeps the actual cold setup free from a nested lifecycle owner. */
  const dispose = () => {
    disposeCalls += 1
  }
  /** SDK setup returns the canonical native cleanup instead of a legacy Feature/endpoint bridge. */
  const plugin = defineFlowPlugin({
    name: 'native-observation-disposer',
    setup: () => ({ hooks: {}, dispose })
  })
  /** The genuine native core installs this flow before opening its real transport. */
  const connection = await authenticatedConnection([plugin])
  try {
    /** Preserve the original completion identity assertions on both sides of actual cleanup. */
    const closing = connection.host.close()
    expect(connection.host.close()).toBe(closing)
    await closing
    expect(disposeCalls).toBe(1)
    expect(connection.host.close()).toBe(closing)
  } finally {
    await Promise.all([connection.host.close(), connection.server.close()])
  }
})

/** One complete flow instance owns its actual setup and original native resource cleanup. */
function observedCleanupFlow(name: string, installed: () => void, dispose: () => void) {
  return defineFlowPlugin({
    name,
    setup: () => {
      installed()
      return { hooks: {}, dispose }
    }
  })
}

/** Preserve the original bounded identity search over real cause, aggregate and cleanup edges. */
function containsCleanupIdentity(failure: unknown, expected: unknown): boolean {
  /** Only original diagnostic edges can make a cleanup error reachable. */
  const pending = [failure]
  /** Shared or cyclic original diagnostic data is visited once. */
  const visited = new Set<unknown>()
  while (pending.length > 0) {
    /** This actual node may be the original native error itself. */
    const current = pending.pop()
    if (current === expected) return true
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) continue
    if (visited.has(current)) continue
    visited.add(current)
    /** These are the exact diagnostic edges admitted by the original C117 identity matcher. */
    const value = current as {
      readonly cause?: unknown
      readonly errors?: readonly unknown[]
      readonly cleanupErrors?: readonly { readonly error: unknown }[]
      readonly detail?: { readonly rollbackErrors?: readonly unknown[] }
    }
    if (value.cause !== undefined) pending.push(value.cause)
    if (value.errors) pending.push(...value.errors)
    if (value.cleanupErrors) pending.push(...value.cleanupErrors.map(({ error }) => error))
    if (value.detail?.rollbackErrors) pending.push(...value.detail.rollbackErrors)
  }
  return false
}

// C117: retires the native disposal translator, retaining both actual owned cleanup leaves.
it('C117 preserves both owned flow cleanup failures on the native disposal boundary', async () => {
  /** The original role label now identifies fixture errors, without recreating an RPC role. */
  const role = 'hooks'
  /** The later original cleanup remains the first released native failure. */
  const primary = new Error(`${role}-endpoint-primary`)
  /** The first owned callback supplies the other original cleanup identity. */
  const nativeCleanup = new Error(`${role}-native-cleanup`)
  /** Only the original two actual cleanup callbacks append their release observations. */
  const releases: string[] = []
  /** Count the first genuine complete flow setup rather than an old projected installation object. */
  let nativeInstallCalls = 0
  /** The second complete flow independently owns its genuine setup and cleanup. */
  let consumerInstallCalls = 0
  /** Both complete flow instances join the same ordinary native transaction as the actual transport. */
  const native = observedCleanupFlow(
    `middleware:${role}`,
    () => {
      nativeInstallCalls += 1
    },
    () => {
      releases.push('native')
      throw nativeCleanup
    }
  )
  /** Actual registration order determines the original consumer-first release order. */
  const consumer = observedCleanupFlow(
    `consumer-1:${role}`,
    () => {
      consumerInstallCalls += 1
    },
    () => {
      releases.push('consumer')
      throw primary
    }
  )
  /** The existing listener is the only real native carrier source; no peer or ACK is invented. */
  const server = coreMemoryServer('t89-hooks')
  /** The same native owner lends genuine execution authority for the listener's memory namespace. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** C0 endpoint.dispose delegated to this native boundary before its retired RPC translator. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  await host.use(native, consumer, server.transport)
  try {
    expect(nativeInstallCalls).toBe(1)
    expect(consumerInstallCalls).toBe(1)
    /** The native owner publishes its one completion before either owned cleanup executes. */
    const dispose = host.dispose()
    expect(host.dispose()).toBe(dispose)
    /** The native result keeps its actual cleanup graph without an RPC translation shell. */
    const result = await dispose
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupErrors).toHaveLength(2)
    expect(containsCleanupIdentity(result.cleanupErrors[0], primary)).toBe(true)
    expect(containsCleanupIdentity(result.cleanupErrors[1], nativeCleanup)).toBe(true)
    expect(releases).toEqual(['consumer', 'native'])
    expect(releases.filter((entry) => entry === 'consumer')).toHaveLength(1)
    expect(releases.filter((entry) => entry === 'native')).toHaveLength(1)
    expect(host.dispose()).toBe(dispose)
  } finally {
    await host.dispose()
  }
})

// Retires only the native disposal translation shell.
it('C003 retains a lifecycle diagnostic beside an independent native cleanup failure', async () => {
  /** This public diagnostic is one original leaf, never proof of the whole cleanup transaction. */
  const diagnostic = new RpcLifecycleError('application resource closed')
  /** Native cleanup must retain the diagnostic's original semantic identity as well as its class. */
  const identity = { source: diagnostic.source, code: diagnostic.code }
  /** A different acquired resource owns this independent original failure. */
  const original = new Error('other resource cleanup failed')
  /** The original two release labels expose exact LIFO order and exclude duplicate execution. */
  const released: string[] = []
  /** This first acquired flow gives native disposal its own original cleanup callback. */
  const first = observedCleanupFlow(
    'audit-cleanup-first',
    () => undefined,
    () => {
      released.push('first')
      throw original
    }
  )
  /** The later callback throws the typed diagnostic before the earlier resource must still run. */
  const second = observedCleanupFlow(
    'audit-cleanup-second',
    () => undefined,
    () => {
      released.push('second')
      throw diagnostic
    }
  )
  /** The existing native listener supplies the same genuine namespace and transport owner. */
  const server = coreMemoryServer('audit-typed-cleanup')
  /** All original cleanup callbacks share one native Host and its real named pipeline groups. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** No public RPC Root.close translates or substitutes this original native disposal boundary. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  await host.use(first, second, server.transport)
  try {
    /** The actual native result must keep both leaves, even when one is already a lifecycle error. */
    const result = await host.dispose()
    expect(released).toEqual(['second', 'first'])
    expect(result.cleanupErrors).toHaveLength(2)
    expect(containsCleanupIdentity(result.cleanupErrors[0], diagnostic)).toBe(true)
    expect(containsCleanupIdentity(result.cleanupErrors[1], original)).toBe(true)
    /** Each ordered native entry belongs only to its original failing callback. */
    expect(containsCleanupIdentity(result.cleanupErrors[0], original)).toBe(false)
    expect(containsCleanupIdentity(result.cleanupErrors[1], diagnostic)).toBe(false)
    expect(diagnostic).toBeInstanceOf(RpcLifecycleError)
    expect(diagnostic).toMatchObject(identity)
  } finally {
    await host.dispose()
  }
})

// Native disposal retains once and shared completion semantics.
it('C001 publishes native disposal settlement before synchronous cleanup reentry', async () => {
  /** The existing listener joins the same genuine native Host as the original cleanup callback. */
  const server = coreMemoryServer('audit-native-disposal-reentry')
  /** Declaration and execution authority come from this one actual native owner. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** Native disposal remains the tested boundary; no binding facade or RPC Root.close is used. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Only the actual owned disposer increments the original release count. */
  let calls = 0
  /** Synchronous reentry must borrow the same completion already published by native disposal. */
  let nested: ReturnType<typeof host.dispose> | undefined
  /** The real flow installation gives native disposal its one original asynchronous callback. */
  const flow = observedCleanupFlow(
    'audit-native-disposal-reentry-flow',
    () => undefined,
    () => {
      calls++
      if (calls === 1) nested = host.dispose()
      return Promise.resolve()
    }
  )
  await host.use(flow, server.transport)
  try {
    /** The callback reenters directly; no delay or awaiting its own nested completion is added. */
    const closing = host.dispose()
    await closing
    expect(calls).toBe(1)
    expect(nested).toBe(closing)
    expect(host.dispose()).toBe(closing)
  } finally {
    await host.dispose()
  }
})
