import { vi } from 'vitest'
import {
  provideCapabilities,
  type ICapabilityInstallPort,
  type IStorageBase
} from '@migaia/storage-contract'
import type { IStoragePluginCore } from '../../src/index.js'
/** Each fixture owns one native map and one real pair of cleanup promises. */
export function catalog(core: IStoragePluginCore, backend = 'catalog') {
  const client = new Map<string, string>()
  let primary: Promise<void> | undefined
  let symbolic: Promise<void> | undefined
  const cleanup = vi.fn(() => {
    client.clear()
  })
  const nativePromise = Promise.resolve('native')
  const base: IStorageBase & {
    get(key: string): Promise<string | undefined>
    original(): Promise<string>
    readSync(value: string): string
    voidSync(): void
  } = {
    backend,
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    get: (key: string) =>
      core.execution.run({ operation: 'catalog.get', input: key }, async (value) =>
        client.get(value)
      ),
    original: () =>
      core.execution.run({ operation: 'catalog.original', input: undefined }, () => nativePromise),
    readSync: (value) =>
      core.execution.runSync({ operation: 'catalog.sync', input: value }, (captured) => captured),
    voidSync: () =>
      core.execution.runSync({ operation: 'catalog.void', input: undefined }, () => undefined),
    dispose: () => (primary ??= Promise.resolve().then(cleanup)),
    [Symbol.asyncDispose]: (): Promise<void> => (symbolic ??= base.dispose().catch(() => {}))
  }
  let installer!: ICapabilityInstallPort
  const store = provideCapabilities(base, [], {
    onInstaller: (port) => {
      installer = port
    }
  })
  return { store, client, installer, cleanup, nativePromise }
}
