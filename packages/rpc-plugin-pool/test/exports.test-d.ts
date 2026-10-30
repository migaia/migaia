import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import {
  pool,
  type IPoolPluginOptions,
  type IRpcPoolControls,
  type IRpcPoolStats,
  type IRpcPoolErrorCode
} from '../dist/index.js'
import type * as Pool from '../dist/index.js'

/** Scheduling controls belong to the feature installation on this exact host. */
declare const task: Parameters<typeof coroutinePlugin>[0]['spawn']
const options: IPoolPluginOptions = { size: 3, maxQueue: 6 }
const host = await createRpcHost({
  plugins: [coroutinePlugin({ spawn: task!, features: { workers: pool(options) } })]
})
const controls: IRpcPoolControls = host.coroutine.pool
const stats: IRpcPoolStats = controls.stats()
const code: IRpcPoolErrorCode = 'POOL_CLOSED'
void [stats, code]

/** Transport-specific factories and their source option types have no public compatibility aliases. */
// @ts-expect-error standalone pool construction is retired
type ICreatePool = typeof Pool.createPool
// @ts-expect-error process-specific construction is retired
type IProcessFactory = typeof Pool.createProcessPool
// @ts-expect-error thread-specific construction is retired
type IThreadFactory = typeof Pool.createThreadPool
// @ts-expect-error process-specific options belong to the transport, not the pool
type IProcessOptions = Pool.IProcessPoolOptions
// @ts-expect-error thread-specific options belong to the transport, not the pool
type IThreadOptions = Pool.IThreadPoolOptions
// @ts-expect-error process-specific result aliases are retired
type IProcessPool = Pool.IProcessPool
// @ts-expect-error thread-specific result aliases are retired
type IThreadPool = Pool.IThreadPool
/** Consume compile-time negative assertions without emitting or restoring any retired API. */
declare const absent: [
  ICreatePool,
  IProcessFactory,
  IThreadFactory,
  IProcessOptions,
  IThreadOptions,
  IProcessPool,
  IThreadPool
]
void absent
