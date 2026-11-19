/** Text of the TS modules `partom extract --usage` generates besides blueprints and black boxes. */
import { UsageText } from './text.ts'

/** One effect draft: its id, a safe constant name and the original handler source. */
export type IEffectDraft = { readonly id: string; readonly name: string; readonly source: string }

/**
 * JSON string literal that is also a safe JavaScript string literal: U+2028 and U+2029 are escaped,
 * so page text can never end the literal or a surrounding line.
 */
export function stringLiteral(text: string): string {
  return JSON.stringify(text).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

/** Effects module of one page: drafts that throw until reviewed, plus the original sources. */
export function effectsModule(blueprintId: string, drafts: readonly IEffectDraft[]): string {
  /** Draft lines. */
  const lines: string[] = []
  for (const draft of drafts)
    lines.push(
      `/** Original source of the handler, kept for review. */`,
      `export const ${draft.name}Source = ${stringLiteral(draft.source)}`,
      '',
      `/** Effect draft for the handler; it throws until its body is written by hand. */`,
      `export const ${draft.name}Effect = defineEffect({`,
      `  id: ${stringLiteral(draft.id)},`,
      `  run: () => {`,
      `    throw new Error(REVIEW_REQUIRED)`,
      `  }`,
      `})`,
      ''
    )
  return [
    `import { defineEffect, definePartPlugin } from '@migaia/part-host'`,
    '',
    `/** Error thrown by drafts that still need review. */`,
    `const REVIEW_REQUIRED = ${stringLiteral(UsageText.reviewRequired)}`,
    '',
    ...lines,
    `/** Plugin registering the effects of the page. */`,
    `export default definePartPlugin({`,
    `  name: ${stringLiteral(`${blueprintId}-effects`)},`,
    `  effects: [${drafts.map((draft) => `${draft.name}Effect`).join(', ')}]`,
    `})`,
    ''
  ].join('\n')
}

/** JavaScript literal of a JSON value; U+2028 and U+2029 are escaped like in `stringLiteral`. */
function valueLiteral(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

/**
 * Seed module of one page: a part plugin depending on the core `state` Feature that seeds each
 * literal initial value in `onInstall`; a path already written is left alone (`state.seed`).
 */
export function seedModule(blueprintId: string, seeds: ReadonlyMap<string, unknown>): string {
  /** Seed calls. */
  const calls = [...seeds].map(
    ([path, value]) => `    state.seed(${stringLiteral(path)}, ${valueLiteral(value)})`
  )
  return [
    `import { definePartPlugin, partCorePlugin } from '@migaia/part-host'`,
    `import { defineFeature } from '@migaia/plugin-host/features'`,
    '',
    `/** State surface the seed plugin writes through. */`,
    `type IStateSeeder = { seed(path: string, value: unknown): void }`,
    '',
    `/** The core state Feature, taken as this plugin's own Feature output. */`,
    `const stateFeature = defineFeature(`,
    `  (_core, deps: { readonly state: IStateSeeder }) => deps.state,`,
    `  { state: partCorePlugin.getFeature('state') } as never`,
    `)`,
    '',
    `/** Plugin seeding the page state once its catalog entries are registered. */`,
    `export default definePartPlugin({`,
    `  name: ${stringLiteral(`${blueprintId}-seed`)},`,
    `  features: { state: stateFeature },`,
    `  onInstall: (features) => {`,
    `    /** Core state Feature. */`,
    `    const state = features.state as IStateSeeder`,
    ...calls,
    `  }`,
    `})`,
    ''
  ].join('\n')
}

/** Component name of a native tag: `div` → `HtmlDiv`. */
function htmlName(tag: string): string {
  return `Html${tag.charAt(0).toUpperCase()}${tag.slice(1)}`
}

/** Native-element parts module: one part and one component per tag; `name` is the plugin name. */
export function htmlModule(name: string, tags: Iterable<string>): string {
  /** Per-tag lines. */
  const lines: string[] = []
  /** Part constants. */
  const parts: string[] = []
  /** Binding lines. */
  const bindings: string[] = []
  for (const tag of tags) {
    /** Component name. */
    const component = htmlName(tag)
    lines.push(
      `/** Native <${tag}> rendered with the blueprint props. */`,
      `export function ${component}(props: Record<string, unknown>): ReactNode {`,
      `  return createElement(${stringLiteral(tag)}, props)`,
      `}`,
      `/** Part of the native <${tag}> element. */`,
      `export const ${component}Part = definePart({ id: ${stringLiteral(`html-${tag}@1`)}, behavior: { semantics: { element: ${stringLiteral(tag)} } } })`,
      ''
    )
    parts.push(`${component}Part`)
    bindings.push(`bindReactComponent(${component}Part, ${component})`)
  }
  return [
    `import { definePart, definePartPlugin } from '@migaia/part-host'`,
    `import { bindReactComponent } from '@migaia/part-plugin-react'`,
    `import { createElement, type ReactNode } from 'react'`,
    '',
    ...lines,
    `/** Plugin registering the native-element parts. */`,
    `export default definePartPlugin({`,
    `  name: ${stringLiteral(name)},`,
    `  parts: [${parts.join(', ')}],`,
    `  implementations: [${bindings.join(', ')}]`,
    `})`,
    ''
  ].join('\n')
}
