import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostFeatureOperations } from '../features/feature-operations.ts'
import { PluginHostReplaceRuntime } from '../features/replace-runtime.ts'
import { PluginHostResumeRuntime } from '../features/resume-runtime.ts'

import { toIndexNode } from '../features/dependency-runtime.ts'

import { createTopologyIndex } from '@migaia/capability/graph/topology'
import { planTeardown } from '@migaia/capability/graph/dependency'
import ERROR_TEXT from '../../error-text.ts'
import { PluginHostError } from '../../errors.ts'
import { PluginHostErrorCode } from '../../error-code.ts'
/** Feature installation lends its actual planners to the canonical core state and lifecycle. */
export const featureDependenciesModule: IHostModule<typeof HostModuleKey.featureDependencies> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.featureDependencies,
    requires: [HostModuleKey.features],
    install(context, port) {
      /** One feature operation owner supplies every dependency-aware host mutation. */
      const operations = new PluginHostFeatureOperations(context, port)
      context.featureOperations = operations
      context.validateInstallBatch = (entries, inactive, roots) =>
        operations.validateBatch(entries, inactive, roots)
      context.state.configureDependencyIndex(
        createTopologyIndex({
          onCycle: () => {
            throw new PluginHostError(
              PluginHostErrorCode.dependencyCycle,
              ERROR_TEXT.DEPENDENCY_CYCLE
            )
          },
          onInvalid: () => {
            throw new PluginHostError(
              PluginHostErrorCode.pluginDefinitionInvalid,
              ERROR_TEXT.PLUGIN_DEFINITION_INVALID
            )
          }
        }),
        toIndexNode
      )
      context.replaceRuntime = new PluginHostReplaceRuntime(port)
      context.resumeRuntime = new PluginHostResumeRuntime(port)
      context.teardownOrder = () => dependencyTeardown(context.state)
    }
  })
/** Capability computes dependency order while the core registry remains the only registration owner. */
function dependencyTeardown(state: import('../../host-state.ts').PluginHostState<any, any>) {
  return planTeardown(state.dependencyIndex()).order.map((name) => state.registrations.get(name)!)
}
