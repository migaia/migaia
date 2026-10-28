import { memoryTestFeatures } from './memory-features.js'
import { createStorageHost, defineFeature } from '@migaia/storage-host'
import {
  memoryBackendKind,
  memoryBackendPlugin,
  type IMemoryBackendStore
} from '@migaia/storage-host/plugins/memory'
import type { IScheduler } from '@migaia/utils/scheduler'
import { onTestFinished } from 'vitest'
import {
  createStorageReactiveService,
  type IStorageReactiveService
} from '../../src/host/reactive.js'
import type { IBackendChangeController } from '@migaia/storage-host/sdk'

/** The fixture exposes a finite view of the original host rather than another facade. */
type IReactiveServiceFixture = {
  readonly host: {
    backend(id: 'memory'): IMemoryBackendStore
    dispose(): Promise<void>
  }
  readonly service: IStorageReactiveService
  readonly controller: IBackendChangeController
  readonly store: IMemoryBackendStore
}

/** Existing service unit cases borrow a genuine installed memory store and its original controller. */
export async function createReactiveServiceFixture(options: {
  readonly id: string
  readonly scheduler?: IScheduler
  readonly report?: (error: unknown) => void
  /** Source unit cases register their original adapter after capturing the real controller. */
  readonly attach?: boolean
}): Promise<IReactiveServiceFixture> {
  /** These references come from the actual Feature construction and post-install exposure window. */
  let service!: IStorageReactiveService
  let controller!: IBackendChangeController
  let attach!: () => void
  /** The original host still owns this service; the fixture creates no lifecycle or registry. */
  const fixture = defineFeature(memoryBackendKind, ({ featureExpose }) => {
    service = createStorageReactiveService()
    featureExpose.onDispose(() => service.dispose())
    attach = () => {
      controller = featureExpose.getChangeController()!
      if (options.attach === false) return
      /** Register the exact original store, never a cloned or re-registered backend. */
      const adapter = service.registerAdapter({
        backendId: options.id,
        store: featureExpose.getStore(),
        controller,
        consistency: { mode: 'push', visibility: 'instance' },
        report: options.report ?? (() => undefined)
      })
      adapter.startSource()
    }
    return { capabilities: [] as const, chain: {}, api: { store: {}, transaction: {} } }
  })
  /** This is the same public installation boundary used by application consumers. */
  const host = await createStorageHost({
    scheduler: options.scheduler,
    report: options.report,
    plugins: [memoryBackendPlugin(undefined, { ...memoryTestFeatures, fixture })]
  })
  onTestFinished(() => host.dispose())
  attach()
  return { host, service, controller, store: host.backend('memory') }
}
