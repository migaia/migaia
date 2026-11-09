import { featuresModule } from '@migaia/plugin-host/features'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { namedPipelinesModule } from '@migaia/plugin-host/named-pipelines'
import { asyncPipelineModule } from '@migaia/plugin-host/pipeline-modes/async'
import { activationModule } from '@migaia/plugin-host/activation'
import { enablementModule } from '@migaia/plugin-host/enablement'

/**
 * Ordinary native-host SDK fixtures exercise the same required RPC combination inventoried before
 * measurement.
 */
export const rpcNativeTestModules = [
  featuresModule,
  featureDependenciesModule,
  namedPipelinesModule,
  asyncPipelineModule
] as const
/**
 * Activation tests intentionally add the two optional lifecycle capabilities they directly
 * exercise.
 */
export const rpcActivationTestModules = [
  ...rpcNativeTestModules,
  activationModule,
  enablementModule
] as const
