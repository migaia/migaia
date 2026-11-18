import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import {
  partCorePlugin,
  type IPartPlugin,
  type IPartRendererFactory,
  type IResolvedChanges,
  type IResolvedTree
} from '../src/index.ts'

/** Records what a test renderer factory and its mounts received. */
export class RenderLog {
  /** Trees passed to `create`. */
  readonly created: IResolvedTree[] = []
  /** Change sets per mount, in creation order. */
  readonly updates: IResolvedChanges[][] = []
  /** Unmount count per mount. */
  readonly unmounts: number[] = []

  /** Factory recording into this log. */
  factory(): IPartRendererFactory {
    return {
      create: (_target, tree) => {
        /** Index of this mount. */
        const index = this.created.length
        this.created.push(tree)
        this.updates.push([])
        this.unmounts.push(0)
        return {
          update: (changes) => void this.updates[index]?.push(changes),
          unmount: () => void (this.unmounts[index] = (this.unmounts[index] ?? 0) + 1)
        }
      }
    }
  }
}

/** Renderer plugin that registers a factory in the core render slot. */
export function rendererPlugin(name: string, factory: IPartRendererFactory): IPartPlugin {
  return definePlugin({
    name,
    features: {
      slot: defineFeature(
        (
          _core,
          deps: { readonly slot: { provide(plugin: string, value: IPartRendererFactory): void } }
        ) => {
          deps.slot.provide(name, factory)
          return {}
        },
        { slot: partCorePlugin.getFeature('renderSlot') } as never
      )
    },
    install: () => ({})
  }) as unknown as IPartPlugin
}
