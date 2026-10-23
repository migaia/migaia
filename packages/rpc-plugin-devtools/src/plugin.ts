import { defineFeaturePlugin, type IRpcFeaturePlugin } from '@migaia/rpc-host/plugin'
import { createRpcDevtools } from './collector/devtools.js'
import { CollectorText } from './collector/text.js'
import type { IRpcDevtools, IRpcDevtoolsOptions } from './collector-types.js'

/** Native feature metadata exposes one caller-owned collector without owning any host lifetime. */
export type IDevtoolsPlugin = IRpcFeaturePlugin &
  Readonly<{ collector: IRpcDevtools }> &
  Pick<IRpcDevtools, 'query' | 'watch' | 'stats' | 'describe' | 'close'>

/** Only the five read/lifetime projections accompany the original registered probe object. */
type IDevtoolsSurface = Readonly<{ collector: IRpcDevtools }> &
  Pick<IRpcDevtools, 'query' | 'watch' | 'stats' | 'describe' | 'close'>

/** Configure one collector per call; the module-level factory supplies the shared feature identity. */
export const devtoolsPlugin: (options?: IRpcDevtoolsOptions) => IDevtoolsPlugin =
  defineFeaturePlugin<IRpcDevtoolsOptions | undefined, IDevtoolsSurface>((options) => {
    /** The canonical collector owns storage, registered probe stages and its explicit close. */
    const collector = createRpcDevtools(options)
    return {
      name: CollectorText.pluginName,
      probe: collector,
      surface: {
        collector,
        query: (input) => collector.query(input),
        watch: (input) => collector.watch(input),
        stats: () => collector.stats(),
        describe: () => collector.describe(),
        close: () => collector.close()
      }
    }
  })
