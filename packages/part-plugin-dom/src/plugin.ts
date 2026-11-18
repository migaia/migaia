import type { IEventDeclaration, IEventSubscription } from '@migaia/part-contract'
import {
  definePartPlugin,
  partCorePlugin,
  type IDefinition,
  type IGenerationSignal,
  type IModifierDefinition,
  type IPartPlugin,
  type IResolvedNode,
  type IStyleRule
} from '@migaia/part-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { AriaWriter } from './aria.ts'
import { EventAdapter } from './events.ts'
import { FocusManager } from './focus.ts'
import { LayerManager } from './layer.ts'
import { LayoutManager, type ILayoutHandle } from './layout/attachment.ts'
import { BUILTIN_MODIFIERS } from './modifiers.ts'
import { StyleSheetWriter, type ILayoutRule } from './stylesheet.ts'

/**
 * Features the DOM plugin provides to renderer plugins. When a host-managed part opens, call
 * `focus.open` before `layer.open` so the restore target is the element focused before the layer
 * moved focus; on close, call `layer.close` before `focus.close`.
 */
export type IDomFeatures = {
  readonly focus: {
    open(address: string, element: HTMLElement, node: IResolvedNode): void
    close(address: string): void
    setInitial(address: string): void
  }
  readonly layer: {
    open(
      address: string,
      element: HTMLElement,
      node: IResolvedNode,
      onDismiss: (address: string) => void
    ): void
    close(address: string): void
    top(): string | undefined
  }
  readonly stylesheet: {
    apply(rules: readonly IStyleRule[]): void
    remove(address: string): void
    setStacking(address: string, zIndex: number | undefined): void
    setLayout(address: string, rules: readonly ILayoutRule[]): void
  }
  /**
   * Layout behaviour. A renderer calls `attach` at commit time with the layout root, region,
   * separator, toggle and skip-link elements, and calls the returned function before removing
   * them.
   */
  readonly layout: {
    attach(handle: ILayoutHandle): () => void
  }
  readonly events: {
    subscribe(
      address: string,
      target: EventTarget,
      key: string,
      subscription: IEventSubscription,
      declaration?: IEventDeclaration
    ): () => void
    delegate(
      templateAddress: string,
      host: EventTarget,
      key: string,
      subscription: IEventSubscription,
      declaration?: IEventDeclaration
    ): () => void
    dispatchCustom(
      target: EventTarget,
      name: string,
      declaration: IEventDeclaration,
      detail: unknown
    ): boolean
  }
  readonly aria: {
    apply(element: Element, node: IResolvedNode): void
    applyStates(element: Element, values: Readonly<Record<string, unknown>>): void
  }
}

/** Core services the DOM plugin depends on. */
type ICoreServices = {
  readonly effect: { dispatch(address: string, event: string, detail: unknown): Promise<void> }
  readonly diagnostics: { report(error: unknown): void }
  readonly catalog: { get(id: string): IDefinition | undefined }
}

/** Modifier definition registered under an id, or undefined when absent or another kind. */
function modifierOf(
  catalog: ICoreServices['catalog'],
  id: string
): IModifierDefinition<unknown> | undefined {
  /** Definition under the id. */
  const definition = catalog.get(id)
  return definition?.descriptor.kind === 'modifier'
    ? (definition as IModifierDefinition<unknown>)
    : undefined
}

/** All DOM services of one host, created together so they share the style sheet. */
class DomServices {
  /** Style writer of the host. */
  readonly stylesheet = new StyleSheetWriter()
  /** Focus manager of the host. */
  readonly focusManager = new FocusManager()
  /** Layer manager using the shared style writer. */
  readonly layerManager = new LayerManager(this.stylesheet)
  /** Layout manager using the shared style writer. */
  readonly layoutManager = new LayoutManager(this.stylesheet)
  /** Aria writer. */
  readonly aria = new AriaWriter()
  /** Event adapter forwarding to the host. */
  readonly events: EventAdapter

  /** Binds event forwarding to core services. */
  constructor(core: ICoreServices) {
    this.events = new EventAdapter({
      dispatch: (address, event, detail) => core.effect.dispatch(address, event, detail),
      report: (error) => core.diagnostics.report(error),
      modifier: (id) => modifierOf(core.catalog, id)
    })
  }

  /** Focus surface taking resolved nodes. */
  get focus(): IDomFeatures['focus'] {
    return {
      open: (address, element, node) => this.focusManager.open(address, element, node.behavior),
      close: (address) => this.focusManager.close(address),
      setInitial: (address) => this.focusManager.setInitial(address)
    }
  }

  /** Layer surface taking resolved nodes. */
  get layer(): IDomFeatures['layer'] {
    return {
      open: (address, element, node, onDismiss) =>
        this.layerManager.open(address, element, node.behavior, onDismiss),
      close: (address) => this.layerManager.close(address),
      top: () => this.layerManager.top()
    }
  }

  /** Layout surface. */
  get layout(): IDomFeatures['layout'] {
    return { attach: (handle) => this.layoutManager.attach(handle) }
  }

  /** Releases page state: layouts, layers, inert values through closes, and the style sheet. */
  release(): void {
    this.layoutManager.releaseAll()
    this.layerManager.closeAll()
    this.stylesheet.detach()
  }
}

/** Root Feature creating the services of one host. */
const servicesFeature = defineFeature((_core, deps: ICoreServices) => new DomServices(deps), {
  effect: partCorePlugin.getFeature('effect'),
  diagnostics: partCorePlugin.getFeature('diagnostics'),
  catalog: partCorePlugin.getFeature('catalog')
} as never)

/** Features of the DOM plugin, each a facet of the shared services. */
const domFeatures = {
  services: servicesFeature,
  focus: defineFeature((_core, deps: { readonly services: DomServices }) => deps.services.focus, {
    services: servicesFeature
  } as never),
  layer: defineFeature((_core, deps: { readonly services: DomServices }) => deps.services.layer, {
    services: servicesFeature
  } as never),
  stylesheet: defineFeature(
    (_core, deps: { readonly services: DomServices }) => deps.services.stylesheet,
    { services: servicesFeature } as never
  ),
  events: defineFeature((_core, deps: { readonly services: DomServices }) => deps.services.events, {
    services: servicesFeature
  } as never),
  aria: defineFeature((_core, deps: { readonly services: DomServices }) => deps.services.aria, {
    services: servicesFeature
  } as never),
  layout: defineFeature((_core, deps: { readonly services: DomServices }) => deps.services.layout, {
    services: servicesFeature
  } as never)
}

/** Names of the DOM plugin Features. */
export type IDomFeatureName = keyof typeof domFeatures

/** Public view of the DOM plugin: a part plugin whose Features renderer plugins reference. */
export type IDomPlugin = IPartPlugin & { getFeature(name: IDomFeatureName): unknown }

/** Releases the host's DOM services when the plugin generation ends. */
function releaseOnAbort(
  features: Readonly<Record<string, unknown>>,
  signal: IGenerationSignal
): void {
  /** Services of this generation. */
  const services = features.services as DomServices
  signal.addEventListener('abort', () => services.release(), { once: true })
}

/**
 * DOM plugin; install it once per host before a renderer plugin. It registers the built-in
 * modifiers. Installing it touches no DOM global; DOM work starts when a Feature method is called.
 */
export const domPlugin: IDomPlugin = definePartPlugin({
  name: 'part-dom',
  modifiers: BUILTIN_MODIFIERS as never,
  features: domFeatures as never,
  onInstall: releaseOnAbort
}) as unknown as IDomPlugin
