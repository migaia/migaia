import assert from 'node:assert/strict'
import { it } from 'vitest'
import * as pluginHost from '../src/index.js'

/** The fixture facade reads only receipts supplied by the canonical Host integration owner. */
type IFixtureFacade = Readonly<{ read(target: string): number | undefined }>
/** One actual Feature contributes callable business rather than a fabricated Host object. */
type IFixtureContribution = Readonly<{ read(): number }>
/** This narrow shape permits the genuine old path to run before the new export exists. */
type IFixtureSlot = Readonly<{
  facade: IFixtureFacade
  find(target: string): object | null | undefined
  contribute(value: object, instanceId: string): void
}>
/** Only a package-minted original core can supply this integration in the new implementation. */
type IFixtureIntegration = Readonly<{
  acquireSharedSlot(
    key: PropertyKey,
    family: object,
    create: (slot: IFixtureSlot) => IFixtureFacade
  ): IFixtureSlot
  readFeatureOutputs(name: string): Readonly<{
    outputs: Readonly<Record<string, object>>
    assertCurrent(feature: string): void
  }>
}>

for (const kind of ['class', 'frozen'] as const) {
  it(`[A13][A34] genuine ${kind} Host shares one family slot and retires only exact contributions`, async () => {
    /** Both supported public Host entries retain their original mutation/disposal owner. */
    const hostOptions = {
      execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
    }
    /** A real managed Host, never a structural substitute, performs every use and unUse. */
    const host =
      kind === 'class'
        ? new pluginHost.PluginHost(hostOptions)
        : pluginHost.defineHost({ host: hostOptions })
    /** Feature execution is counted independently from the returned facade's metadata. */
    let calls = 0
    /** One same-family token authorizes sharing; equal values alone do not. */
    const family = Object.freeze({})
    /** The baseline publishes its genuine old single-registration extension before the RED. */
    let firstFacade: IFixtureFacade | undefined
    /** Stable contribution ids are fixture data, not native-resource authority. */
    const feature = pluginHost.defineFeature(() => ({
      read: () => {
        calls += 1
        return 42
      }
    }))
    try {
      const [service] = await host.use(
        pluginHost.definePlugin({
          name: 'service',
          features: { data: feature },
          install: () => ({})
        })
      )
      /** Ordinary activated Feature business must succeed before sharing can be credited as RED. */
      const business = (
        service as unknown as { getFeature(name: string): IFixtureContribution }
      ).getFeature('data')
      assert.equal(business.read(), 42)
      assert.equal(calls, 1)
      /** Absence of the new export selects the real old extension path, not an import failure. */
      const integrationFactory = Reflect.get(pluginHost, 'getPluginRuntimeIntegration') as
        | ((core: object) => IFixtureIntegration)
        | undefined
      /** Installation uses either the approved canonical port or the original exclusive extension. */
      const connection = (name: string, instanceId: string) =>
        pluginHost.definePlugin({
          name,
          install(core) {
            if (!integrationFactory) {
              firstFacade ??= Object.freeze({ read: () => business.read() })
              return { runtimeSource: firstFacade }
            }
            const integration = integrationFactory(core)
            const snapshot = integration.readFeatureOutputs('service')
            const output = snapshot.outputs.data as IFixtureContribution
            const slot = integration.acquireSharedSlot('runtimeSource', family, (owner) =>
              Object.freeze({
                read: (target: string) =>
                  (owner.find(target) as IFixtureContribution | undefined)?.read()
              })
            )
            slot.contribute(
              {
                read: () => {
                  snapshot.assertCurrent('data')
                  return output.read()
                }
              },
              instanceId
            )
            firstFacade ??= slot.facade
            return {}
          }
        })
      await host.use(connection('first', 'first-instance'))
      assert.equal(firstFacade!.read('first-instance'), 42)
      assert.equal(
        calls,
        2,
        '[A13] first real Feature dispatch succeeds before the shared-slot RED'
      )
      /** Catch the old canonical collision so only the intended business assertion counts as RED. */
      const secondFailure = await host.use(connection('second', 'second-instance')).then(
        () => undefined,
        (error: unknown) => error
      )
      assert.equal(
        secondFailure,
        undefined,
        '[A13] another same-family registration must join the original committed slot'
      )
      assert.equal(
        Reflect.get(host, 'runtimeSource'),
        firstFacade,
        '[A13] both connections publish one canonical facade'
      )
      assert.equal(firstFacade!.read('second-instance'), 42)
      assert.equal(calls, 3, '[A13] the second exact contribution reaches genuine Feature business')
      assert.throws(() => pluginHost.getPluginRuntimeIntegration({}), {
        code: 'PLUGIN_DEFINITION_INVALID'
      })
      await assert.rejects(
        host.use(
          pluginHost.definePlugin({
            name: 'other-family',
            install(core) {
              pluginHost
                .getPluginRuntimeIntegration(core)
                .acquireSharedSlot('runtimeSource', Object.freeze({}), () => {
                  assert.fail('[A13] another family must not construct a shared facade')
                })
              return {}
            }
          })
        ),
        (error: unknown) => {
          assert.equal((error as { cause?: { code?: string } }).cause?.code, 'EXTENSION_DUPLICATE')
          return true
        }
      )
      await assert.rejects(
        host.use(
          pluginHost.definePlugin({
            name: 'exclusive-conflict',
            install: () => ({ runtimeSource: () => 43 })
          })
        ),
        (error: unknown) => {
          assert.equal((error as { cause?: { code?: string } }).cause?.code, 'EXTENSION_DUPLICATE')
          return true
        }
      )
      assert.equal(
        Reflect.get(host, 'runtimeSource'),
        firstFacade,
        '[A13] rejected owners cannot retire a committed slot'
      )
      await host.unUse('first')
      assert.equal(
        Reflect.get(host, 'runtimeSource'),
        firstFacade,
        '[A34] the first contribution does not own slot destruction'
      )
      assert.equal(firstFacade!.read('first-instance'), undefined)
      assert.equal(firstFacade!.read('second-instance'), 42)
      await host.unUse('second')
      assert.equal(
        Reflect.get(host, 'runtimeSource'),
        undefined,
        '[A34] only the final contribution retires the public slot'
      )
    } finally {
      await host.dispose()
    }
  })
}
