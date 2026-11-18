import type { IBehavior } from '@migaia/part-contract'
import {
  createPartHost,
  type IPartHost,
  type IPartHostOptions,
  type IPartPlugin,
  type IResolvedNode
} from '@migaia/part-host'
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { domPlugin, type IDomFeatures } from '../src/index.ts'

/** Host plus the DOM features captured by a probe plugin. */
export type IDomHarness = { readonly host: IPartHost; readonly dom: IDomFeatures }

/** Creates a host with the DOM plugin and returns its DOM features. */
export async function createDomHarness(options: IPartHostOptions = {}): Promise<IDomHarness> {
  /** Features captured at probe install. */
  let captured: IDomFeatures | undefined
  /** Probe plugin depending on every DOM feature. */
  const probe = definePlugin({
    name: 'probe',
    features: {
      dom: defineFeature((_core, deps: IDomFeatures) => deps, {
        focus: domPlugin.getFeature('focus'),
        layer: domPlugin.getFeature('layer'),
        stylesheet: domPlugin.getFeature('stylesheet'),
        events: domPlugin.getFeature('events'),
        aria: domPlugin.getFeature('aria'),
        layout: domPlugin.getFeature('layout')
      } as never)
    },
    install: (core: { readonly features: { readonly dom: IDomFeatures } }) => {
      captured = core.features.dom
      return {}
    }
  }) as unknown as IPartPlugin
  /** Host with the DOM plugin, the caller's plugins and the probe. */
  const host = await createPartHost({
    ...options,
    plugins: [domPlugin, ...(options.plugins ?? []), probe]
  })
  return { host, dom: captured as IDomFeatures }
}

/** Minimal resolved node carrying an address and behavior. */
export function nodeOf(
  address: string,
  behavior: IBehavior,
  extra: Partial<IResolvedNode> = {}
): IResolvedNode {
  return {
    address,
    definition: { descriptor: { kind: 'part', id: 'x@1' } },
    behavior,
    config: {},
    derivedAria: {},
    ariaStates: {},
    styleRules: [],
    children: [],
    slots: {},
    ...extra
  }
}

/** Creates an element with attributes and appends it to a parent. */
export function element<T extends HTMLElement>(
  tag: string,
  parent: HTMLElement,
  attributes: Record<string, string> = {}
): T {
  /** New element. */
  const created = document.createElement(tag) as T
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value)
  parent.append(created)
  return created
}
