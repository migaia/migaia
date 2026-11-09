import { definePlugin, PluginHost, type IFeature } from '@migaia/plugin-host'
import { featuresModule } from '@migaia/plugin-host/features'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { onTestFinished } from 'vitest'

/** Construct the tested output through genuine native admission and retain its Host for the test. */
export async function nativeFeatureOutput<TOutput extends object>(
  feature: IFeature<Record<never, never>, TOutput, any>
): Promise<TOutput> {
  /** The fixture owns only native definition/output lifetime; business resources retain disposers. */
  const host = new PluginHost<Record<never, never>>({
    modules: [featuresModule, featureDependenciesModule]
  })
  /** Native feature construction supplies exactly the caller's opaque identity under a local alias. */
  const plugin = definePlugin({
    name: 'native-feature-fixture',
    features: { execution: feature },
    install(core) {
      return { execution: core.features.execution }
    }
  })
  /** The real handle publishes the same output consumed by production plugin installations. */
  const [handle] = await host.use(plugin)
  onTestFinished(async () => {
    await host.dispose()
  })
  return handle.extensions.execution
}
