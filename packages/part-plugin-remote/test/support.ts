import type { ICapabilityManifest, IRemoteModuleRef } from '@migaia/part-contract'
import {
  createPartHost,
  definePart,
  definePartPlugin,
  defineResource,
  partCorePlugin,
  type IPartHost,
  type IPartPlugin,
  type IPartRendererFactory,
  type IResolvedTree
} from '@migaia/part-host'
import * as partContract from '@migaia/part-contract'
import * as partHost from '@migaia/part-host'
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { inject } from 'vitest'
import type { ICacheBackend, RemoteClient } from '../src/index.ts'
import { remotePlugin, type IRemoteOptions } from '../src/index.ts'

/**
 * Values the Node global setup provides. An interface because vitest's `ProvidedContext` is
 * extended by declaration merging.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    service: string
    modules: Record<'remote' | 'v2', IRemoteModuleRef[]>
  }
}

/** Fake catalog base URL. */
export const SERVICE = inject('service')

/** Built module references of each fixture root. */
export const MODULES = inject('modules')

/** Reference of a built module by root and name. */
export function moduleRef(root: 'remote' | 'v2', name: string): IRemoteModuleRef {
  return MODULES[root].find((ref) => ref.name === name) as IRemoteModuleRef
}

/** Shared runtime handed to remote modules. */
export const SHARED = { '@migaia/part-host': partHost, '@migaia/part-contract': partContract }

/** Calls a control route of the fake catalog and returns its request log. */
export async function control(path: string, body: unknown = {}): Promise<string[]> {
  /** Control response. */
  const response = await fetch(`${SERVICE}/control/${path}`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return ((await response.json()) as { requests: string[] }).requests
}

/** Sets the snapshot answer of `orders/<env>` to `snapshot` text or an error `status`. */
export function answer(
  env: string,
  value: { snapshot: string } | { status: number }
): Promise<string[]> {
  return control('answer', { project: 'orders', env, ...value })
}

/** One blueprint document: a button whose label is `label`, wired to `handlers` by event. */
export function blueprint(
  id: string,
  label: unknown,
  handlers: Readonly<Record<string, string>> = {}
): { id: string; version: number; root: unknown } {
  /** Event subscriptions. */
  const events = Object.fromEntries(
    Object.entries(handlers).map(([event, handler]) => [event, { handler }])
  )
  return {
    id,
    version: 1,
    root: { tag: 'button@1', id: `${id}-button`, facets: { props: { label }, events } }
  }
}

/** Snapshot text: lock plus blueprints; `definitions` lists every referenced id. */
export function snapshotText(input: {
  readonly tag: string
  readonly blueprints: readonly { readonly id: string }[]
  readonly definitions: readonly string[]
  readonly modules?: readonly IRemoteModuleRef[]
}): string {
  return JSON.stringify({
    lock: {
      format: 1,
      project: 'orders',
      tag: input.tag,
      blueprints: input.blueprints.map((item) => ({ id: item.id, version: 1, hash: 'sha256-x' })),
      definitions: input.definitions,
      modules: input.modules ?? []
    },
    blueprints: input.blueprints,
    descriptors: []
  })
}

/** UTF-8 bytes of a text. */
export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Memory backend of a fresh storage host, used as the remote cache. */
export async function memoryCache(): Promise<ICacheBackend> {
  /** Storage host. */
  const storage = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  return storage.backend('memory') as unknown as ICacheBackend
}

/** Arguments every `orders@1` command received, as `command:args`. */
export const commandLog: string[] = []

/** Local application definitions: the button part and the `orders@1` resource. */
export const appPlugin = definePartPlugin({
  name: 'app',
  parts: [definePart({ id: 'button@1' })],
  resources: [
    defineResource({
      id: 'orders@1',
      load: async () => [],
      commands: {
        create: { run: async (args) => void commandLog.push(`create:${String(args)}`) },
        delete: { run: async (args) => void commandLog.push(`delete:${String(args)}`) }
      }
    })
  ]
})

/** Manifest of the local application build. */
export const MANIFEST: ICapabilityManifest = {
  format: 1,
  build: 'test',
  definitions: ['button@1', 'orders@1'],
  renderers: ['test']
}

/** Latest resolved tree per blueprint, delivered by the test renderer. */
export class Screen {
  /** Latest tree by blueprint id. */
  readonly trees = new Map<string, IResolvedTree>()

  /** Renderer factory recording into this screen. */
  factory(): IPartRendererFactory {
    return {
      create: (_target, tree) => {
        this.trees.set(tree.blueprintId, tree)
        return {
          update: (changes) => void this.trees.set(changes.blueprintId, changes.tree),
          unmount: () => undefined
        }
      }
    }
  }

  /** Root label of a mounted blueprint. */
  label(blueprintId: string): unknown {
    return (this.trees.get(blueprintId)?.root.config.props as { label?: unknown } | undefined)
      ?.label
  }
}

/** Renderer plugin registering a screen in the core render slot. */
export function screenPlugin(screen: Screen): IPartPlugin {
  return definePlugin({
    name: 'test-renderer',
    features: {
      slot: defineFeature(
        (
          _core,
          deps: { readonly slot: { provide(plugin: string, value: IPartRendererFactory): void } }
        ) => {
          deps.slot.provide('test-renderer', screen.factory())
          return {}
        },
        { slot: partCorePlugin.getFeature('renderSlot') } as never
      )
    },
    install: () => ({})
  }) as unknown as IPartPlugin
}

/** Host with the app, a screen, the remote plugin and a probe exposing Feature `remote`. */
export type IRemoteHarness = {
  readonly host: IPartHost
  readonly remote: RemoteClient
  readonly screen: Screen
  readonly reported: unknown[]
}

/** Holder the probe writes the resolved `remote` Feature into. */
class FeatureHolder {
  /** Resolved Feature output. */
  remote: RemoteClient | undefined
}

/**
 * Plugin depending on the remote plugin's Feature, so tests can call
 * `ready`/`revalidate`/`current`.
 */
function probePlugin(remote: IPartPlugin, holder: FeatureHolder): IPartPlugin {
  return definePartPlugin({
    name: 'probe',
    features: {
      remote: defineFeature((_core, deps: { readonly remote: RemoteClient }) => deps.remote, {
        remote: (remote as unknown as { getFeature(name: string): unknown }).getFeature('remote')
      } as never)
    },
    onInstall: (features) => void (holder.remote = features.remote as RemoteClient)
  })
}

/** Creates a host with the remote plugin and the given options over the defaults. */
export async function remoteHost(
  options: Partial<IRemoteOptions> & Pick<IRemoteOptions, 'cache'>
): Promise<IRemoteHarness> {
  /** Reported errors. */
  const reported: unknown[] = []
  /** Screen. */
  const screen = new Screen()
  /** Remote plugin. */
  const remote = remotePlugin({
    service: SERVICE,
    project: 'orders',
    env: 'prod',
    manifest: MANIFEST,
    shared: SHARED,
    revalidateMs: 3_600_000,
    isolatedWorker: () =>
      new Worker(new URL('../src/browser/isolated-worker.ts', import.meta.url), { type: 'module' }),
    ...options
  })
  /** Feature holder. */
  const holder = new FeatureHolder()
  /** Host. */
  const host = await createPartHost({
    plugins: [appPlugin, screenPlugin(screen), remote, probePlugin(remote, holder)],
    onError: (error) => reported.push(error)
  })
  return { host, remote: holder.remote as RemoteClient, screen, reported }
}

/** Codes of reported errors. */
export function codes(reported: readonly unknown[]): unknown[] {
  return reported.map((error) => (error as { code?: unknown }).code)
}
