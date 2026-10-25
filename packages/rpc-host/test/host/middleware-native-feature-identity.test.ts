/** Ordinary native Features retain original exposed values, exact identity and owned cleanup. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { expect, it } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

/** One real native transaction owns both the RPC transport and ordinary Feature resources. */
function receivingHost() {
  return defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

/** The original exposed method remains callable through the actual native Feature handle. */
function ownedMethods() {
  return { ownedMiddleware: () => 'ready' }
}

// RPC-TEST-FB075BDD690B-C003: retain the original value and owned resource release count.
it('retains WebRPC owned-resource cleanup for native Middleware', async () => {
  /** Only the genuine native resource callback may record a release. */
  let releases = 0
  /** This same callback is registered once by the original native installation. */
  const release = (): void => {
    releases += 1
  }
  /** The deleted root extension surface is now the public native Feature handle. */
  const middleware = definePlugin({
    name: 'fixture-owned-resource',
    features: { view: defineFeature(ownedMethods) },
    install: (core) => {
      core.onDispose(release)
      return {}
    }
  })
  /** The genuine SDK transport shares this exact native Host and resource transaction. */
  const server = coreMemoryServer('fixture-owned-resource')
  /** No separate RPC plugin-host owns the Feature or its cleanup. */
  const host = receivingHost()
  try {
    const [handle] = await host.use(middleware, server.transport)
    expect(handle.getFeature('view').ownedMiddleware()).toBe('ready')
    await host.dispose()
    await host.dispose()
    expect(releases).toBe(1)
  } finally {
    await host.dispose()
  }
})

// RPC-TEST-FB075BDD690B-C080: preserve the original arbitrary native Feature object identity.
it('generic PluginHost accepts an arbitrary feature outside first-party role schema', async () => {
  /** An ordinary native Feature key has no relationship to the removed RPC role inventory. */
  const arbitraryKey = 'generic-plugin-key'
  /** Returning this original object proves native publication does not reconstruct the value. */
  const arbitraryValue = { marker: 'generic' }
  /** The actual native definition returns the original reference through its public Feature. */
  const generic = definePlugin({
    name: 'generic-key',
    features: { [arbitraryKey]: defineFeature(() => arbitraryValue) },
    install: () => ({})
  })
  /** The original native plugin joins a genuine RPC transport in one ordinary use call. */
  const server = coreMemoryServer('generic-key')
  /** The canonical native Host owns the whole successful transaction. */
  const host = receivingHost()
  try {
    const [, installed] = await host.use(server.transport, generic)
    expect(installed.getFeature(arbitraryKey)).toBe(arbitraryValue)
  } finally {
    await host.dispose()
  }
})

// RPC-TEST-FB075BDD690B-C081: keep exact identity for the original frozen custom Feature value.
it('real inventory admits a non-reserved native plugin with an arbitrary feature', async () => {
  /** The genuine native registry admits this original key without a first-party role alias. */
  const arbitraryKey = 'custom-native-key'
  /** Frozen caller data must remain this exact object, not a clone or reconstructed facade. */
  const arbitraryValue = Object.freeze({ marker: 'custom-native' })
  /** This ordinary cold definition carries the actual native Feature declaration. */
  const custom = definePlugin({
    name: 'custom-native',
    features: { [arbitraryKey]: defineFeature(() => arbitraryValue) },
    install: () => ({})
  })
  /** A real SDK transport is installed in the same original native transaction. */
  const server = coreMemoryServer('custom-native')
  /** No role translator or second registry stands between the public API and the Feature. */
  const host = receivingHost()
  try {
    const [, installed] = await host.use(server.transport, custom)
    expect(installed.getFeature(arbitraryKey)).toBe(arbitraryValue)
  } finally {
    await host.dispose()
  }
})
