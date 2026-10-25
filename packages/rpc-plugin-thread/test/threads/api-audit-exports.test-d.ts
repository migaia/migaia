import { threadPlugin } from '@migaia/rpc-plugin-thread'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import type { INodeThreadHandle } from '../../dist/threads/node-launcher.js'
import type {
  IWebThreadHandle,
  IWebThreadLauncherOptions
} from '../../dist/threads/web-launcher.js'

/** Canonical native handles stay available to lower-owner tests from their exact implementation. */
export type ICanonicalThreadTypes = INodeThreadHandle | IWebThreadHandle | IWebThreadLauncherOptions
/** The public entry supplies one registered transport definition, without complete-Peer injection. */
type ITransportDefinition<T extends IRpcTransportPlugin> = T
export type ICanonicalThreadPlugin = ITransportDefinition<ReturnType<typeof threadPlugin>>

// @ts-expect-error Endpoint construction remains owned by the host.
threadPlugin({ spawn: true, endpointFactory: () => undefined })

// @ts-expect-error removes the redundant Bun subpath; native Web implementation stays private.
import type { createBunThreadLauncher } from '@migaia/rpc-plugin-thread/adapters/bun'
// @ts-expect-error removes the redundant Deno subpath; native Web implementation stays private.
import type { createDenoThreadLauncher } from '@migaia/rpc-plugin-thread/adapters/deno'
// @ts-expect-error removes the redundant browser subpath; native Web implementation stays private.
import type { createBrowserThreadLauncher } from '@migaia/rpc-plugin-thread/adapters/browser'
// @ts-expect-error removes the redundant renderer subpath; native Web implementation stays private.
import type { createElectronRendererThreadLauncher } from '@migaia/rpc-plugin-thread/adapters/electron-renderer'
// @ts-expect-error retains platform handle types in their private implementation owner.
import type { INodeThreadHandle as IRetiredNodeHandle } from '@migaia/rpc-plugin-thread/adapters/node'
// @ts-expect-error retains platform handle types in their private implementation owner.
import type { INodeThreadHandle as IRetiredElectronHandle } from '@migaia/rpc-plugin-thread/adapters/electron-main'

// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createThreadPlugin as retiredRootcreateThreadPlugin } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createThreadPeer as retiredRootcreateThreadPeer } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createNodeThreadChannel as retiredRootcreateNodeThreadChannel } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createWebThreadChannel as retiredRootcreateWebThreadChannel } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { receiveThreadData as retiredRootreceiveThreadData } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { readThreadBootstrap as retiredRootreadThreadBootstrap } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadChannelFactory as IRetiredRootIThreadChannelFactory } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadChannelOptions as IRetiredRootIThreadChannelOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadWebPort as IRetiredRootIThreadWebPort } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadBootstrapData as IRetiredRootIThreadBootstrapData } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeThreadPeerOptions as IRetiredRootIRuntimeThreadPeerOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeThreadSpawn as IRetiredRootIRuntimeThreadSpawn } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeThreadShortSpawn as IRetiredRootIRuntimeThreadShortSpawn } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeThreadPluginOptions as IRetiredRootIRuntimeThreadPluginOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { AdapterNodeThreadParentChannel as retiredRootAdapterNodeThreadParentChannel } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createAdapterNodeThreadLauncher as retiredRootcreateAdapterNodeThreadLauncher } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createAdapterNodeThreadPeer as retiredRootcreateAdapterNodeThreadPeer } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createWebThreadLauncher as retiredRootcreateWebThreadLauncher } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createWebThreadChannelFactory as retiredRootcreateWebThreadChannelFactory } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadRuntimeResource as IRetiredRootIThreadRuntimeResource } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadParentPort as IRetiredRootIThreadParentPort } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadNativeWorker as IRetiredRootIThreadNativeWorker } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadNativeWorkerConstructor as IRetiredRootIThreadNativeWorkerConstructor } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IThreadNativeRuntimeModule as IRetiredRootIThreadNativeRuntimeModule } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { INodeThreadHandle as IRetiredRootINodeThreadHandle } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IAdapterNodeThreadHandle as IRetiredRootIAdapterNodeThreadHandle } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IWebThreadHandle as IRetiredRootIWebThreadHandle } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IAdapterWebThreadHandle as IRetiredRootIAdapterWebThreadHandle } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IWebThreadWorker as IRetiredRootIWebThreadWorker } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IWebThreadLauncherOptions as IRetiredRootIWebThreadLauncherOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeSurface as IRetiredRootIRuntimeSurface } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeDynamicSurface as IRetiredRootIRuntimeDynamicSurface } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeTypedPeer as IRetiredRootIRuntimeTypedPeer } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeQueryOptions as IRetiredRootIRuntimeQueryOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeUnavailable as IRetiredRootIRuntimeUnavailable } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeDetail as IRetiredRootIRuntimeDetail } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeConnectionDetail as IRetiredRootIRuntimeConnectionDetail } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeOverview as IRetiredRootIRuntimeOverview } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeRecent as IRetiredRootIRuntimeRecent } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeListFilter as IRetiredRootIRuntimeListFilter } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeListOptions as IRetiredRootIRuntimeListOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeThreadStopOptions as IRetiredRootIRuntimeThreadStopOptions } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { IRuntimeEvent as IRetiredRootIRuntimeEvent } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { RuntimeEventName as IRetiredRootRuntimeEventName } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createThreadHost as retiredRootcreateThreadHost } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createServeThreadHost as retiredRootcreateServeThreadHost } from '@migaia/rpc-plugin-thread'
// @ts-expect-error Native assembly and legacy runtime exports remain private.
import type { createServeThreadPlugin as retiredRootcreateServeThreadPlugin } from '@migaia/rpc-plugin-thread'

/** Every rejected binding is consumed by the compiler oracle. */
export type IRetiredThreadTypes =
  | typeof createBunThreadLauncher
  | typeof createDenoThreadLauncher
  | typeof createBrowserThreadLauncher
  | typeof createElectronRendererThreadLauncher
  | IRetiredNodeHandle
  | IRetiredElectronHandle
  | typeof retiredRootcreateThreadPlugin
  | typeof retiredRootcreateThreadPeer
  | typeof retiredRootcreateNodeThreadChannel
  | typeof retiredRootcreateWebThreadChannel
  | typeof retiredRootreceiveThreadData
  | typeof retiredRootreadThreadBootstrap
  | IRetiredRootIThreadChannelFactory
  | IRetiredRootIThreadChannelOptions
  | IRetiredRootIThreadWebPort
  | IRetiredRootIThreadBootstrapData
  | IRetiredRootIRuntimeThreadPeerOptions
  | IRetiredRootIRuntimeThreadSpawn
  | IRetiredRootIRuntimeThreadShortSpawn
  | IRetiredRootIRuntimeThreadPluginOptions
  | typeof retiredRootAdapterNodeThreadParentChannel
  | typeof retiredRootcreateAdapterNodeThreadLauncher
  | typeof retiredRootcreateAdapterNodeThreadPeer
  | typeof retiredRootcreateWebThreadLauncher
  | typeof retiredRootcreateWebThreadChannelFactory
  | IRetiredRootIThreadRuntimeResource
  | IRetiredRootIThreadParentPort
  | IRetiredRootIThreadNativeWorker
  | IRetiredRootIThreadNativeWorkerConstructor
  | IRetiredRootIThreadNativeRuntimeModule
  | IRetiredRootINodeThreadHandle
  | IRetiredRootIAdapterNodeThreadHandle
  | IRetiredRootIWebThreadHandle
  | IRetiredRootIAdapterWebThreadHandle
  | IRetiredRootIWebThreadWorker
  | IRetiredRootIWebThreadLauncherOptions
  | IRetiredRootIRuntimeSurface
  | IRetiredRootIRuntimeDynamicSurface
  | IRetiredRootIRuntimeTypedPeer
  | IRetiredRootIRuntimeQueryOptions
  | IRetiredRootIRuntimeUnavailable
  | IRetiredRootIRuntimeDetail
  | IRetiredRootIRuntimeConnectionDetail
  | IRetiredRootIRuntimeOverview
  | IRetiredRootIRuntimeRecent
  | IRetiredRootIRuntimeListFilter
  | IRetiredRootIRuntimeListOptions
  | IRetiredRootIRuntimeThreadStopOptions
  | IRetiredRootIRuntimeEvent
  | IRetiredRootRuntimeEventName
  | typeof retiredRootcreateThreadHost
  | typeof retiredRootcreateServeThreadHost
  | typeof retiredRootcreateServeThreadPlugin
