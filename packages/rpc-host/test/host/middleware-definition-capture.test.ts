/** Native cold definitions retain original installation capture, values and per-Host isolation. */
import {
  defineFeature,
  defineHost,
  definePlugin,
  getPluginRuntimeIntegration,
  type IPluginHostCore
} from '@migaia/plugin-host'
import { expect, it } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

/** A genuine native Host supplies the same identity and transaction to its RPC transport. */
function receivingHost(name: string) {
  return defineHost({
    host: {
      identity: { name },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
}

/** The original object middleware registered an owned resource with a no-op release. */
function releaseResource(): void {}

/** These are the original exposed values, constructed by the native Feature owner. */
function nativeMethods() {
  return { nativeMiddleware: () => 'ready' }
}

/** Object-form installation retains its own original method name and return value. */
function objectNativeMethods() {
  return { objectNativeMiddleware: () => 'ready' }
}

/** One actual Host identity selects its original registration-local method output. */
function hostLocalMethods(name: string) {
  return name === 'first-4'
    ? { firstNativeMiddleware: () => 'first' }
    : { secondNativeMiddleware: () => 'second' }
}

/** Native descriptor construction lends the original Host identity to its public exposed methods. */
function hostLocalDescriptor(core: IPluginHostCore) {
  /** Identity is borrowed from this exact real Host rather than shared between registrations. */
  const name = getPluginRuntimeIntegration(core).identity.name
  return { expose: () => hostLocalMethods(name) }
}

// RPC-TEST-FB075BDD690B-C002: BC3 replaces root exposure with the real native Feature handle.
it('publishes dynamic native middleware keys before activation', async () => {
  /** Only the actual per-registration Feature construction increments the original counter. */
  let descriptors = 0
  /** Cold construction invokes no factory or alternate endpoint. */
  const plugin = definePlugin({
    name: 'native-2',
    features: {
      view: defineFeature(() => {
        descriptors += 1
        return nativeMethods()
      })
    },
    install: () => ({})
  })
  /** Genuine transport installation shares the same receiving native Host. */
  const server = coreMemoryServer('native-2')
  /** The actual native transaction owns both definitions and their cleanup. */
  const host = receivingHost('native-2')
  try {
    const [handle] = await host.use(plugin, server.transport)
    expect(descriptors).toBe(1)
    expect(handle.getFeature('view').nativeMiddleware()).toBe('ready')
  } finally {
    await host.dispose()
  }
})

// RPC-TEST-FB075BDD690B-C004: preserve one install and the original exposed business value.
it('normalizes object middleware through the native installation path', async () => {
  /** The original native install callback remains the only counter producer. */
  let installs = 0
  /** Native definitions publish Feature methods without the retired role claim/port language. */
  const plugin = definePlugin({
    name: 'object-native',
    features: { view: defineFeature(objectNativeMethods) },
    install: (core) => {
      installs += 1
      core.onDispose(releaseResource)
      return {}
    }
  })
  /** The same native transaction receives an actual SDK transport. */
  const server = coreMemoryServer('object-native')
  /** This original native Host retains resource ownership throughout disposal. */
  const host = receivingHost('object-native')
  try {
    const [handle] = await host.use(plugin, server.transport)
    expect(installs).toBe(1)
    expect(handle.getFeature('view').objectNativeMiddleware()).toBe('ready')
  } finally {
    await host.dispose()
  }
})

// RPC-TEST-FB075BDD690B-C005: BC3 replaces the deleted transport property with its SDK definition.
it('selects an object middleware transport without a factory transport', async () => {
  /** The listener owns a genuine cold transport rather than a top-level transport option. */
  const server = coreMemoryServer('object-transport')
  /** Ordinary installation publishes the actual namespace on this one native Host. */
  const host = receivingHost('object-transport')
  try {
    await host.use(server.transport)
    expect(Reflect.get(host, 'memory')).toBeDefined()
  } finally {
    await host.dispose()
  }
})

// RPC-TEST-FB075BDD690B-C006: old metadata.claims is retired; the original two counters remain.
it('captures object middleware install and metadata at definition time', async () => {
  /** The captured native callback alone may execute after the caller mutates its source object. */
  let capturedInstalls = 0
  /** This replacement must never enter the admitted native definition. */
  let mutatedInstalls = 0
  /** Canonical native definitions snapshot own data methods at this public boundary. */
  const definition = {
    name: 'object-capture',
    install: () => {
      capturedInstalls += 1
      return {}
    }
  }
  /** Exact definition identity owns its original captured method. */
  const plugin = definePlugin(definition)
  definition.install = () => {
    mutatedInstalls += 1
    return {}
  }
  /** The real transport is installed in the same native batch. */
  const server = coreMemoryServer('object-capture')
  /** Actual Host installation must not reread the caller's mutable definition. */
  const host = receivingHost('object-capture')
  try {
    await host.use(plugin, server.transport)
    expect(capturedInstalls).toBe(1)
    expect(mutatedInstalls).toBe(0)
  } finally {
    await host.dispose()
  }
})

// RPC-TEST-FB075BDD690B-C009: one cold definition constructs distinct outputs on two real Hosts.
it('keeps dynamic native middleware keys isolated across concurrent Hosts', async () => {
  /** The original Host label is read through its genuine authenticated native integration. */
  const plugin = definePlugin('fixture-isolation', hostLocalDescriptor)
  /** Each Host owns one independent real transport installation. */
  const firstServer = coreMemoryServer('first-4')
  /** The second resource shares only the cold definition, never its native runtime state. */
  const secondServer = coreMemoryServer('second-3')
  /** Actual configured identities select the same original fixture branches. */
  const first = receivingHost('first-4')
  /** One independent native transaction owns the second output. */
  const second = receivingHost('second-3')
  try {
    const [[firstHandle], [secondHandle]] = await Promise.all([
      first.use(plugin, firstServer.transport),
      second.use(plugin, secondServer.transport)
    ])
    expect(firstHandle.extensions.firstNativeMiddleware!()).toBe('first')
    expect(secondHandle.extensions.secondNativeMiddleware!()).toBe('second')
  } finally {
    await Promise.all([first.dispose(), second.dispose()])
  }
})

// RPC-TEST-FB075BDD690B-C011: keep one install and cleanup after asynchronous publication starts.
it('keeps the admitted install after post-snapshot mutation', async () => {
  /** Only the original captured hook may increment installation. */
  let installed = 0
  /** Canonical native resource cleanup remains observable independently from installation. */
  let disposed = 0
  /** This exact callback is owned by the original registration. */
  const release = (): void => {
    disposed += 1
  }
  /** Own data methods are captured before a later caller mutation. */
  const definition = {
    name: 'post-snapshot-middleware',
    install: (core: IPluginHostCore) => {
      installed += 1
      core.onDispose(release)
      return {}
    }
  }
  /** The public definition owns the install callback and its native cleanup without a role facade. */
  const plugin = definePlugin(definition)
  /** The actual transport and plugin share one asynchronous native use transaction. */
  const server = coreMemoryServer('post-snapshot-middleware')
  /** This is the only native owner for both installation and cleanup. */
  const host = receivingHost('post-snapshot-middleware')
  /** Capture native admission before mutating the original caller object. */
  const creation = host.use(plugin, server.transport)
  Object.defineProperty(definition, 'install', {
    configurable: true,
    value: () => {
      throw new Error('post-snapshot install mutation escaped')
    }
  })
  try {
    await creation
    expect(installed).toBe(1)
  } finally {
    await host.dispose()
  }
  expect(disposed).toBe(1)
})
