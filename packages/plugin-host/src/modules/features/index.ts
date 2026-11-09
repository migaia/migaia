import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { SharedSlotView } from './shared-slot-view.ts'
import { compileFeatures, instantiateFeatures } from './feature-runtime.ts'
export { defineFeature } from '../../feature-definition-snapshots.ts'
export { inspectFeatures } from './feature-runtime.ts'
/** Native feature construction needs no host dependency graph when roots declare no dependencies. */
export const featuresModule: IHostModule<typeof HostModuleKey.features> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.features,
    install(context) {
      context.featureRuntime = { compileFeatures, instantiateFeatures }
      context.state.configureSharedView(SharedSlotView)
    }
  })
