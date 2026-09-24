/** A9 proves the R3 public type removals and canonical middleware re-exports. */
// @ts-expect-error R3 removes the duplicated mode constant.
import { PluginHostPipelineMode } from '../src/index.js'
// @ts-expect-error R3 removes the duplicated sync stage declaration.
import type { ISyncPipelineStage } from '../src/index.js'
// @ts-expect-error R3 removes public compatibility adapters.
import { adaptSyncStageToAsync } from '../src/index.js'
import {
  MiddlewarePipelineMode,
  PluginHostErrorCode,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage
} from '../src/index.js'

const mode: IMiddlewarePipelineMode = MiddlewarePipelineMode.sync
const stage: ISyncMiddlewareStage<number> = (value, next) => next(value + 1)
const suspended: 'PLUGIN_SUSPENDED' = PluginHostErrorCode.pluginSuspended
void mode
void stage
void suspended
void PluginHostPipelineMode
void (undefined as unknown as ISyncPipelineStage<number>)
void adaptSyncStageToAsync
