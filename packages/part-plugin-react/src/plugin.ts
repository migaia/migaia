import {
  partCorePlugin,
  type IPartPlugin,
  type IPartRendererFactory,
  type IResolvedNode,
  type IResourceHandle
} from '@migaia/part-host'
import { domPlugin, type IDomFeatures } from '@migaia/part-plugin-dom'
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import type { IRuntime } from '@migaia/reactive'
import { ReactRendererFactory } from './render.tsx'

/** PH plugin name of the React renderer. */
const PLUGIN_NAME = 'part-react'

/** Core and DOM Feature outputs the renderer depends on. */
type IRendererDeps = IDomFeatures & {
  readonly renderSlot: {
    provide(plugin: string, factory: IPartRendererFactory): void
    withdraw(factory: IPartRendererFactory): void
  }
  readonly state: {
    readonly runtime: IRuntime
    read(path: string): unknown
    write(path: string, value: unknown): void
    resolve(node: IResolvedNode, value: unknown, row?: Readonly<Record<string, unknown>>): unknown
  }
  readonly catalog: { implementation(renderer: string, partId: string): unknown }
  readonly effect: { dispatch(address: string, event: string, detail: unknown): Promise<void> }
  readonly diagnostics: { report(error: unknown): void }
  readonly resources: IResourceHandle
}

/** Builds the renderer factory of one host and registers it in the render slot. */
function createFactory(deps: IRendererDeps): ReactRendererFactory {
  /** Factory bound to this host's services. */
  const factory = new ReactRendererFactory({
    runtime: deps.state.runtime,
    dom: {
      focus: deps.focus,
      layer: deps.layer,
      stylesheet: deps.stylesheet,
      events: deps.events,
      aria: deps.aria,
      layout: deps.layout
    },
    catalog: deps.catalog,
    state: deps.state,
    dispatch: (address, event, detail) => deps.effect.dispatch(address, event, detail),
    report: (error) => deps.diagnostics.report(error),
    resources: deps.resources
  })
  deps.renderSlot.provide(PLUGIN_NAME, factory)
  return factory
}

/** Renderer Feature: one factory per host. */
const rendererFeature = defineFeature(
  (_core, deps: IRendererDeps) => ({ factory: createFactory(deps), slot: deps.renderSlot }),
  {
    renderSlot: partCorePlugin.getFeature('renderSlot'),
    state: partCorePlugin.getFeature('state'),
    catalog: partCorePlugin.getFeature('catalog'),
    effect: partCorePlugin.getFeature('effect'),
    diagnostics: partCorePlugin.getFeature('diagnostics'),
    resources: partCorePlugin.getFeature('resources'),
    focus: domPlugin.getFeature('focus'),
    layer: domPlugin.getFeature('layer'),
    stylesheet: domPlugin.getFeature('stylesheet'),
    events: domPlugin.getFeature('events'),
    aria: domPlugin.getFeature('aria'),
    layout: domPlugin.getFeature('layout')
  } as never
)

/** The part of the PH install core the renderer plugin uses. */
type IRendererInstallCore = {
  readonly features: {
    readonly renderer: {
      readonly factory: IPartRendererFactory
      readonly slot: IRendererDeps['renderSlot']
    }
  }
  readonly lifecycle: {
    readonly signal: {
      addEventListener(type: 'abort', listener: () => void, options: { readonly once: true }): void
    }
  }
}

/** React renderer plugin; install after `domPlugin`. */
export const reactPlugin: IPartPlugin = definePlugin({
  name: PLUGIN_NAME,
  features: { renderer: rendererFeature },
  install: (core: IRendererInstallCore) => {
    /** Renderer output of this generation. */
    const renderer = core.features.renderer
    core.lifecycle.signal.addEventListener(
      'abort',
      () => renderer.slot.withdraw(renderer.factory),
      { once: true }
    )
    return {}
  }
}) as unknown as IPartPlugin
