/** Owns shared fixture construction; test assertions remain in their focused suites. */
import {
  defineFeature,
  definePlugin,
  PluginHost,
  type IPluginConstraint,
  type IDefinedPluginConstraint,
  type IFeature,
  type IFeatureReference,
  type IPluginConfig
} from '../src/index.ts'

/** Keeps dependency scenarios independent from wall-clock lifecycle deadlines. */
export const execution = {
  mutationTimeoutMs: false as const,
  pipelineDrainTimeoutMs: false as const
}

/** Captures each diagnostic's exact error object alongside its public classification. */
export type IDiagnosticRecord = Readonly<{ message: string; code: unknown; error: unknown }>

/** Creates an isolated host and retains diagnostics in their original reporting order. */
export const createObservedHost = (): {
  host: PluginHost<Record<string, never>>
  seen: IDiagnosticRecord[]
} => {
  /** Ordered diagnostic receipt owned by this host fixture. */
  const seen: IDiagnosticRecord[] = []
  /** Host publishes its diagnostic objects directly into the receipt. */
  const host = new PluginHost<Record<string, never>>({
    execution,
    diagnostic: (message, code, error) => {
      seen.push({ message, code, error })
    }
  })
  return { host, seen }
}

/** Exact Feature produced by the required-provider fixture. */
type IRequiredValueFeature = IFeature<Record<never, never>, { value: number }, Record<never, never>>

/** Exact dependent Feature retains the provider reference's output and literal name. */
type IRequiredUseFeature = IFeature<
  Record<never, never>,
  { value: number },
  {
    readonly value: IFeatureReference<{ value: number }, false, 'A'>
  }
>

/** Named trusted definitions keep declaration emit from exposing their private brand indirectly. */
type IRequiredPair = {
  provider: IDefinedPluginConstraint<
    Record<string, never>,
    never,
    { readA: () => string },
    IPluginConfig,
    Record<string, never>,
    'A',
    { value: IRequiredValueFeature }
  >
  consumer: IDefinedPluginConstraint<
    Record<string, never>,
    never,
    { readB: () => string },
    IPluginConfig,
    Record<string, never>,
    string,
    { use: IRequiredUseFeature }
  >
}

/** Constructs a fresh provider extension object and callable for each admitted installation. */
function installRequiredProvider(): { readA: () => string } {
  return { readA: () => 'A' }
}

/** Constructs a fresh dependent extension object and callable for each admitted installation. */
function installRequiredConsumer(): { readB: () => string } {
  return { readB: () => 'B' }
}

/** Defines a provider and one required dependent with optional lazy admission. */
export const createRequiredPair = (
  options: { lazyProvider?: boolean; consumerName?: string } = {}
): IRequiredPair => {
  /** Provider feature supplies the canonical dependency token. */
  const value = defineFeature(() => ({ value: 1 }))
  /** Provider generation selected by replacement and lazy-activation cases. */
  const provider = definePlugin({
    name: 'A',
    activation: options.lazyProvider ? 'lazy' : 'eager',
    features: { value },
    install: installRequiredProvider
  })
  /** Dependent consumes the exact provider feature rather than a copied definition. */
  const consumer = definePlugin({
    name: options.consumerName ?? 'B',
    features: {
      use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
        value: provider.getFeature('value')
      })
    },
    install: installRequiredConsumer
  })
  return { provider, consumer }
}

/** Exposes the supported constructor-time installation seam to synchronous cases. */
export class SyncHost extends PluginHost<Record<string, never>> {
  /** Runs the synchronous installation path against the current committed registrations. */
  installNow(plugins: readonly IPluginConstraint<any>[]): unknown {
    return this.useSync(plugins)
  }
}
