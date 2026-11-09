import { featuresModule } from '@migaia/plugin-host/features'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { namedPipelinesModule } from '@migaia/plugin-host/named-pipelines'
import { asyncPipelineModule } from '@migaia/plugin-host/pipeline-modes/async'

/** Tray fixtures explicitly install their exercised feature graph and native RPC pipelines. */
export const trayNativeTestModules: readonly [
  typeof featuresModule,
  typeof featureDependenciesModule,
  typeof namedPipelinesModule,
  typeof asyncPipelineModule
] = [featuresModule, featureDependenciesModule, namedPipelinesModule, asyncPipelineModule]
