import { featuresModule } from '../src/modules/features/index.ts'
import { featureDependenciesModule } from '../src/modules/feature-dependencies/index.ts'
import { enablementModule } from '../src/modules/enablement/index.ts'
import { activationModule } from '../src/modules/activation/index.ts'
import { namedPipelinesModule } from '../src/modules/named-pipelines/index.ts'
import { syncPipelineModule } from '../src/modules/pipeline-modes/sync.ts'
import { asyncPipelineModule } from '../src/modules/pipeline-modes/async.ts'
import { generatorPipelineModule } from '../src/modules/pipeline-modes/generator.ts'
import { asyncGeneratorPipelineModule } from '../src/modules/pipeline-modes/async-generator.ts'

/** Full-capability behavior baselines explicitly install the abilities they exercise. */
export const nativeModules: readonly [
  typeof featuresModule,
  typeof featureDependenciesModule,
  typeof enablementModule,
  typeof activationModule,
  typeof namedPipelinesModule,
  typeof syncPipelineModule,
  typeof asyncPipelineModule,
  typeof generatorPipelineModule,
  typeof asyncGeneratorPipelineModule
] = [
  featuresModule,
  featureDependenciesModule,
  enablementModule,
  activationModule,
  namedPipelinesModule,
  syncPipelineModule,
  asyncPipelineModule,
  generatorPipelineModule,
  asyncGeneratorPipelineModule
] as const
