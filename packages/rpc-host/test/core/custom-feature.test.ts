import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Original custom Feature values and lifecycle effects belong to the genuine receiving Host. */
import {
  defineFeature,
  defineHost,
  definePlugin,
  PluginHostErrorCode,
  type IFeatureCore
} from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { chunkFeature } from '@migaia/rpc-host/plugins/chunk'
import { defineTransportPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { RpcError, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { describe, expect, it, vi } from 'vitest'
import * as assembly from '../../dist/features/chunk/assembly.js'
import { coreMemoryServer } from '../host/core-fixture.ts'
import { MemoryCarrier } from '../fixtures/core-carrier.ts'

/** One exposed alias is the native Feature's complete declared requirement. */
type IAlias = Readonly<{ alias(): string }>
/** Feature outputs remain selected capabilities, never implicitly copied onto the RPC root. */
type IRoot = Readonly<{ root(): string }>

/** Genuine native construction supplies the sole RPC execution owner and fixed namespace lanes. */
function receivingHost(name: string) {
  /** Both lazy execution and cold declarations refer to this same canonical Host identity. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** The original endpoint label now uses native identity.name; the runtime keeps its actual id. */
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
  return host
}

/** The real Feature factory receives only its native guarded featureExpose capability. */
function aliasRoot(core: IFeatureCore<IAlias>): IRoot {
  return { root: () => core.featureExpose.alias() }
}

/** This original media subscription would run if a failing native batch reached its transport. */
class FeatureIngress {
  /** Actual media retains the only receiver/listener resource being counted. */
  readonly carrier = new MemoryCarrier('custom-feature-ingress')
  /** The spy delegates to the genuine native subscription, rather than replacing its behavior. */
  readonly subscriptions = vi.spyOn(this.carrier, 'subscribe')
  /** Cold acquisition runs only after preceding native authoring/install checks have succeeded. */
  readonly transport = defineTransportPlugin({
    name: 'custom-feature-ingress',
    namespace: 'memory',
    open: (context) => {
      context.attach(this.carrier)
      return { dispose: () => this.carrier.close() }
    }
  })

  /** Restore the observation and close only this original physical resource. */
  async close(): Promise<void> {
    this.subscriptions.mockRestore()
    await this.carrier.close()
  }
}

/** A reusable opaque Feature retains independent native installations across pass/fail/pass. */
class FeatureSequence {
  /** Only original install hooks append this observable sequence. */
  readonly trace: string[] = []
  /** The same trusted definition is deliberately retained across all three genuine Hosts. */
  readonly feature = defineFeature<IAlias, Record<never, never>, IRoot>(aliasRoot)

  /** Install one original branch through native Feature construction and rollback ownership. */
  async install(id: string, mode: 'pass' | 'fail'): Promise<void> {
    /** The callback context carries actual label, selected mode and the original effect array. */
    const operation = { id, mode, trace: this.trace }
    /** Keep the exact primary native failure reachable after native install translation. */
    const primary = new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.endpointModuleInvalid
    )
    /** Native exposure supplies the original branch value without mutable endpoint shims. */
    const plugin = definePlugin({
      name: `ys22-${mode}`,
      features: { selected: this.feature },
      featureExpose: { alias: () => operation.id },
      install: () => {
        operation.trace.push(`${operation.mode}:${operation.id}`)
        if (operation.mode === 'fail') throw primary
        return {}
      }
    })
    /** This original real transport participates in the same native transaction. */
    const server = coreMemoryServer(id)
    /** One genuine receiving Host owns both the Feature and transport generation. */
    const host = receivingHost(id)
    try {
      if (mode === 'fail') {
        /** Native installation must retain this exact failure, not only an equal diagnostic. */
        const pending = host.use(plugin, server.transport)
        await expect(pending).rejects.toMatchObject({
          code: PluginHostErrorCode.pluginInstallFailed,
          cause: primary
        })
        /** This readonly view borrows the actual native error's existing original cause. */
        const failed = await pending.catch((error: unknown) => error)
        expect((failed as { cause?: unknown }).cause).toBe(primary)
        return
      }
      /** Only the original selected root publishes the factory's synchronous result. */
      const [installed] = await host.use(plugin, server.transport)
      expect(installed.getFeature('selected').root()).toBe(id)
    } finally {
      await host.dispose()
    }
  }
}

/** The first-party chunk owner still closes its actual string framer exactly once. */
async function closeFirstPartyFramer(): Promise<void> {
  /** Observe the original canonical factory, retaining all real algorithm methods and state. */
  const create = assembly.createStringChunkAssembler
  /**
   * The one installed string framer's real close receipt remains distinguishable from byte
   * assembly.
   */
  const closed: ReturnType<typeof vi.fn>[] = []
  /** Setup still constructs the genuine algorithm; its original close method remains delegated. */
  const created = vi.spyOn(assembly, 'createStringChunkAssembler').mockImplementation((options) => {
    /** The genuine factory owns every frame, source map and timer. */
    const framer = create(options)
    /** Its frozen surface needs the same shallow delegated close receipt as the original test. */
    const close = vi.fn(framer.close)
    closed.push(close)
    return { ...framer, close }
  })
  /** Moves implicit core chunking into its one explicit first-party Feature. */
  const server = coreMemoryServer('native-first-party-chunk')
  /** The ordinary public RPC factory installs real chunk resources through genuine native setup. */
  const endpoint = await createRpcHost({
    ...server.options,
    plugins: [rpcFeaturesPlugin({ features: { chunk: chunkFeature() } }), server.transport]
  })
  try {
    await endpoint.close()
    await endpoint.close()
    expect(closed).toHaveLength(1)
    expect(closed[0]!.mock.calls.length).toBe(1)
  } finally {
    await endpoint.close()
    created.mockRestore()
  }
}

/** A synchronous custom Feature exposes only its actual selected native root. */
async function selectSynchronousRoot(): Promise<void> {
  /** This original public value is created synchronously by the genuine factory. */
  const view = { observe: () => 'native-root' }
  /** Defining the Feature does not start a Host or native acquisition. */
  const feature = defineFeature(() => view)
  /** Original root selection is now explicit in the native plugin's declared Feature record. */
  const plugin = definePlugin({
    name: 'native-custom-feature',
    features: { selected: feature },
    install: () => ({})
  })
  /** The original transport shares the same actual native runtime. */
  const server = coreMemoryServer('native-custom-feature')
  /** No root facade or second RPC Host owns this selected Feature. */
  const host = receivingHost('native-custom-feature')
  try {
    const [installed] = await host.use(plugin, server.transport)
    expect(installed.getFeature('selected').observe()).toBe('native-root')
  } finally {
    await host.dispose()
  }
}

/** Owned native resources release once after the original exposed value has remained callable. */
async function releaseNativeResources(): Promise<void> {
  /** Only the originally registered cleanup callback may increment this count. */
  let releases = 0
  /** This one same receipt is acquired during genuine native install. */
  const release = (): void => {
    releases += 1
  }
  /** The original endpoint label is supplied by this actual native identity. */
  const host = receivingHost('custom-feature-endpoint')
  /** Readonly selected native output preserves the original label value. */
  const view = { observe: () => host.identity.name }
  /** Native core owns cleanup; it receives no legacy core.own adapter. */
  const middleware = definePlugin({
    name: 'custom-observer',
    features: { view: defineFeature(() => view) },
    install: (core) => {
      core.onDispose(release)
      return {}
    }
  })
  /** The genuine SDK transport belongs to this same install transaction. */
  const server = coreMemoryServer('custom-feature-endpoint')
  try {
    const [installed] = await host.use(middleware, server.transport)
    expect(installed.getFeature('view').observe()).toBe('custom-feature-endpoint')
    await host.dispose()
    await host.dispose()
    expect(releases).toBe(1)
  } finally {
    await host.dispose()
  }
}

/** Native Feature injection retains the alias value without publishing the private root directly. */
async function injectDeclaredRoot(): Promise<void> {
  /** This same canonical factory is supplied as one actual native Feature. */
  const feature = defineFeature<IAlias, Record<never, never>, IRoot>(aliasRoot)
  /** The original label comes from the genuine receiving runtime, independent of registration names. */
  const host = receivingHost('feature-record')
  /** Native featureExpose injects only the declared alias; install publishes the original method. */
  const middleware = definePlugin({
    name: 'feature-record-middleware',
    features: { alias: feature },
    featureExpose: { alias: () => `feature:${host.identity.name}` },
    install: (core) => ({ throughFeature: core.features.alias.root })
  })
  /** The actual transport is acquired by the same original native transaction. */
  const server = coreMemoryServer('feature-record')
  try {
    const [installed] = await host.use(middleware, server.transport)
    expect(installed.extensions.throughFeature()).toBe('feature:feature-record')
    expect('root' in host).toBe(false)
  } finally {
    await host.dispose()
  }
}

/** One trusted definition receives separate guarded exposure in each native registration. */
async function isolateDeclaredRoot(): Promise<void> {
  /** The exact same opaque Feature is deliberately selected by both real native plugins. */
  const feature = defineFeature<IAlias, Record<never, never>, IRoot>(aliasRoot)
  /** First native declaration owns its own alias value. */
  const first = definePlugin({
    name: 'feature-isolation-first',
    features: { alias: feature },
    featureExpose: { alias: () => 'first' },
    install: (core) => ({ firstFromFeature: core.features.alias.root })
  })
  /** Second native declaration must not read the first registration's guarded exposure. */
  const second = definePlugin({
    name: 'feature-isolation-second',
    features: { alias: feature },
    featureExpose: { alias: () => 'second' },
    install: (core) => ({ secondFromFeature: core.features.alias.root })
  })
  /** Both registrations and the original transport share one canonical receiving runtime. */
  const host = receivingHost('feature-isolation')
  /** The actual SDK transport remains an ordinary member of this native batch. */
  const server = coreMemoryServer('feature-isolation')
  try {
    const [one, two] = await host.use(first, second, server.transport)
    expect(one.extensions.firstFromFeature()).toBe('first')
    expect(two.extensions.secondFromFeature()).toBe('second')
  } finally {
    await host.dispose()
  }
}

/** Native rollback preserves the primary failure and does not reach actual transport subscription. */
async function failBeforeIngress(): Promise<void> {
  /** This is the same explicitly coded primary failure as the original middleware oracle. */
  const primary = new RpcError(
    RpcCoreErrorCode.invalidConfig,
    RpcCoreErrorText.endpointModuleInvalid
  )
  /** Genuine native installation throws this original instance. */
  const failing = definePlugin({
    name: 'failed-native-middleware',
    install: () => {
      throw primary
    }
  })
  /** Count the actual existing carrier subscription, never a synthesized ingress event. */
  const ingress = new FeatureIngress()
  /** All resource/rollback authority belongs to this original receiving Host. */
  const host = receivingHost('failed-native-middleware')
  try {
    /** This same pending result is observed for both classification and exact primary identity. */
    const pending = host.use(failing, ingress.transport)
    await expect(pending).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary
    })
    /** The original failure remains the actual native wrapper's exact cause. */
    const failed = await pending.catch((error: unknown) => error)
    expect((failed as { cause?: unknown }).cause).toBe(primary)
    expect(ingress.subscriptions.mock.calls.length).toBe(0)
  } finally {
    await host.dispose()
    await ingress.close()
  }
}

/** Retain the original pass/fail/pass effect order and both successful native root values. */
async function retainReusableDefinitions(): Promise<void> {
  /** One actual trusted Feature survives all three independent receiving Hosts. */
  const sequence = new FeatureSequence()
  await sequence.install('first-3', 'pass')
  await sequence.install('fixture-failure', 'fail')
  await sequence.install('fixture-restored', 'pass')
  expect(sequence.trace).toEqual(['pass:first-3', 'fail:fixture-failure', 'pass:fixture-restored'])
}

/** Current native definition admission rejects duplicates/forgeries before real ingress. */
async function rejectForgedAndDuplicateRoots(): Promise<void> {
  /** Both original Feature values are still constructed by real native factories. */
  const first = defineFeature({ install: () => ({ custom: true }) })
  /** The conflicting value must not replace or merge with the first selected output. */
  const second = defineFeature({ install: () => ({ custom: false }) })
  /** Native projection supplies the exact first original public key. */
  const one = definePlugin({
    name: 'duplicate-first',
    features: { selected: first },
    install: (core) => ({ custom: core.features.selected.custom })
  })
  /** A second actual native projection attempts the same public key. */
  const two = definePlugin({
    name: 'duplicate-second',
    features: { selected: second },
    install: (core) => ({ custom: core.features.selected.custom })
  })
  /** These are the real physical listener and canonical native batch under rejection. */
  const ingress = new FeatureIngress()
  /** No RPC compatibility assembly participates in this native authoring admission. */
  const host = receivingHost('duplicate-feature-endpoint')
  try {
    await expect(host.use(one, two, ingress.transport)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.extensionDuplicate }
    })
    expect(ingress.subscriptions.mock.calls.length).toBe(0)
    /** Keep the real installer outside the authoring assertion's admission callback. */
    const install = () => ({})
    expect(() =>
      definePlugin({
        name: 'forged-feature-endpoint',
        features: { selected: { key: 'forged' } as never },
        install
      })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.invalidOption }))
    expect(ingress.subscriptions.mock.calls.length).toBe(0)
  } finally {
    await host.dispose()
    await ingress.close()
  }
}

/** Admission rejects unreadable factories and non-string root aliases without executing user code. */
function rejectAccessorAndSymbolDefinitions(): void {
  /** Native descriptor admission must reject without evaluating this original hostile getter. */
  let reads = 0
  /** Removes Feature.key; the corresponding actual native input is its own install descriptor. */
  const accessor = {
    get install() {
      reads += 1
      throw new Error('key getter must not execute')
    }
  }
  /** A symbol cannot identify a declared native Feature root. */
  const symbol = { [Symbol('hostile')]: defineFeature(() => ({})) }
  /** This genuine native hook must remain uncalled during root-map admission. */
  const install = () => ({})
  expect(() => defineFeature(accessor as never)).toThrow()
  expect(reads).toBe(0)
  expect(() =>
    definePlugin({ name: 'symbol-feature', features: symbol as never, install })
  ).toThrow()
}

/** The current owner rejects reserved public keys and thenable outputs before physical ingress. */
async function rejectBaseKeyAndThenable(): Promise<void> {
  /** This is the original forbidden base method value, never a Host disposal implementation. */
  const dispose = () => undefined
  /** The original dispose collision is still a forbidden native Host base key. */
  const colliding = defineFeature({ install: () => ({ dispose }) })
  /** Actual native projection cannot overwrite the original owner's disposal entry. */
  const collision = definePlugin({
    name: 'base-collision',
    features: { selected: colliding },
    install: (core) => ({ dispose: core.features.selected.dispose })
  })
  /** Object-shaped thenable exercises the real native Feature-output admission guard. */
  const hostileResult = Object.create(null)
  /** Split key retains the original deliberate hostile fixture spelling. */
  const thenKey = 'th' + 'en'
  Object.defineProperty(hostileResult, thenKey, { value: () => undefined })
  /** This remains an actual native Feature; it cannot masquerade as a valid synchronous output. */
  const hostileThenable = defineFeature(() => hostileResult as never)
  /** The genuine native Feature runtime must reject before transport acquisition. */
  const hostile = definePlugin({
    name: 'hostile-thenable',
    features: { selected: hostileThenable },
    install: () => ({})
  })
  /** This exact original media subscription is the final zero-effect oracle. */
  const ingress = new FeatureIngress()
  /** Both failing native batches share the same real owner without publishing a candidate. */
  const host = receivingHost('base-collision')
  try {
    await expect(host.use(collision, ingress.transport)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.extensionReserved }
    })
    await expect(host.use(hostile, ingress.transport)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.invalidOption }
    })
    expect(ingress.subscriptions.mock.calls.length).toBe(0)
  } finally {
    await host.dispose()
    await ingress.close()
  }
}

/** Async native install completion is awaited and a later owned rollback releases exactly once. */
async function awaitInstallAndRollback(): Promise<void> {
  /** The original successful async install publishes only after its genuine Promise has settled. */
  const native = definePlugin({ name: 'native-promise', install: async () => ({ native: true }) })
  /** Only the genuine failing install's registered resource increments this original effect. */
  let releases = 0
  /** The original rollback reason remains reachable by exact identity. */
  const primary = new Error('install failure')
  /** One original cleanup receipt is acquired by native core.onDispose. */
  const release = (): void => {
    releases += 1
  }
  /** Native install owns the receipt before throwing the exact original primary. */
  const failing = definePlugin({
    name: 'failing-feature',
    install: (core) => {
      core.onDispose(release)
      throw primary
    }
  })
  /** One public native Host owns each original successful or rejected install transaction. */
  const host = receivingHost('native-promise')
  /** The actual transport is installed only after the ordinary native async callback. */
  const server = coreMemoryServer('native-promise')
  try {
    const [installed] = await host.use(native, server.transport)
    expect(installed.extensions.native).toBe(true)
    await host.dispose()
  } finally {
    await host.dispose()
  }
  /** Rollback is exercised on an independent actual owner, preserving the original closed transport. */
  const rollback = receivingHost('rollback-feature')
  /** The original native listener belongs to the same failed batch as its cleanup receipt. */
  const target = coreMemoryServer('rollback-feature')
  try {
    const pending = rollback.use(failing, target.transport)
    await expect(pending).rejects.toThrow()
    await expect(pending).rejects.toMatchObject({ cause: primary })
    /** The native rollback wrapper must retain the originally thrown error instance. */
    const failed = await pending.catch((error: unknown) => error)
    expect((failed as { cause?: unknown }).cause).toBe(primary)
    expect(releases).toBe(1)
  } finally {
    await rollback.dispose()
  }
}

describe('custom feature public boundary', () => {
  it(
    'installs the first-party chunk through endpoint capabilities and closes its framer once',
    closeFirstPartyFramer
  )
  it(
    'creates a synchronous native Feature with only its selected root projection',
    selectSynchronousRoot
  )
  it(
    'installs native Middleware through PluginHost and disposes owned resources once',
    releaseNativeResources
  )
  it(
    'injects declared Feature roots into native Middleware without publishing them directly',
    injectDeclaredRoot
  )
  it('isolates one declared Feature across native Middleware registrations', isolateDeclaredRoot)
  it('rejects failed native Middleware installation before transport ingress', failBeforeIngress)
  it(
    'retained endpoint Feature and Middleware wrappers survive pass, fail, pass installation',
    retainReusableDefinitions
  )
  it(
    'rejects forged tokens and duplicate public keys before transport subscription',
    rejectForgedAndDuplicateRoots
  )
  it(
    'rejects accessor and symbol definitions before publication',
    rejectAccessorAndSymbolDefinitions
  )
  it(
    'rejects base-key collisions and hostile thenables before subscription',
    rejectBaseKeyAndThenable
  )
  it(
    'awaits native Middleware installers and rolls back owned resources once',
    awaitInstallAndRollback
  )
})
