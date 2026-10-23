import type { IStoragePluginCore, IStorageHost } from '@migaia/storage-host'

declare module '@migaia/storage-host' {
  /** Backend consumers merge into the same host registry instead of declaring another event bus. */
  interface IStorageHookMap {
    onCatalogProbe: Readonly<{ count: number }>
  }
}

/** The installed core retains the augmented event name and exact payload. */
declare const core: IStoragePluginCore
/** Public root declarations must route augmentation to the actual runtime host listener API. */
declare const host: IStorageHost<readonly []>
core.emit('onCatalogProbe', () => ({ count: 1 }))
host.hooks.on('onCatalogProbe', (payload) => {
  const count: number = payload.count
  void count
})
// @ts-expect-error Backend event augmentation must preserve the payload domain.
core.emit('onCatalogProbe', () => ({ count: 'one' }))
